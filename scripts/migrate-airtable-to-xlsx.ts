#!/usr/bin/env tsx
/**
 * One-off migration: copy every Airtable record into the Excel store.
 *
 * Usage (from the project root):
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/migrate-airtable-to-xlsx.ts
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/migrate-airtable-to-xlsx.ts --commit
 *
 * Without --commit this is a dry run: it reads Airtable, builds the
 * workbook in memory, writes it to ./airtable-export.xlsx so you can
 * open it and check, and touches nothing in Vercel Blob.
 *
 * Safety:
 *   - Airtable is opened read-only (list only); never written or deleted.
 *   - Every table is fetched in full before anything is written, so a
 *     partial read can never produce a partial migration.
 *   - Refuses to overwrite a non-empty Excel store unless --force is
 *     given, so a second accidental run cannot clobber live data.
 *   - Records are coerced through the same normalizeRecord() the runtime
 *     uses, so what lands here is byte-identical to what the app writes.
 *
 * Requires AIRTABLE_TOKEN, AIRTABLE_BASE_ID and BLOB_READ_WRITE_TOKEN.
 */
import { writeFileSync } from "node:fs";
import {
  ENTITIES,
  SCHEMA,
  emptyState,
  normalizeRecord,
  type EntityName,
} from "../api/_lib/store-schema.js";
import { bootstrapSnapshot, stateToWorkbookBuffer, storeStatus } from "../api/_lib/xlsx-store.js";
import { bootstrapState, ensureSchema, storeStatus as sheetsStatus } from "../api/_lib/sheets-store.js";
import { driverName } from "../api/_lib/store.js";

const argvHas = (flag: string) => process.argv.includes(flag);
const COMMIT = argvHas("--commit");
const FORCE = argvHas("--force");

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = process.env.AIRTABLE_BASE_ID;

/** Airtable table name per entity — mirrors the old db.ts TABLE map. */
const TABLE: Record<EntityName, string> = {
  users: "Users",
  tasks: "Tasks",
  timeEntries: "TimeEntries",
  invitations: "Invitations",
  notifications: "Notifications",
  queries: "Queries",
  holidays: "Holidays",
};

function die(msg: string): never {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}

async function listAirtable(table: string): Promise<Array<Record<string, any>>> {
  const out: Array<Record<string, any>> = [];
  let offset: string | undefined;
  do {
    const qs = new URLSearchParams({ pageSize: "100" });
    if (offset) qs.set("offset", offset);
    const url = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(table)}?${qs}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (r.status === 404) {
      console.log(`    (no ${table} table — skipping)`);
      return out;
    }
    if (!r.ok) die(`Airtable list ${table}: HTTP ${r.status} ${await r.text()}`);
    const data = (await r.json()) as { records?: Array<{ fields?: any }>; offset?: string };
    for (const rec of data.records ?? []) out.push(rec.fields ?? {});
    offset = data.offset;
    if (offset) await new Promise((res) => setTimeout(res, 250)); // 5 req/sec/base
  } while (offset);
  return out;
}

