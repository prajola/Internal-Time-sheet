/**
 * Excel-backed storage engine.
 *
 * The system of record is a single .xlsx workbook — one worksheet per
 * entity — living in Vercel Blob. Serverless functions have no durable
 * disk, so the workbook is fetched, held in memory, and rebuilt on a
 * schedule rather than rewritten on every save.
 *
 * Why not just rewrite the workbook on each write? That is exactly the
 * old blob backend this project abandoned: two functions that both
 * read-modify-write the same file silently lose one of the two edits.
 * Vercel Blob has no compare-and-swap (no If-Match, no conditional
 * put), so there is no safe way to do it.
 *
 * So writes never touch the workbook. The layout is:
 *
 *   db/snap-<watermark>-<rand>.xlsx   immutable snapshot of all entities
 *   db/journal/<ts>-<rand>.json       immutable record of one commit
 *
 * read    = newest snapshot + replay every journal entry newer than its
 *           watermark
 * write   = upload one new journal blob; nothing is ever overwritten,
 *           so concurrent writers cannot clobber each other
 * compact = fold the journal into a fresh snapshot, then garbage-collect
 *
 * Every blob is write-once with a unique name. That matters: Vercel Blob
 * serves from a CDN and `cacheControlMaxAge` cannot go below 60s, so a
 * mutable blob could be read stale. Immutable blobs are safe to cache
 * forever, and `list()` hits the API directly, so discovery is always
 * current. There is deliberately no mutable HEAD pointer — the newest
 * snapshot is whichever has the highest watermark.
 *
 * Clock skew: compaction only folds journal entries older than
 * COMPACT_LAG_MS (5 min). A function may run at most 30s (vercel.json
 * maxDuration), so an entry is always visible well inside that window.
 * An entry is only at risk if one machine's clock is >5 min ahead of
 * another's, which NTP-synced hosts do not do.
 */
import { put, list, del } from "@vercel/blob";
import ExcelJS from "exceljs";
import {
  ENTITIES,
  SCHEMA,
  applyOps,
  cloneState,
  decodeCell,
  emptyState,
  normalizeRecord,
  type EntityName,
  type Kind,
  type Op,
  type State,
} from "./store-schema.js";

// Re-exported so existing importers (scripts, store.ts) keep working.
export { ENTITIES, SCHEMA, emptyState, normalizeRecord };
export type { EntityName, Op, State };

/* ── Schema ─────────────────────────────────────────────────── */
// Shared with the Google Sheets driver — see ./store-schema.ts.

/* ── Tuning ──────────────────────────────────────────────────── */

/**
 * Root folder inside the blob store. Override with XLSX_STORE_PREFIX to
 * point a preview deployment — or a test run — at its own namespace
 * instead of production data.
 */
const PREFIX = (process.env.XLSX_STORE_PREFIX || "db").replace(/\/+$/, "");
const SNAP_PREFIX = `${PREFIX}/snap-`;
const JOURNAL_PREFIX = `${PREFIX}/journal/`;

/** Fold the journal once it reaches this many entries. */
const COMPACT_THRESHOLD = 50;
/** Never fold entries younger than this — see the clock-skew note above. */
const COMPACT_LAG_MS = 5 * 60 * 1000;
/** Keep folded journal entries this long before GC, for recovery. */
const JOURNAL_GRACE_MS = 24 * 60 * 60 * 1000;
/** Snapshots to retain. Older ones are point-in-time recovery material. */
const SNAPSHOTS_KEPT = 10;
/** Re-check the blob store at most this often within one warm instance. */
const DISCOVERY_TTL_MS = 2_000;
/** Parallelism when fetching journal entries. */
const FETCH_CONCURRENCY = 16;

/* ── Types ───────────────────────────────────────────────────── */

/** One commit, as stored in a journal blob. */
interface JournalEntry {
  v: 1;
  ts: number;
  ops: Op[];
}

/* ── Blob naming ─────────────────────────────────────────────── */

/** Zero-padded so lexical order matches numeric order. */
function pad13(n: number): string {
  return String(n).padStart(13, "0");
}

function rand(n = 6): string {
  return Math.random().toString(36).slice(2, 2 + n).padEnd(n, "0");
}

function snapshotKey(watermark: number): string {
  return `${SNAP_PREFIX}${pad13(watermark)}-${rand()}.xlsx`;
}

function journalKey(ts: number): string {
  return `${JOURNAL_PREFIX}${pad13(ts)}-${rand()}.json`;
}

