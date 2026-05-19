#!/usr/bin/env node
/**
 * One-off migration: copy all blobs from the Vercel Blob store into the
 * local-file backend that STORAGE_DRIVER=local reads from.
 *
 * Usage (from the project root):
 *   node --env-file=.env.development.local scripts/migrate-blob-to-local.mjs
 *
 * Requires BLOB_READ_WRITE_TOKEN to be set and the store to be readable.
 * If the store is still suspended ("Your store is blocked"), the script
 * reports which blobs it could not read and exits non-zero WITHOUT
 * touching the local store. Re-run after the store is unsuspended.
 *
 * Safety:
 *   - The blob store is opened read-only (list + fetch); never written or deleted.
 *   - All blob content is fetched into memory first. The local store is
 *     only modified if every fetch succeeded — "all or nothing".
 *   - Any existing local files are renamed to <ROOT>.backup-<timestamp>/
 *     before the new content is written, so nothing is silently overwritten.
 *   - No other part of the app is imported or invoked.
 */
import { list } from "@vercel/blob";
import { mkdir, writeFile, readdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const ROOT =
  process.env.LOCAL_STORAGE_ROOT ||
  path.join(homedir(), ".kubegraf-timesheet", "storage");

async function hasAnyFiles(dir) {
  try {
    return (await readdir(dir)).length > 0;
  } catch (e) {
    if (e?.code === "ENOENT") return false;
    throw e;
  }
}

async function backupExisting() {
  if (!(await hasAnyFiles(ROOT))) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${ROOT}.backup-${stamp}`;
  await rename(ROOT, backup);
  return backup;
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error(
      "BLOB_READ_WRITE_TOKEN is not set. Run with: node --env-file=.env.development.local scripts/migrate-blob-to-local.mjs",
    );
    process.exit(2);
  }

  console.log("Source: Vercel Blob store");
  console.log("Target:", ROOT);

  console.log("\nListing blobs…");
  const { blobs } = await list({ prefix: "" });
  console.log(`Found ${blobs.length} blob(s).`);
  if (blobs.length === 0) {
    console.log("Nothing to migrate.");
    return;
  }

  // Phase 1 — fetch everything into memory. Abort before touching disk
  // if any fetch fails, so the local store stays consistent.
  console.log("\nFetching content…");
  const payloads = [];
  const failures = [];
  for (const b of blobs) {
    const url = `${b.url}${b.url.includes("?") ? "&" : "?"}_=${Date.now()}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 160);
        failures.push(`${b.pathname} — HTTP ${res.status}: ${body}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      payloads.push({ pathname: b.pathname, buf });
      console.log(`  ok  ${b.pathname} (${buf.length} bytes)`);
    } catch (e) {
      failures.push(`${b.pathname} — fetch error: ${e?.message ?? e}`);
    }
  }

  if (failures.length) {
    console.error(
      `\n${failures.length} of ${blobs.length} blob(s) failed to read:`,
    );
    for (const f of failures) console.error("  -", f);
    console.error(
      "\nLocal store NOT modified. Re-run after the blob store is unsuspended.",
    );
    process.exit(1);
  }

  // Phase 2 — back up existing local, then write everything.
  const backup = await backupExisting();
  if (backup) console.log(`\nExisting local store moved to: ${backup}`);
  else console.log("\nNo existing local store — writing fresh.");

  for (const { pathname, buf } of payloads) {
    const full = path.join(ROOT, pathname);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, buf);
  }

  console.log(
    `\nMigration complete: ${payloads.length} file(s) written under ${ROOT}`,
  );
}

main().catch((e) => {
  console.error("Fatal:", e?.message ?? e);
  process.exit(1);
});
