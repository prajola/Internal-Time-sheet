/**
 * Google Sheets storage driver.
 *
 * The spreadsheet is the system of record. One tab per entity holding
 * one row per record, plus two bookkeeping tabs:
 *
 *   Users, Tasks, TimeEntries, …   the compacted data — what you read
 *   _Journal                       append-only log of recent writes
 *   _Meta                          how much of the journal is folded in
 *
 * Why a journal rather than editing rows in place: updating a row means
 * find-the-row-then-write-that-range, and two functions doing that at
 * once will overwrite each other — the same lost-update problem that
 * killed the old Vercel Blob backend. Sheets has no compare-and-swap.
 *
 * `values.append`, though, resolves the insertion point server-side:
 * two simultaneous appends produce two rows, never one clobbering the
 * other. So every write is an append, and reads replay the journal over
 * the entity tabs.
 *
 * Nothing is ever deleted or rewritten on the write path. Compaction
 * (an explicit operation — see scripts/compact-sheets-store.ts) folds
 * the journal into the entity tabs and advances a watermark in _Meta.
 * It never clears the journal, so a compaction that dies halfway cannot
 * destroy writes; the worst case is that they are replayed again.
 *
 * Quotas: Sheets limits are per-minute, not per-month. A 429 here
 * clears in seconds and is retried automatically — unlike Airtable's
 * monthly cap, which took the app down for a billing cycle.
 */
import {
  ENTITIES,
  SCHEMA,
  applyOps,
  cloneState,
  decodeCell,
  emptyState,
  type EntityName,
  type Op,
  type State,
} from "./store-schema.js";
import { getSheetsApi } from "./google-sheets.js";

export const JOURNAL_TAB = "_Journal";
export const META_TAB = "_Meta";

/** Re-check the spreadsheet at most this often within one warm instance. */
const DISCOVERY_TTL_MS = 2_000;

/* ── Meta helpers ────────────────────────────────────────────── */

/**
 * _Meta is a simple key/value tab. Only one key matters today —
 * `journalRows`, the number of journal data rows already folded into
 * the entity tabs — but a tab beats a magic cell for anything we need
 * to add later.
 */
function metaFromRows(rows: string[][]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows.slice(1)) {
    if (r[0]) out[String(r[0])] = String(r[1] ?? "");
  }
  return out;
}

/* ── Cache (per warm lambda instance) ────────────────────────── */

interface Cached {
  state: State;
  /** Journal rows folded into `state`, as an absolute count. */
  journalConsumed: number;
  discoveredAt: number;
}

let cache: Cached | null = null;
let inflight: Promise<State> | null = null;

export function resetCache(): void {
  cache = null;
  inflight = null;
}

/* ── Load ────────────────────────────────────────────────────── */

/**
 * Current state: the entity tabs with every unfolded journal row
 * replayed on top.
 *
 * Only the journal tail is fetched (from the watermark onwards), so the
 * read cost stays flat as the journal grows.
 */
export async function loadState(): Promise<State> {
  if (cache && Date.now() - cache.discoveredAt < DISCOVERY_TTL_MS) return cache.state;
  if (inflight) return inflight;
  inflight = discover().finally(() => { inflight = null; });
  return inflight;
}

async function discover(): Promise<State> {
  // One batched request for everything: entity tabs, meta, journal.
  const ranges = [...ENTITIES.map((e) => SCHEMA[e].sheet), META_TAB, JOURNAL_TAB];
  const results = await getSheetsApi().batchRead(ranges);

  const state = emptyState();
  ENTITIES.forEach((entity, i) => {
    const rows = results[i];
    if (!rows || rows.length === 0) return;

    // Trust the header row rather than column order — a sheet edited by
    // hand may have had columns moved.
    const header = rows[0].map((h) => String(h ?? "").trim());
    const colOf = new Map<string, number>();
    header.forEach((name, idx) => { if (name) colOf.set(name, idx); });

    for (const row of rows.slice(1)) {
      const rec: Record<string, unknown> = {};
      for (const [name, kind] of SCHEMA[entity].columns) {
        const idx = colOf.get(name);
        const decoded = decodeCell(idx === undefined ? null : row[idx], kind);
        if (decoded !== undefined) rec[name] = decoded;
      }
      const id = rec.id;
      if (typeof id === "string" && id) state[entity].set(id, rec);
    }
  });

  const meta = metaFromRows(results[ENTITIES.length] ?? []);
  const consumed = Number(meta.journalRows || 0) || 0;

  // Journal rows: index 0 is the header, so data row N is at index N.
  const journalRows = results[ENTITIES.length + 1] ?? [];
  const pending = journalRows.slice(1 + consumed);

  let applied = consumed;
  for (const row of pending) {
    const payload = row[1];
    if (!payload) { applied++; continue; }       // blank line — still counts as consumed
    try {
      const ops = JSON.parse(String(payload)) as Op[];
      applyOps(state, ops);
    } catch {
      // A hand-mangled journal row must not take the whole app down;
      // skip it and carry on. Compaction will drop it.
    }
    applied++;
  }

  cache = { state, journalConsumed: applied, discoveredAt: Date.now() };
  return state;
}

/* ── Commit ──────────────────────────────────────────────────── */

