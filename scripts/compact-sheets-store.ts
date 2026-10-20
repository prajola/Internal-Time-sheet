#!/usr/bin/env tsx
/**
 * Fold the Google Sheets journal into the entity tabs.
 *
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/compact-sheets-store.ts
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/compact-sheets-store.ts --status
 *
 * Reads stay fast regardless (only the journal tail is fetched), so
 * this is housekeeping, not a correctness requirement. It keeps the
 * entity tabs readable for a human opening the spreadsheet, and keeps
 * the journal from growing without bound.
 *
 * Run it from one place at a time — nightly cron is ideal. Two
 * compactions racing could interleave their tab writes and watermark
 * updates; one at a time cannot.
 *
 * The journal is never deleted, so a failed run is always safe to
 * repeat: unfolded rows are simply replayed on the next read.
 */
import { compact, storeStatus } from "../api/_lib/sheets-store.js";

function die(msg: string): never {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (!process.env.GOOGLE_SHEET_ID) die("GOOGLE_SHEET_ID is not set");

  const before = await storeStatus();
  console.log(`\n  records: ${before.records}   journal: ${before.journalTotal} row(s), ${before.journalPending} pending`);

  if (process.argv.includes("--status")) {
    for (const [name, n] of Object.entries(before.perEntity)) {
      console.log(`    ${name.padEnd(14)} ${String(n).padStart(6)}`);
    }
    console.log();
    return;
  }

  if (before.journalPending === 0) {
    console.log("\n  Nothing pending — tabs are already up to date.\n");
    return;
  }

  const r = await compact();
  console.log(`\n  ✓ folded ${r.folded} journal row(s); ${r.records} record(s) written to the tabs\n`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
