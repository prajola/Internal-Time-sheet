/**
 * Storage driver selection.
 *
 * `db.ts` talks to this, never to a driver directly, so swapping the
 * backend is an env var rather than a code change:
 *
 *   STORAGE_DRIVER=sheets   Google Sheets          (default)
 *   STORAGE_DRIVER=xlsx     Excel workbook in Vercel Blob
 *
 * Both drivers implement the same two-function contract — loadState()
 * and commit(ops) — over the shared schema in ./store-schema.ts, and
 * both use the same append-only journal approach so concurrent writes
 * cannot clobber each other.
 *
 * The xlsx driver is kept as a working fallback: if Google is
 * unreachable or a credential expires, flipping one env var moves the
 * app back onto Blob storage without a deploy of new code.
 */
import type { Op, State } from "./store-schema.js";
import * as sheets from "./sheets-store.js";
import * as xlsx from "./xlsx-store.js";

export type DriverName = "sheets" | "xlsx";

export function driverName(): DriverName {
  const raw = (process.env.STORAGE_DRIVER || "sheets").trim().toLowerCase();
  if (raw === "xlsx" || raw === "blob" || raw === "excel") return "xlsx";
  if (raw === "sheets" || raw === "google" || raw === "gsheets") return "sheets";
  // An unrecognised value is a misconfiguration worth surfacing rather
  // than silently guessing — but not at the cost of a dead app.
  console.warn(`[store] unknown STORAGE_DRIVER="${raw}", falling back to "sheets"`);
  return "sheets";
}

export async function loadState(): Promise<State> {
  return driverName() === "xlsx" ? xlsx.loadState() : sheets.loadState();
}

export async function commit(ops: Op[]): Promise<void> {
  return driverName() === "xlsx" ? xlsx.commit(ops) : sheets.commit(ops);
}

export function resetCache(): void {
  // Both, deliberately: scripts switch drivers mid-process.
  xlsx.resetCache();
  sheets.resetCache();
}

/**
 * The whole dataset as a downloadable .xlsx.
 *
 * Available on either driver — under Sheets it reads the live state and
 * renders a workbook, which keeps the admin "download the database"
 * button working regardless of backend.
 */
export async function exportWorkbook(): Promise<Buffer> {
  if (driverName() === "xlsx") return xlsx.exportWorkbook();
  return xlsx.stateToWorkbookBuffer(await sheets.loadState());
}

export { normalizeRecord, SCHEMA, ENTITIES, emptyState } from "./store-schema.js";
export type { EntityName, Op, State } from "./store-schema.js";
