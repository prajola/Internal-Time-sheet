#!/usr/bin/env tsx
/**
 * Restore the Excel store from Airtable CSV exports.
 *
 * This is the path to use when Airtable's REST API is unavailable —
 * notably `PUBLIC_API_BILLING_LIMIT_EXCEEDED`, which blocks
 * scripts/migrate-airtable-to-xlsx.ts for the rest of the billing
 * month. Downloading a CSV from the Airtable **web UI** does not touch
 * the public API quota, so this works even when the API is hard-blocked.
 *
 * Getting the CSVs (per table, from airtable.com):
 *   open the base → pick a table → top-right ••• → Download CSV
 *   Repeat for: Users, Tasks, TimeEntries, Invitations, Notifications,
 *   Queries, Holidays. Drop them all in one folder.
 *
 * Usage (from the project root):
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/import-airtable-csv.ts --dir ~/Downloads/airtable
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/import-airtable-csv.ts --dir ~/Downloads/airtable --commit
 *
 * Without --commit it is a dry run: parses everything, writes
 * ./airtable-export.xlsx locally for inspection, and touches nothing
 * remote.
 *
 * Logins: the Users table stores `passwordHash` as plain text, so it
 * survives the CSV round-trip. Employees keep their existing passwords
 * — no resets, no re-invites. The script reports how many users
 * arrived with a usable hash so you can confirm before committing.
 *
 * Safety:
 *   - Every file is parsed before anything is written; a bad file
 *     aborts the whole run rather than importing half the data.
 *   - Refuses to overwrite a non-empty store without --force.
 *   - Missing table files are skipped with a warning, not invented.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

const argv = process.argv.slice(2);
const COMMIT = argv.includes("--commit");
const FORCE = argv.includes("--force");
const dirFlag = argv.indexOf("--dir");
const DIR = dirFlag >= 0 ? argv[dirFlag + 1] : "./airtable-csv";

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

/**
 * RFC 4180 CSV parser.
 *
 * Hand-rolled rather than pulled in as a dependency: Airtable exports
 * quote any field containing a comma, quote or newline, and escape an
 * embedded quote by doubling it. Long task descriptions routinely
 * contain all three, so a naive split(",") corrupts them.
 */
function parseCsv(text: string): string[][] {
  // Strip a UTF-8 BOM — Airtable includes one.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }  // escaped quote
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') { inQuotes = true; }
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r") { /* handled by \n */ }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else { field += c; }
  }
  // Trailing field/row with no closing newline.
  if (field !== "" || row.length) { row.push(field); rows.push(row); }

  return rows.filter((r) => r.some((v) => v !== ""));
}

/** Airtable checkbox columns export as "checked"; be liberal anyway. */
function toBool(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s === "checked" || s === "true" || s === "1" || s === "yes" || s === "x";
}

/**
 * Turn one CSV row into a record of the shape the store expects.
 * Columns are matched by header name, so column order does not matter
 * and extra Airtable columns are ignored.
 */
function rowToRecord(entity: EntityName, header: string[], row: string[]): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const [name, kind] of SCHEMA[entity].columns) {
    const idx = header.indexOf(name);
    const cell = idx >= 0 ? (row[idx] ?? "") : "";
    if (kind === "bool") raw[name] = toBool(cell);
    else if (kind === "num") {
      const n = Number(cell);
      raw[name] = Number.isFinite(n) ? n : 0;
    } else {
      raw[name] = cell;
    }
  }
  return normalizeRecord(entity, raw);
}

/** Find <Table>.csv in DIR, case-insensitively, tolerating suffixes. */
function findFile(table: string): string | null {
  let names: string[];
  try { names = readdirSync(DIR); }
  catch { die(`Cannot read directory: ${DIR}`); }

  const want = table.toLowerCase();
  const hit =
    names.find((n) => n.toLowerCase() === `${want}.csv`) ??
    // Airtable sometimes appends "-Grid view" or a date.
    names.find((n) => n.toLowerCase().startsWith(want) && n.toLowerCase().endsWith(".csv"));
  return hit ? join(DIR, hit) : null;
}