/** Parse the watermark back out of a snapshot pathname. */
function watermarkOf(pathname: string): number {
  const m = pathname.slice(SNAP_PREFIX.length).match(/^(\d{13})/);
  return m ? Number(m[1]) : 0;
}

/** Parse the commit timestamp back out of a journal pathname. */
function tsOf(pathname: string): number {
  const m = pathname.slice(JOURNAL_PREFIX.length).match(/^(\d{13})/);
  return m ? Number(m[1]) : 0;
}

/* ── Blob helpers ────────────────────────────────────────────── */

function token(): string {
  const t = process.env.BLOB_READ_WRITE_TOKEN;
  if (!t) throw new Error("BLOB_READ_WRITE_TOKEN is not set");
  return t;
}

interface BlobRef {
  pathname: string;
  url: string;
  uploadedAt: Date;
}

async function listAll(prefix: string): Promise<BlobRef[]> {
  const out: BlobRef[] = [];
  let cursor: string | undefined;
  do {
    const r = await list({ prefix, cursor, limit: 1000, token: token() });
    for (const b of r.blobs) {
      out.push({ pathname: b.pathname, url: b.url, uploadedAt: b.uploadedAt });
    }
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}

/**
 * Fetch an immutable blob.
 *
 * Retries transient network/5xx failures — a cold CDN edge occasionally
 * serves a 503 on first touch. Content is immutable, so a retry is
 * always safe.
 */
async function fetchBlob(url: string): Promise<ArrayBuffer> {
  const delays = [200, 600, 1500];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.arrayBuffer();
      if (r.status >= 500 && attempt < delays.length) {
        await sleep(delays[attempt]);
        continue;
      }
      throw new Error(`blob fetch ${url}: HTTP ${r.status}`);
    } catch (e) {
      lastErr = e;
      if (attempt === delays.length) throw e;
      await sleep(delays[attempt]);
    }
  }
  throw lastErr ?? new Error("fetchBlob: unreachable");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Run `fn` over `items` with bounded concurrency, preserving order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/* ── Workbook codec ──────────────────────────────────────────── */

function encodeCell(value: unknown, kind: Kind): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (kind === "bool") return value === true;
  if (kind === "num") return typeof value === "number" && Number.isFinite(value) ? value : 0;
  return String(value);
}

