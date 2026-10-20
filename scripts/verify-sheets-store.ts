#!/usr/bin/env tsx
/**
 * Verify the Google Sheets storage logic against an in-memory
 * spreadsheet — no Google account, no network, no credentials.
 *
 *   node_modules/.bin/tsx scripts/verify-sheets-store.ts
 *
 * The fake implements the three Sheets behaviours the design leans on:
 * batchRead returns ranges positionally, append always lands after the
 * last row (so two concurrent appends produce two rows), and writeTab
 * replaces a tab wholesale. Everything above that — journal replay, the
 * compaction watermark, read-your-own-writes — is the real driver.
 *
 * This deliberately does not test Google's API. It tests the parts this
 * project invented, which are the parts that can be wrong.
 */
import { setSheetsApi, type SheetsApi } from "../api/_lib/google-sheets.js";
import { ENTITIES, SCHEMA } from "../api/_lib/store-schema.js";

/* ── In-memory spreadsheet ───────────────────────────────────── */

const tabs = new Map<string, Array<Array<string | number | boolean>>>();
let appendCount = 0;

const fake: SheetsApi = {
  async batchRead(ranges) {
    return ranges.map((r) => (tabs.get(r) ?? []).map((row) => row.map((c) => c as string)));
  },
  async appendRows(title, rows) {
    appendCount++;
    // Mirrors Sheets: the insertion point is resolved server-side at
    // write time, so interleaved callers cannot overwrite each other.
    const t = tabs.get(title) ?? [];
    t.push(...rows);
    tabs.set(title, t);
  },
  async writeTab(title, rows) {
    tabs.set(title, rows.map((r) => [...r]));
  },
  async ensureTabs(titles) {
    const created: string[] = [];
    for (const t of titles) if (!tabs.has(t)) { tabs.set(t, []); created.push(t); }
    return created;
  },
  async listTabs() {
    return [...tabs.keys()].map((title, i) => ({ title, sheetId: i, rowCount: tabs.get(title)!.length }));
  },
  async ping() {
    return { title: "fake", tabs: tabs.size };
  },
};

setSheetsApi(fake);

// Imported after the transport is swapped so the driver never reaches
// for real credentials.
const store = await import("../api/_lib/sheets-store.js");
const db = await import("../api/_lib/db.js");

process.env.STORAGE_DRIVER = "sheets";

