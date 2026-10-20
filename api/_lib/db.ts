/**
 * Excel-backed data layer.
 *
 * Every entity is a worksheet in one .xlsx workbook held in Vercel Blob.
 * The mechanics — snapshot + append-only journal, why writes never
 * rewrite the workbook, how compaction works — live in ./xlsx-store.ts.
 * This module is just the typed surface the API routes call.
 *
 * Performance: reads are served from the in-process state, refreshed by
 * two blob `list` calls at most every couple of seconds (~100ms), so a
 * warm function answers from memory. Writes upload a single small JSON
 * blob (~100ms) — faster than the 300-500ms Airtable round-trip this
 * replaces, and not subject to a 5 req/sec/base rate limit.
 *
 * Concurrency: a write appends an immutable journal entry, so two
 * functions writing at once cannot lose each other's edits. Concurrent
 * edits to the *same* record resolve last-write-wins, matching the
 * previous behaviour. Bulk "replace a collection" helpers are diffed
 * into per-record operations rather than clobbering the whole set.
 */
import type { User, Task, Invitation, TimeEntry, Notification, SupportQuery, Holiday } from "./types.js";
import { commit, loadState, normalizeRecord, type EntityName, type Op } from "./store.js";

function putOp(entity: EntityName, rec: Record<string, any>): Op {
  return { op: "put", entity, id: String(rec.id), rec: normalizeRecord(entity, rec) };
}

function delOp(entity: EntityName, id: string): Op {
  return { op: "del", entity, id };
}

async function all<T>(entity: EntityName): Promise<T[]> {
  const state = await loadState();
  return [...state[entity].values()] as T[];
}

async function one<T>(entity: EntityName, id: string): Promise<T | null> {
  const state = await loadState();
  return (state[entity].get(id) as T) ?? null;
}

/* ── Sort helpers ────────────────────────────────────────────── */

/** Newest first — the ordering convention for every feed-like list. */
function byNewest(a: { createdAt?: string }, b: { createdAt?: string }): number {
  return (b.createdAt || "").localeCompare(a.createdAt || "");
}

/* ── Users ───────────────────────────────────────────────────── */

export async function listUsers(): Promise<User[]> {
  return all<User>("users");
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const needle = email.trim().toLowerCase();
  const users = await all<User>("users");
  return users.find((u) => (u.email || "").toLowerCase() === needle) ?? null;
}

export async function findUserById(id: string): Promise<User | null> {
  return one<User>("users", id);
}

export async function upsertUser(u: User): Promise<void> {
  await commit([putOp("users", u)]);
}

export async function removeUser(id: string): Promise<void> {
  await commit([delOp("users", id)]);
}

/**
 * Hard-delete a user: remove their row and wipe their time entries.
 * Tasks they own/created/are assigned to are left in place; admin can
 * reassign or delete those separately.
 *
 * Both halves land in a single journal entry, so the user and their
 * entries disappear together — no window where one is gone and the
 * other is not.
 */
export async function removeUserHard(id: string): Promise<void> {
  const state = await loadState();
  const ops: Op[] = [delOp("users", id)];
  for (const e of state.timeEntries.values()) {
    if (e.userId === id) ops.push(delOp("timeEntries", e.id));
  }
  await commit(ops);
}

/* ── Tasks ───────────────────────────────────────────────────── */

export async function listTasks(): Promise<Task[]> {
  return all<Task>("tasks");
}

export async function findTask(id: string): Promise<Task | null> {
  return one<Task>("tasks", id);
}

export async function upsertTask(t: Task): Promise<void> {
  await commit([putOp("tasks", t)]);
}

export async function removeTask(id: string): Promise<void> {
  await commit([delOp("tasks", id)]);
}

/* ── Invitations ─────────────────────────────────────────────── */

export async function listInvitations(): Promise<Invitation[]> {
  return all<Invitation>("invitations");
}

export async function findInvitationByEmail(email: string): Promise<Invitation | null> {
  const needle = email.trim().toLowerCase();
  const now = Date.now();
  const invites = await all<Invitation>("invitations");
  // Active = not accepted and not expired.
  return (
    invites.find(
      (i) =>
        (i.email || "").toLowerCase() === needle &&
        !i.acceptedAt &&
        new Date(i.expiresAt).getTime() > now,
    ) ?? null
  );
}

export async function upsertInvitation(inv: Invitation): Promise<void> {
  await commit([putOp("invitations", inv)]);
}

/* ── Time entries ────────────────────────────────────────────── */

export async function listEntriesForUser(userId: string): Promise<TimeEntry[]> {
  const entries = await all<TimeEntry>("timeEntries");
  return entries.filter((e) => e.userId === userId);
}

export async function upsertEntry(entry: TimeEntry): Promise<TimeEntry[]> {
  await commit([putOp("timeEntries", entry)]);
  return listEntriesForUser(entry.userId);
}