async function main(): Promise<void> {
  const driver = driverName();
  const target =
    driver === "sheets"
      ? `Google Sheet ${process.env.GOOGLE_SHEET_ID ?? "(GOOGLE_SHEET_ID unset)"}`
      : `Vercel Blob ${process.env.XLSX_STORE_PREFIX || "db"}/`;

  if (COMMIT) {
    if (driver === "sheets" && !process.env.GOOGLE_SHEET_ID) {
      die("GOOGLE_SHEET_ID must be set to --commit (run scripts/setup-google-sheet.ts first)");
    }
    if (driver === "xlsx" && !process.env.BLOB_READ_WRITE_TOKEN) {
      die("BLOB_READ_WRITE_TOKEN must be set to --commit");
    }
  }

  console.log(`\n  Airtable CSVs → ${driver === "sheets" ? "Google Sheets" : "Excel store"}`);
  console.log(`  source: ${DIR}`);
  console.log(`  mode:   ${COMMIT ? "COMMIT (replaces the store's contents)" : "dry run (writes nothing remote)"}`);
  console.log(`  target: ${target}\n`);

  // Refuse to silently replace live data.
  if (COMMIT && !FORCE) {
    if (driver === "sheets") {
      const s = await sheetsStatus();
      if (s.records > 0) {
        die(`Sheet already holds ${s.records} record(s). Re-run with --force to replace them.`);
      }
    } else {
      const status = await storeStatus();
      if (status.snapshots > 0 || status.journalEntries > 0) {
        die(
          `Store is not empty (${status.snapshots} snapshot(s), ${status.journalEntries} journal ` +
            `entries). Re-run with --force only if you intend to replace it.`,
        );
      }
    }
  }

  // Parse everything first — a bad file must not produce a half import.
  const state = emptyState();
  const missing: string[] = [];
  const skipped: string[] = [];
  let total = 0;

  for (const entity of ENTITIES) {
    const file = findFile(TABLE[entity]);
    if (!file) {
      missing.push(TABLE[entity]);
      console.log(`    ${SCHEMA[entity].sheet.padEnd(14)} ${"—".padStart(6)}  (no CSV found)`);
      continue;
    }

    const rows = parseCsv(readFileSync(file, "utf8"));
    if (rows.length === 0) {
      console.log(`    ${SCHEMA[entity].sheet.padEnd(14)} ${"0".padStart(6)} records  (empty file)`);
      continue;
    }

    const header = rows[0].map((h) => h.trim());
    if (!header.includes("id")) {
      die(`${file}: no "id" column. Is this an Airtable export of the ${TABLE[entity]} table?`);
    }

    let kept = 0;
    for (const row of rows.slice(1)) {
      const rec = rowToRecord(entity, header, row);
      const id = rec.id;
      if (typeof id !== "string" || !id) { skipped.push(`${TABLE[entity]}: row with no id`); continue; }
      state[entity].set(id, rec);
      kept++;
    }
    total += kept;
    console.log(`    ${SCHEMA[entity].sheet.padEnd(14)} ${String(kept).padStart(6)} records`);
  }

  console.log(`\n    ${"TOTAL".padEnd(14)} ${String(total).padStart(6)} records`);

  // Logins are the thing most likely to go wrong — report on them loudly.
  const users = [...state.users.values()];
  const withHash = users.filter((u) => typeof u.passwordHash === "string" && u.passwordHash.length > 0);
  const admins = users.filter((u) => u.role === "ADMIN");
  console.log(`\n  Logins:`);
  console.log(`    ${withHash.length}/${users.length} users have a password hash (they keep their current password)`);
  console.log(`    ${users.length - withHash.length} will need "Set password" or a reset link`);
  console.log(`    ${admins.length} admin(s): ${admins.map((a) => a.email).join(", ") || "(none)"}`);
  if (admins.length === 0) {
    console.log(`    ⚠  no ADMIN in the import — you would be locked out of the Manage page.`);
  }

  if (missing.length) console.log(`\n  ⚠  no CSV for: ${missing.join(", ")} — those tables import as empty.`);
  if (skipped.length) console.log(`  ⚠  skipped ${skipped.length} row(s) with no id`);

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
