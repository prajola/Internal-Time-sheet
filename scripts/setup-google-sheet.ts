#!/usr/bin/env tsx
/**
 * Prepare (and check) the Google Sheet the app stores its data in.
 *
 * Usage (from the project root):
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/setup-google-sheet.ts
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/setup-google-sheet.ts --status
 *
 * Creates any missing tabs (one per entity, plus _Journal and _Meta)
 * and writes their header rows. Safe to re-run: existing tabs are left
 * untouched, so it never destroys data.
 *
 * Run this first — before any import — and it will tell you plainly
 * which piece of the setup is wrong rather than failing deep inside a
 * migration.
 */
import { ping, listTabs } from "../api/_lib/google-sheets.js";
import { ensureSchema, storeStatus } from "../api/_lib/sheets-store.js";

const STATUS_ONLY = process.argv.includes("--status");

const REQUIRED = [
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
  "GOOGLE_SHEET_ID",
] as const;

function die(msg: string): never {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  console.log("\n  Google Sheets storage — setup check\n");

  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    die(
      `missing env var(s): ${missing.join(", ")}\n\n` +
        `     1. Google Cloud console → create a service account\n` +
        `     2. Enable the Google Sheets API for that project\n` +
        `     3. Create a JSON key; copy client_email and private_key\n` +
        `     4. Share the spreadsheet with that client_email as an Editor\n` +
        `     5. GOOGLE_SHEET_ID is the id in the sheet's URL:\n` +
        `        docs.google.com/spreadsheets/d/<THIS PART>/edit`,
    );
  }
  console.log(`    service account  ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL}`);
  console.log(`    spreadsheet id   ${process.env.GOOGLE_SHEET_ID}`);

  // Reachability first — this is where a mis-shared sheet shows up, and
  // the client turns a 403 into "share it with this address".
  let info;
  try {
    info = await ping();
  } catch (e) {
    die(e instanceof Error ? e.message : String(e));
  }
  console.log(`\n  ✓ reachable — "${info.title}" (${info.tabs} tab(s))`);

  if (!STATUS_ONLY) {
    const { created } = await ensureSchema();
    if (created.length) console.log(`  ✓ created tab(s): ${created.join(", ")}`);
    else console.log("  ✓ all tabs already present — nothing to create");
  }

  const tabs = await listTabs();
  console.log(`\n  Tabs: ${tabs.map((t) => t.title).join(", ")}`);

  const status = await storeStatus();
  console.log(`\n  Records: ${status.records}`);
  for (const [name, n] of Object.entries(status.perEntity)) {
    console.log(`    ${name.padEnd(14)} ${String(n).padStart(6)}`);
  }
  console.log(`\n  Journal: ${status.journalTotal} row(s), ${status.journalPending} not yet folded`);
  console.log(
    status.records === 0
      ? "\n  Store is empty — import data with scripts/import-airtable-csv.ts\n"
      : "\n  Store has data.\n",
  );
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