/** Render the whole state as a .xlsx workbook. */
export async function stateToWorkbookBuffer(state: State): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "internal-time-sheet";
  wb.created = new Date();

  for (const entity of ENTITIES) {
    const spec = SCHEMA[entity];
    const ws = wb.addWorksheet(spec.sheet);
    ws.columns = spec.columns.map(([name]) => ({ header: name, key: name, width: 24 }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];

    for (const rec of state[entity].values()) {
      const row: Record<string, string | number | boolean | null> = {};
      for (const [name, kind] of spec.columns) {
        row[name] = encodeCell((rec as Record<string, unknown>)[name], kind);
      }
      ws.addRow(row);
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

export async function workbookBufferToState(data: ArrayBuffer): Promise<State> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const state = emptyState();

  for (const entity of ENTITIES) {
    const spec = SCHEMA[entity];
    const ws = wb.getWorksheet(spec.sheet);
    if (!ws) continue;

    // Trust the header row rather than column position — a snapshot
    // written by an older build may have fewer columns.
    const header = ws.getRow(1);
    const colOf = new Map<string, number>();
    header.eachCell((cell, n) => {
      const name = String(cell.value ?? "").trim();
      if (name) colOf.set(name, n);
    });

    ws.eachRow((row, n) => {
      if (n === 1) return;
      const rec: Record<string, unknown> = {};
      for (const [name, kind] of spec.columns) {
        const idx = colOf.get(name);
        const decoded = decodeCell(idx ? row.getCell(idx).value : null, kind);
        if (decoded !== undefined) rec[name] = decoded;
      }
      const id = rec.id;
      if (typeof id === "string" && id) state[entity].set(id, rec);
    });
  }
  return state;
}

/* ── Journal ─────────────────────────────────────────────────── */

/* ── In-memory cache (per warm lambda instance) ──────────────── */

interface Cached {
  /** Watermark of the snapshot this was built from. */
  snapWatermark: number;
  /** Parsed snapshot, before journal replay. Reused across requests. */
  snapState: State;
  /** Snapshot + replayed journal. */
  state: State;
  /** Journal pathnames already folded into `state`. */
  replayed: Set<string>;
  /** When discovery last ran. */
  discoveredAt: number;
}

let cache: Cached | null = null;
/** Immutable journal payloads, memoised by pathname. */
const journalCache = new Map<string, JournalEntry>();
/** Collapses concurrent loads inside one instance into a single pass. */
let inflight: Promise<State> | null = null;

/** Drop all cached state. Exposed for scripts and tests. */
export function resetCache(): void {
  cache = null;
  journalCache.clear();
  inflight = null;
}

/* ── Load ────────────────────────────────────────────────────── */

/**
 * Current state: newest snapshot plus every journal entry after it.
 *
 * Within DISCOVERY_TTL_MS the cached state is returned as-is; past that
 * the blob store is re-listed. Listing is an API call (not CDN-cached),
 * so a warm instance still sees other instances' writes promptly.
 */
export async function loadState(): Promise<State> {
  if (cache && Date.now() - cache.discoveredAt < DISCOVERY_TTL_MS) return cache.state;
  if (inflight) return inflight;
  inflight = discover().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function discover(): Promise<State> {
  const [snaps, journal] = await Promise.all([listAll(SNAP_PREFIX), listAll(JOURNAL_PREFIX)]);

  const newest = snaps.sort((a, b) => watermarkOf(b.pathname) - watermarkOf(a.pathname))[0];
  const snapWatermark = newest ? watermarkOf(newest.pathname) : 0;

  // Reuse the parsed snapshot when it has not moved — parsing a workbook
  // is by far the most expensive thing here.
  let snapState: State;
  if (cache && cache.snapWatermark === snapWatermark) {
    snapState = cache.snapState;
  } else if (newest) {
    snapState = await workbookBufferToState(await fetchBlob(newest.url));
  } else {
    snapState = emptyState();
  }

  const pending = journal
    .filter((b) => tsOf(b.pathname) > snapWatermark)
    .sort((a, b) => a.pathname.localeCompare(b.pathname));

  const entries = await mapLimit(pending, FETCH_CONCURRENCY, async (b) => {
    const hit = journalCache.get(b.pathname);
    if (hit) return hit;
    const parsed = JSON.parse(Buffer.from(await fetchBlob(b.url)).toString("utf8")) as JournalEntry;
    journalCache.set(b.pathname, parsed);
    return parsed;
  });

  const state = cloneState(snapState);
  const replayed = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    applyOps(state, entries[i].ops ?? []);
    replayed.add(pending[i].pathname);
  }

  // Keep the memo table from growing without bound on a long-lived instance.
  if (journalCache.size > 500) {
    for (const key of journalCache.keys()) {
      if (!replayed.has(key)) journalCache.delete(key);
    }
  }

  cache = { snapWatermark, snapState, state, replayed, discoveredAt: Date.now() };
  return state;
}

/* ── Commit ──────────────────────────────────────────────────── */

/**
 * Append one journal entry and apply it locally.
 *
 * The upload creates a brand-new blob, so two functions committing at
 * the same moment produce two entries and both survive. Ordering between
 * them is by timestamp; concurrent edits to the *same* record resolve
 * last-write-wins, which is what the Airtable layer did too.
 */
export async function commit(ops: Op[]): Promise<void> {
  if (ops.length === 0) return;

  const ts = Date.now();
  const entry: JournalEntry = { v: 1, ts, ops };
  const key = journalKey(ts);

  await put(key, JSON.stringify(entry), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
    token: token(),
  });

  // Reflect the write immediately: callers routinely read back what they
  // just wrote, and re-listing the store would race the CDN.
  if (cache) {
    applyOps(cache.state, ops);
    cache.replayed.add(key);
    journalCache.set(key, entry);
  }

  await maybeCompact();
}

/* ── Compaction ──────────────────────────────────────────────── */

let compactCheckedAt = 0;

/**
 * Fold the journal into a new snapshot once it gets long.
 *
 * Failures here are swallowed: compaction is an optimisation, and a
 * write must not fail because housekeeping did. The next write retries.
 */
async function maybeCompact(): Promise<void> {
  // Cheap guard so a burst of writes does not each list the journal.
  if (Date.now() - compactCheckedAt < 30_000) return;
  compactCheckedAt = Date.now();

  try {
    const journal = await listAll(JOURNAL_PREFIX);
    const cutoff = Date.now() - COMPACT_LAG_MS;
    const foldable = journal.filter((b) => tsOf(b.pathname) <= cutoff);
    if (foldable.length < COMPACT_THRESHOLD) return;
    await compact();
  } catch {
    /* housekeeping only — never fail a write for this */
  }
}

/**
 * Build a fresh snapshot from the newest existing snapshot plus every
 * journal entry up to the lag cutoff, then garbage-collect.
 *
 * Safe to run concurrently with itself: each run writes a uniquely named
 * snapshot, and whichever ends up with the highest watermark wins. A
 * loser's snapshot is simply redundant, never wrong — each one is built
 * from a consistent base plus a contiguous journal range.
 */
export async function compact(): Promise<{ watermark: number; folded: number; key: string } | null> {
  const [snaps, journal] = await Promise.all([listAll(SNAP_PREFIX), listAll(JOURNAL_PREFIX)]);

  const newest = snaps.sort((a, b) => watermarkOf(b.pathname) - watermarkOf(a.pathname))[0];
  const baseWatermark = newest ? watermarkOf(newest.pathname) : 0;
  const base = newest ? await workbookBufferToState(await fetchBlob(newest.url)) : emptyState();

  const cutoff = Date.now() - COMPACT_LAG_MS;
  const foldable = journal
    .filter((b) => {
      const ts = tsOf(b.pathname);
      return ts > baseWatermark && ts <= cutoff;
    })
    .sort((a, b) => a.pathname.localeCompare(b.pathname));

  if (foldable.length === 0) return null;

  const entries = await mapLimit(foldable, FETCH_CONCURRENCY, async (b) => {
    const hit = journalCache.get(b.pathname);
    if (hit) return hit;
    return JSON.parse(Buffer.from(await fetchBlob(b.url)).toString("utf8")) as JournalEntry;
  });

  const next = cloneState(base);
  for (const e of entries) applyOps(next, e.ops ?? []);

  const watermark = cutoff;
  const key = snapshotKey(watermark);
  await put(key, await stateToWorkbookBuffer(next), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    token: token(),
  });

  await gc(watermark);
  return { watermark, folded: foldable.length, key };
}