export async function removeEntry(_userId: string, entryId: string): Promise<void> {
  await commit([delOp("timeEntries", entryId)]);
}

/** Admin: list entries across all users. */
export async function listAllEntries(): Promise<TimeEntry[]> {
  return all<TimeEntry>("timeEntries");
}

/* ── Notifications ───────────────────────────────────────────── */

const NOTIF_PER_USER_CAP = 200;

export async function listNotificationsForUser(userId: string): Promise<Notification[]> {
  const items = await all<Notification>("notifications");
  return items.filter((n) => n.userId === userId).sort(byNewest);
}

/**
 * Replace a user's notification list with `items` (capped at
 * NOTIF_PER_USER_CAP).
 *
 * Diffed into per-record operations rather than a wholesale replace, so
 * a notification pushed by another request while this one was in flight
 * is not swept away.
 */
export async function saveNotificationsForUser(userId: string, items: Notification[]): Promise<void> {
  const existing = await listNotificationsForUser(userId);
  const trimmed = items.length > NOTIF_PER_USER_CAP ? items.slice(0, NOTIF_PER_USER_CAP) : items;
  const wanted = new Set(trimmed.map((n) => n.id));

  const ops: Op[] = [];
  for (const n of existing) {
    if (!wanted.has(n.id)) ops.push(delOp("notifications", n.id));
  }
  for (const n of trimmed) ops.push(putOp("notifications", n));

  await commit(ops);
}

export async function pushNotification(n: Notification): Promise<void> {
  // Append only. Cap enforcement happens on the next
  // saveNotificationsForUser call from /api/notifications.
  await commit([putOp("notifications", n)]);
}

export async function updateNotification(
  userId: string,
  id: string,
  patch: Partial<Notification>,
): Promise<Notification | null> {
  const current = await one<Notification>("notifications", id);
  if (!current || current.userId !== userId) return null;
  const next = { ...current, ...patch };
  await commit([putOp("notifications", next)]);
  return next;
}

export async function removeNotification(_userId: string, id: string): Promise<void> {
  await commit([delOp("notifications", id)]);
}

/* ── Compat shims (kept for callers that still use bulk save) ─ */
// Each translates a "replace whole collection" into a per-record diff,
// so an interleaved single-record write is preserved rather than lost.

async function replaceCollection(
  entity: EntityName,
  wanted: Array<{ id: string }>,
  scope?: (rec: any) => boolean,
): Promise<void> {
  const state = await loadState();
  const wantedIds = new Set(wanted.map((r) => r.id));
  const ops: Op[] = [];
  for (const rec of state[entity].values()) {
    if (scope && !scope(rec)) continue;
    if (!wantedIds.has(rec.id)) ops.push(delOp(entity, rec.id));
  }
  for (const rec of wanted) ops.push(putOp(entity, rec));
  await commit(ops);
}

export async function saveUsers(users: User[]): Promise<void> {
  await replaceCollection("users", users);
}

export async function saveTasks(tasks: Task[]): Promise<void> {
  await replaceCollection("tasks", tasks);
}

export async function saveInvitations(invitations: Invitation[]): Promise<void> {
  await replaceCollection("invitations", invitations);
}

export async function saveEntriesForUser(userId: string, entries: TimeEntry[]): Promise<void> {
  await replaceCollection("timeEntries", entries, (e) => e.userId === userId);
}

/* ── Queries (support tickets) ───────────────────────────────── */

export async function listQueries(): Promise<SupportQuery[]> {
  return (await all<SupportQuery>("queries")).sort(byNewest);
}

export async function listQueriesForUser(userId: string): Promise<SupportQuery[]> {
  return (await all<SupportQuery>("queries")).filter((q) => q.userId === userId).sort(byNewest);
}

export async function findQuery(id: string): Promise<SupportQuery | null> {
  return one<SupportQuery>("queries", id);
}

export async function upsertQuery(q: SupportQuery): Promise<void> {
  await commit([putOp("queries", q)]);
}

export async function removeQuery(id: string): Promise<void> {
  await commit([delOp("queries", id)]);
}

/* ── Holidays (leave requests) ───────────────────────────────── */

export async function listHolidays(): Promise<Holiday[]> {
  return (await all<Holiday>("holidays")).sort(byNewest);
}

export async function listHolidaysForUser(userId: string): Promise<Holiday[]> {
  return (await all<Holiday>("holidays")).filter((h) => h.userId === userId).sort(byNewest);
}

export async function findHoliday(id: string): Promise<Holiday | null> {
  return one<Holiday>("holidays", id);
}

export async function upsertHoliday(h: Holiday): Promise<void> {
  await commit([putOp("holidays", h)]);
}

export async function removeHoliday(id: string): Promise<void> {
  await commit([delOp("holidays", id)]);
}