/**
 * Append one journal row and apply it locally.
 *
 * A single append per write, so a busy moment costs one API call each
 * rather than a read-modify-write cycle per record.
 */
export async function commit(ops: Op[]): Promise<void> {
  if (ops.length === 0) return;

  const ts = new Date().toISOString();
  await getSheetsApi().appendRows(JOURNAL_TAB, [[ts, JSON.stringify(ops)]]);

  // Reflect the write immediately — callers routinely read back what
  // they just wrote, and re-reading the sheet would race the API.
  if (cache) {
    applyOps(cache.state, ops);
    cache.journalConsumed++;
  }
}

/* ── Compaction ──────────────────────────────────────────────── */

/**
 * Fold the journal into the entity tabs and advance the watermark.
 *
 * Order matters: the entity tabs are written first, the watermark last.
 * If this dies in between, the journal rows are simply replayed on the
 * next read — never lost. The reverse order could skip them.
 *
 * Run this from scripts/compact-sheets-store.ts (or a cron), not from
 * the request path: two compactions racing could interleave their tab
 * writes and watermark updates. One operator-run compaction at a time
 * has no such problem.
 */
export async function compact(): Promise<{ folded: number; records: number }> {
  resetCache();
  const state = await loadState();
  const consumed = cache?.journalConsumed ?? 0;

  let records = 0;
  for (const entity of ENTITIES) {
    const spec = SCHEMA[entity];
    const header = spec.columns.map(([name]) => name);
    const rows: Array<Array<string | number | boolean>> = [header];

    for (const rec of state[entity].values()) {
      rows.push(
        spec.columns.map(([name, kind]) => {
          const v = (rec as Record<string, unknown>)[name];
          if (kind === "bool") return v === true;
          if (kind === "num") return typeof v === "number" && Number.isFinite(v) ? v : 0;
          return v === null || v === undefined ? "" : String(v);
        }),
      );
      records++;
    }
    await getSheetsApi().writeTab(spec.sheet, rows);
  }

  await getSheetsApi().writeTab(META_TAB, [
    ["key", "value"],
    ["journalRows", String(consumed)],
    ["compactedAt", new Date().toISOString()],
  ]);

  resetCache();
  return { folded: consumed, records };
}

/* ── Setup / status ──────────────────────────────────────────── */

/**
 * Create any missing tabs and write header rows.
 *
 * Safe to re-run: existing tabs are left exactly as they are, so this
 * never touches data.
 */
export async function ensureSchema(): Promise<{ created: string[] }> {
  const wanted = [...ENTITIES.map((e) => SCHEMA[e].sheet), JOURNAL_TAB, META_TAB];
  const created = await getSheetsApi().ensureTabs(wanted);

  // Header rows, only for tabs that were just created.
  for (const entity of ENTITIES) {
    const spec = SCHEMA[entity];
    if (!created.includes(spec.sheet)) continue;
    await getSheetsApi().writeTab(spec.sheet, [spec.columns.map(([name]) => name)]);
  }
  if (created.includes(JOURNAL_TAB)) await getSheetsApi().writeTab(JOURNAL_TAB, [["ts", "ops"]]);
  if (created.includes(META_TAB)) await getSheetsApi().writeTab(META_TAB, [["key", "value"], ["journalRows", "0"]]);

  return { created };
}

/** Replace all data outright. Used by the migration scripts only. */
export async function bootstrapState(next: State): Promise<{ records: number }> {
  await ensureSchema();

  let records = 0;
  for (const entity of ENTITIES) {
    const spec = SCHEMA[entity];
    const rows: Array<Array<string | number | boolean>> = [spec.columns.map(([n]) => n)];
    for (const rec of next[entity].values()) {
      rows.push(
        spec.columns.map(([name, kind]) => {
          const v = (rec as Record<string, unknown>)[name];
          if (kind === "bool") return v === true;
          if (kind === "num") return typeof v === "number" && Number.isFinite(v) ? v : 0;
          return v === null || v === undefined ? "" : String(v);
        }),
      );
      records++;
    }
    await getSheetsApi().writeTab(spec.sheet, rows);
  }

  // A fresh import starts from an empty journal.
  await getSheetsApi().writeTab(JOURNAL_TAB, [["ts", "ops"]]);
  await getSheetsApi().writeTab(META_TAB, [
    ["key", "value"],
    ["journalRows", "0"],
    ["importedAt", new Date().toISOString()],
  ]);

  resetCache();
  return { records };
}

export async function storeStatus(): Promise<{
  records: number;
  journalPending: number;
  journalTotal: number;
  perEntity: Record<string, number>;
}> {
  resetCache();
  const state = await loadState();
  const [meta, journal] = await getSheetsApi().batchRead([META_TAB, JOURNAL_TAB]);
  const consumed = Number(metaFromRows(meta ?? []).journalRows || 0) || 0;
  const journalTotal = Math.max(0, (journal?.length ?? 1) - 1);

  const perEntity: Record<string, number> = {};
  let records = 0;
  for (const e of ENTITIES) {
    perEntity[SCHEMA[e].sheet] = state[e].size;
    records += state[e].size;
  }
  return { records, journalPending: journalTotal - consumed, journalTotal, perEntity };
}

export { cloneState };