/**
 * Delete journal entries already folded into a live snapshot, and retire
 * old snapshots.
 *
 * Journal entries survive JOURNAL_GRACE_MS past their watermark so a bad
 * snapshot can be replayed over an older one. Snapshots are retained
 * SNAPSHOTS_KEPT deep as point-in-time recovery material.
 */
async function gc(liveWatermark: number): Promise<void> {
  const graceCutoff = Date.now() - JOURNAL_GRACE_MS;

  const journal = await listAll(JOURNAL_PREFIX);
  const stale = journal
    .filter((b) => {
      const ts = tsOf(b.pathname);
      return ts <= liveWatermark && ts <= graceCutoff;
    })
    .map((b) => b.pathname);

  for (let i = 0; i < stale.length; i += 100) {
    await del(stale.slice(i, i + 100), { token: token() });
  }

  const snaps = (await listAll(SNAP_PREFIX)).sort(
    (a, b) => watermarkOf(b.pathname) - watermarkOf(a.pathname),
  );
  const retire = snaps.slice(SNAPSHOTS_KEPT).map((b) => b.pathname);
  if (retire.length) await del(retire, { token: token() });
}

/* ── Export / bootstrap ──────────────────────────────────────── */

/** The current state as a downloadable .xlsx. */
export async function exportWorkbook(): Promise<Buffer> {
  return stateToWorkbookBuffer(await loadState());
}

/**
 * Write an initial snapshot directly. Used by the Airtable migration —
 * it seeds the store rather than replaying thousands of journal entries.
 */
export async function bootstrapSnapshot(state: State): Promise<string> {
  const watermark = Date.now();
  const key = snapshotKey(watermark);
  await put(key, await stateToWorkbookBuffer(state), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    token: token(),
  });
  resetCache();
  return key;
}

/** Store overview — snapshot count, journal depth, newest watermark. */
export async function storeStatus(): Promise<{
  snapshots: number;
  journalEntries: number;
  watermark: number;
  newestSnapshot: string | null;
}> {
  const [snaps, journal] = await Promise.all([listAll(SNAP_PREFIX), listAll(JOURNAL_PREFIX)]);
  const newest = snaps.sort((a, b) => watermarkOf(b.pathname) - watermarkOf(a.pathname))[0];
  return {
    snapshots: snaps.length,
    journalEntries: journal.length,
    watermark: newest ? watermarkOf(newest.pathname) : 0,
    newestSnapshot: newest ? newest.pathname : null,
  };
}

