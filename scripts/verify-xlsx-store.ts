#!/usr/bin/env tsx
/**
 * End-to-end verification of the Excel store against a real Vercel Blob
 * store, in its own scratch namespace.
 *
 * Usage (from the project root):
 *   node --env-file=.env.development.local node_modules/.bin/tsx scripts/verify-xlsx-store.ts
 *
 * It sets XLSX_STORE_PREFIX to a unique throwaway folder before the
 * store module loads, so production data under db/ is never read or
 * written. Everything it creates is deleted on the way out, including
 * after a failure.
 *
 * What it proves:
 *   1. round-trip      — every field shape survives workbook encode/decode
 *   2. durability      — a committed write is visible to a cold reader
 *   3. concurrency     — N simultaneous writers all survive (the failure
 *                        mode that killed the old blob backend)
 *   4. compaction      — folding the journal preserves state exactly
 *   5. delete semantics — removals survive compaction
 */
process.env.STORAGE_DRIVER = "xlsx";
process.env.XLSX_STORE_PREFIX = `verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const { list, del } = await import("@vercel/blob");
const store = await import("../api/_lib/xlsx-store.js");
const db = await import("../api/_lib/db.js");

const PREFIX = process.env.XLSX_STORE_PREFIX!;
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

let failures = 0;

function check(name: string, pass: boolean, detail = ""): void {
  console.log(`   ${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

function iso(offsetMs = 0): string {
  return new Date(1760000000000 + offsetMs).toISOString();
}

async function cleanup(): Promise<void> {
  if (!TOKEN) return;
  const paths: string[] = [];
  let cursor: string | undefined;
  do {
    const r = await list({ prefix: PREFIX, cursor, limit: 1000, token: TOKEN });
    paths.push(...r.blobs.map((b) => b.pathname));
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  for (let i = 0; i < paths.length; i += 100) {
    await del(paths.slice(i, i + 100), { token: TOKEN });
  }
  console.log(`\n  cleaned up ${paths.length} scratch blob(s) under ${PREFIX}/`);
}

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error("\n  ✗ BLOB_READ_WRITE_TOKEN is not set\n");
    process.exit(1);
  }
  console.log(`\n  Excel store verification — scratch namespace ${PREFIX}/\n`);

  /* 1. Round-trip every field shape ─────────────────────────── */
  console.log("  1. field round-trip");

  const user = {
    id: "u1",
    email: "Ada@Kubegraf.io",
    name: "Ada",
    role: "ADMIN" as const,
    active: true,
    createdAt: iso(),
    invitedBy: undefined,
    passwordHash: "$2a$10$abcdefghijklmnopqrstuv",
    passwordSetAt: null,
    sessionsRevokedAt: null,
  };
  await db.upsertUser(user as any);

  // Exercises every Kind: str, strOrNull, strOrUndef, bool, num — plus
  // the ack fields the Airtable layer silently dropped.
  const entry = {
    id: "e1",
    userId: "u1",
    taskId: null,
    description: "wrote the thing",
    startedAt: iso(),
    endedAt: null,
    durationMinutes: 0,
    createdAt: iso(),
    updatedAt: iso(),
    clockInAckedAt: iso(60_000),
    clockInAckedBy: "u1",
    clockInAckedByName: "Ada",
    clockOutAckedAt: null,
    clockOutAckedBy: null,
    clockOutAckedByName: null,
  };
  await db.upsertEntry(entry as any);

  const holiday = {
    id: "h1",
    userId: "u1",
    userName: "Ada",
    userEmail: "ada@kubegraf.io",
    startDate: "2026-11-02",
    endDate: "2026-11-02",
    halfDay: true,
    kind: "ANNUAL" as const,
    reason: "",
    status: "PENDING" as const,
    days: 0.5,
    createdAt: iso(),
    updatedAt: iso(),
    decidedAt: null,
    decidedBy: null,
    decidedByName: null,
    decisionNote: "",
  };
  await db.upsertHoliday(holiday as any);

  // Round-trip through an actual workbook, the way compaction does.
  const before = await store.loadState();
  const wbBuf = await store.stateToWorkbookBuffer(before);
  // Slice to the exact view — Buffer.from() hands back a pooled buffer
  // whose .buffer is larger than the data.
  const reparsed = await store.workbookBufferToState(
    wbBuf.buffer.slice(wbBuf.byteOffset, wbBuf.byteOffset + wbBuf.byteLength) as ArrayBuffer,
  );

  const u = reparsed.users.get("u1")!;
  check("string survives", u.email === "Ada@Kubegraf.io");
  check("boolean survives as boolean", u.active === true && typeof u.active === "boolean");
  check("null stays null (not '')", u.passwordSetAt === null);
  check("absent optional stays absent", !("invitedBy" in u));
  check("bcrypt hash intact", u.passwordHash === user.passwordHash);

  const e = reparsed.timeEntries.get("e1")!;
  check("ack fields persist", e.clockInAckedAt === iso(60_000) && e.clockInAckedByName === "Ada",
        "the bug the Airtable layer had");
  check("null ack stays null", e.clockOutAckedAt === null);
  check("zero number stays number", e.durationMinutes === 0 && typeof e.durationMinutes === "number");

  const h = reparsed.holidays.get("h1")!;
  check("fractional number survives", h.days === 0.5);
  check("true boolean survives", h.halfDay === true);
  check("empty string stays ''", h.reason === "" && h.decisionNote === "");

  /* 2. A cold reader sees committed writes ──────────────────── */
  console.log("\n  2. durability across a cold read");
  store.resetCache();
  const cold = await store.loadState();
  check("user visible after cache drop", cold.users.get("u1")?.email === "Ada@Kubegraf.io");
  check("entry visible after cache drop", cold.timeEntries.has("e1"));

  /* 3. Concurrent writers ───────────────────────────────────── */
  // This is the one that matters. The old blob backend lost writes here
  // because each writer rewrote the whole file from a stale read.
  console.log("\n  3. concurrent writers (the old backend's failure mode)");
  const N = 25;
  await Promise.all(
    Array.from({ length: N }, (_, i) =>
      db.upsertTask({
        id: `t${i}`,
        title: `task ${i}`,
        description: "",
        assigneeId: null,
        status: "TODO",
        priority: "MEDIUM",
        dueDate: null,
        createdAt: iso(i),
        updatedAt: iso(i),
        createdBy: "u1",
      } as any),
    ),
  );
  store.resetCache();
  const afterConcurrent = await db.listTasks();
  check(`all ${N} concurrent writes survived`, afterConcurrent.length === N,
        `found ${afterConcurrent.length}`);
  const allTitles = new Set(afterConcurrent.map((t) => t.title));
  check("no write silently overwrote another",
        Array.from({ length: N }, (_, i) => allTitles.has(`task ${i}`)).every(Boolean));

  /* 4. Compaction preserves state ───────────────────────────── */
  console.log("\n  4. compaction");
  const pre = await store.loadState();
  const preCounts = store.ENTITIES.map((k) => `${k}:${pre[k].size}`).join(" ");

  // compact() only folds entries older than its 5-minute lag, so for the
  // test we fold everything by snapshotting the current state directly —
  // the same code path, without waiting out the lag.
  await store.bootstrapSnapshot(pre);
  store.resetCache();

  const post = await store.loadState();
  const postCounts = store.ENTITIES.map((k) => `${k}:${post[k].size}`).join(" ");
  check("record counts identical across snapshot", preCounts === postCounts, postCounts);
  check("user survives snapshot", post.users.get("u1")?.name === "Ada");
  check("ack fields survive snapshot", post.timeEntries.get("e1")?.clockInAckedByName === "Ada");
  check("fraction survives snapshot", post.holidays.get("h1")?.days === 0.5);

  const status = await store.storeStatus();
  check("snapshot is discoverable", status.snapshots >= 1, `${status.snapshots} snapshot(s)`);

  /* 5. Deletes survive ──────────────────────────────────────── */
  console.log("\n  5. delete semantics");
  await db.removeTask("t0");
  store.resetCache();
  check("delete applied", (await db.findTask("t0")) === null);

  const live = await store.loadState();
  await store.bootstrapSnapshot(live);
  store.resetCache();
  check("delete survives the next snapshot", (await db.findTask("t0")) === null);
  check("siblings untouched", (await db.listTasks()).length === N - 1);

  // removeUserHard must take the user's entries with it, atomically.
  await db.removeUserHard("u1");
  store.resetCache();
  check("hard delete removed user", (await db.findUserById("u1")) === null);
  check("hard delete removed their entries", (await db.listEntriesForUser("u1")).length === 0);
}

try {
  await main();
} catch (e) {
  console.error(`\n  ✗ threw: ${e instanceof Error ? e.stack : String(e)}`);
  failures++;
} finally {
  await cleanup().catch((e) => console.error(`  ! cleanup failed: ${e}`));
}

console.log(failures === 0 ? "\n  All checks passed.\n" : `\n  ${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