async function main(): Promise<void> {
  if (!TOKEN || !BASE) die("AIRTABLE_TOKEN and AIRTABLE_BASE_ID must be set");

  const driver = driverName();
  if (COMMIT) {
    if (driver === "sheets" && !process.env.GOOGLE_SHEET_ID) {
      die("GOOGLE_SHEET_ID must be set to --commit (run scripts/setup-google-sheet.ts first)");
    }
    if (driver === "xlsx" && !process.env.BLOB_READ_WRITE_TOKEN) {
      die("BLOB_READ_WRITE_TOKEN must be set to --commit");
    }
  }

  console.log(`\n  Airtable base ${BASE} → ${driver === "sheets" ? "Google Sheets" : "Excel store"}`);
  console.log(`  mode: ${COMMIT ? "COMMIT (replaces the store's contents)" : "dry run (writes nothing remote)"}\n`);

  if (COMMIT && !FORCE) {
    if (driver === "sheets") {
      const s = await sheetsStatus();
      if (s.records > 0) die(`Sheet already holds ${s.records} record(s). Re-run with --force to replace them.`);
    } else {
      const status = await storeStatus();
      if (status.snapshots > 0 || status.journalEntries > 0) {
        die(
          `Excel store is not empty (${status.snapshots} snapshot(s), ` +
            `${status.journalEntries} journal entries). Re-run with --force only if ` +
            `you intend to seed over it.`,
        );
      }
    }
  }

  // Read everything first — a partial read must never become a partial migration.
  const state = emptyState();
  let total = 0;
  const skipped: string[] = [];

  for (const entity of ENTITIES) {
    const rows = await listAirtable(TABLE[entity]);
    let kept = 0;
    for (const fields of rows) {
      const id = fields.id;
      if (typeof id !== "string" || !id) {
        skipped.push(`${TABLE[entity]}: row with no id column`);
        continue;
      }
      state[entity].set(id, normalizeRecord(entity, fields));
      kept++;
    }
    total += kept;
    console.log(`    ${SCHEMA[entity].sheet.padEnd(14)} ${String(kept).padStart(6)} records`);
  }

  console.log(`\n    ${"TOTAL".padEnd(14)} ${String(total).padStart(6)} records`);
  if (skipped.length) {
    console.log(`\n  ⚠  skipped ${skipped.length} row(s) with no id:`);
    for (const s of skipped.slice(0, 10)) console.log(`       ${s}`);
  }

  // Logins are the thing most likely to go wrong — report on them loudly.
  const users = [...state.users.values()];
  const withHash = users.filter((u) => typeof u.passwordHash === "string" && u.passwordHash.length > 0);
  const admins = users.filter((u) => u.role === "ADMIN");
  console.log(`\n  Logins:`);
  console.log(`    ${withHash.length}/${users.length} users have a password hash (they keep their current password)`);
  console.log(`    ${users.length - withHash.length} will need "Set password" or a reset link`);
  console.log(`    ${admins.length} admin(s): ${admins.map((a) => a.email).join(", ") || "(none)"}`);

  // Sanity guards. These matter most when nobody is watching — the
  // unattended watcher (scripts/await-airtable-migrate.sh) runs this
  // with --commit, and a partially-readable Airtable must not be allowed
  // to overwrite the store with a husk. --skip-guards overrides.
  if (COMMIT && !argvHas("--skip-guards")) {
    const problems: string[] = [];
    if (total === 0) problems.push("Airtable returned 0 records across every table");
    if (users.length === 0) problems.push("no users — everyone would be locked out");
    if (admins.length === 0) problems.push("no ADMIN user — the Manage page would be unreachable");
    if (users.length > 0 && withHash.length === 0) problems.push("not one user has a password hash — nobody could sign in");
    if (problems.length) {
      die(
        `refusing to commit:\n       - ${problems.join("\n       - ")}\n\n` +
          `     Nothing was written. Re-run with --skip-guards to override.`,
      );
    }
  }

  const buf = await stateToWorkbookBuffer(state);
  writeFileSync("airtable-export.xlsx", buf);
  console.log(`\n  Wrote local copy: airtable-export.xlsx (${(buf.length / 1024).toFixed(0)} KB)`);

  if (!COMMIT) {
    console.log(`\n  Dry run — nothing written to ${driver === "sheets" ? "Google Sheets" : "Vercel Blob"}.`);
    console.log("  Open the workbook, confirm it looks right, then re-run with --commit.\n");
    return;
  }

  if (driver === "sheets") {
    await ensureSchema();
    const { records } = await bootstrapState(state);
    console.log(`\n  ✓ Wrote ${records} record(s) into the Google Sheet`);
    console.log(`    https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}/edit`);
  } else {
    const key = await bootstrapSnapshot(state);
    console.log(`\n  ✓ Snapshot written: ${key}`);
  }
  console.log("  The app serves this data on its next request.\n");
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
