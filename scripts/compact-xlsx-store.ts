#!/usr/bin/env tsx
/**
 * Fold the journal into a fresh snapshot, then garbage-collect.
 *
 * Usage (from the project root):
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/compact-xlsx-store.ts
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/compact-xlsx-store.ts --status
 *
 * The app compacts itself opportunistically once the journal passes its
 * threshold, so this is not required for correctness. It exists for two
 * cases: a store that has gone quiet with a long journal (nobody is
 * writing, so nothing triggers the opportunistic path), and as a
 * scheduled safety net — a GitHub Actions cron calling this nightly
 * keeps reads fast and snapshots recent no matter the traffic pattern.
 *
 * Safe to run at any time, including against a live store and alongside
 * itself: snapshots are immutable and uniquely named, and whichever
 * carries the highest watermark wins.
 */
import { compact, storeStatus } from "../api/_lib/xlsx-store.js";

async function main(): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("\n  ✗ BLOB_READ_WRITE_TOKEN is not set\n");
    process.exit(1);
  }

  const before = await storeStatus();
  console.log(`\n  snapshots: ${before.snapshots}   journal: ${before.journalEntries} entries`);
  console.log(`  newest:    ${before.newestSnapshot ?? "(none — store is empty)"}`);

  if (process.argv.includes("--status")) {
    console.log();
    return;
  }

  const result = await compact();
  if (!result) {
    console.log("\n  Nothing to fold (journal is empty or everything is inside the 5-minute lag).\n");
    return;
  }

  const after = await storeStatus();
  console.log(`\n  ✓ folded ${result.folded} journal entries into ${result.key}`);
  console.log(`  snapshots: ${after.snapshots}   journal: ${after.journalEntries} entries\n`);
}

main().catch((e) => {
  console.error(`\n  ✗ ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