let failures = 0;
function check(name: string, pass: boolean, detail = ""): void {
  console.log(`   ${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

const iso = (ms = 0) => new Date(1760000000000 + ms).toISOString();

async function main(): Promise<void> {
  console.log("\n  Google Sheets store — logic verification (in-memory)\n");

  console.log("  1. schema setup");
  await store.ensureSchema();
  const titles = (await fake.listTabs()).map((t) => t.title);
  check("a tab per entity plus _Journal and _Meta",
        ENTITIES.every((e) => titles.includes(SCHEMA[e].sheet)) &&
        titles.includes("_Journal") && titles.includes("_Meta"),
        `${titles.length} tabs`);
  check("ensureSchema is idempotent", (await store.ensureSchema()).created.length === 0);

  /* 2. Write → read-back ─────────────────────────────────────── */
  console.log("\n  2. write and read back");
  store.resetCache();
  await db.upsertUser({
    id: "u1", email: "Ada@kubegraf.io", name: "Ada", role: "ADMIN", active: true,
    createdAt: iso(), passwordHash: "$2a$10$hash", passwordSetAt: null, sessionsRevokedAt: null,
  } as any);
  store.resetCache();
  const u = await db.findUserById("u1");
  check("user survives a cache drop", u?.email === "Ada@kubegraf.io");
  check("boolean stays boolean", u?.active === true && typeof u?.active === "boolean");
  check("null stays null", u?.passwordSetAt === null);
  check("password hash intact", u?.passwordHash === "$2a$10$hash");
  check("write went to the journal, not the tab",
        (tabs.get("_Journal")?.length ?? 0) === 2 && (tabs.get("Users")?.length ?? 0) === 1,
        "entity tab still header-only");

  /* 3. Concurrent writers ────────────────────────────────────── */
  console.log("\n  3. concurrent writers");
  const N = 25;
  await Promise.all(Array.from({ length: N }, (_, i) =>
    db.upsertTask({
      id: `t${i}`, title: `task ${i}`, description: "", assigneeId: null,
      status: "TODO", priority: "MEDIUM", dueDate: null,
      createdAt: iso(i), updatedAt: iso(i), createdBy: "u1",
    } as any)));
  store.resetCache();
  const tasks = await db.listTasks();
  check(`all ${N} concurrent writes survived`, tasks.length === N, `found ${tasks.length}`);
  check("every title distinct and present",
        new Set(tasks.map((t) => t.title)).size === N);

  /* 4. Compaction ────────────────────────────────────────────── */
  console.log("\n  4. compaction");
  const journalBefore = (tabs.get("_Journal")?.length ?? 1) - 1;
  const result = await store.compact();
  check("folded every pending journal row", result.folded === journalBefore,
        `${result.folded} of ${journalBefore}`);
  check("entity tabs now hold the data",
        (tabs.get("Tasks")?.length ?? 0) === N + 1 && (tabs.get("Users")?.length ?? 0) === 2);
  check("watermark recorded",
        (tabs.get("_Meta") ?? []).some((r) => r[0] === "journalRows" && String(r[1]) === String(journalBefore)));
  check("journal was NOT destroyed (recoverable)",
        (tabs.get("_Journal")?.length ?? 0) === journalBefore + 1);

  store.resetCache();
  const afterCompact = await db.listTasks();
  check("state identical after compaction", afterCompact.length === N);
  check("no double-replay of folded rows",
        (await db.findUserById("u1"))?.email === "Ada@kubegraf.io");

  /* 5. Writes after compaction ───────────────────────────────── */
  console.log("\n  5. writes after compaction");
  await db.upsertTask({
    id: "t-new", title: "after compaction", description: "", assigneeId: null,
    status: "TODO", priority: "HIGH", dueDate: null,
    createdAt: iso(999), updatedAt: iso(999), createdBy: "u1",
  } as any);
  store.resetCache();
  check("new write replays over the compacted tabs",
        (await db.findTask("t-new"))?.title === "after compaction");
  check("earlier records untouched", (await db.listTasks()).length === N + 1);

  /* 6. Deletes ───────────────────────────────────────────────── */
  console.log("\n  6. deletes");
  await db.removeTask("t0");
  store.resetCache();
  check("delete applied", (await db.findTask("t0")) === null);
  await store.compact();
  store.resetCache();
  check("delete survives compaction", (await db.findTask("t0")) === null);
  check("siblings untouched", (await db.listTasks()).length === N);

  // removeUserHard must take the user's entries with it.
  await db.upsertEntry({
    id: "e1", userId: "u1", taskId: null, description: "x",
    startedAt: iso(), endedAt: null, durationMinutes: 0,
    createdAt: iso(), updatedAt: iso(),
    clockInAckedAt: iso(5), clockInAckedBy: "u1", clockInAckedByName: "Ada",
    clockOutAckedAt: null, clockOutAckedBy: null, clockOutAckedByName: null,
  } as any);
  store.resetCache();
  check("ack fields persist", (await db.listEntriesForUser("u1"))[0]?.clockInAckedByName === "Ada");
  await db.removeUserHard("u1");
  store.resetCache();
  check("hard delete removed user", (await db.findUserById("u1")) === null);
  check("hard delete removed their entries", (await db.listEntriesForUser("u1")).length === 0);

  /* 7. Corrupt journal row ───────────────────────────────────── */
  console.log("\n  7. resilience");
  tabs.get("_Journal")!.push([iso(), "{not json"]);
  store.resetCache();
  let threw = false;
  try { await db.listTasks(); } catch { threw = true; }
  check("a mangled journal row does not break reads", !threw);

  console.log(`\n  (${appendCount} appends, ${tabs.get("_Journal")!.length - 1} journal rows)`);
}

try {
  await main();
} catch (e) {
  console.error(`\n  ✗ threw: ${e instanceof Error ? e.stack : String(e)}`);
  failures++;
}

console.log(failures === 0 ? "\n  All checks passed.\n" : `\n  ${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
