/**
 * Airtable-backed data layer.
 *
 * Each entity lives in its own table inside the base configured by
 * AIRTABLE_BASE_ID, with one row per record. Our own UUIDs live in the
 * `id` column; we look records up by that column (via filterByFormula)
 * so the rest of the app can stay UUID-keyed.
 *
 * Performance: Airtable's REST API runs ~300–500ms per call. Functions
 * here that need a full collection (listUsers, listTasks, listAllEntries)
 * issue a paginated list request. For an internal team-sized workspace
 * this is fine; if it ever isn't, the right next step is a real DB.
 *
 * Concurrency: per-record PATCH is atomic. saveNotificationsForUser is
 * the only "replace a set" operation — implemented as diff-and-batch so
 * it doesn't lose interleaved writes from other code paths the way the
 * old blob backend did.
 */
import type { User, Task, Invitation, TimeEntry, Notification, SupportQuery } from "./types.js";

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = process.env.AIRTABLE_BASE_ID;

const TABLE = {
  users: "Users",
  tasks: "Tasks",
  timeEntries: "TimeEntries",
  invitations: "Invitations",
  notifications: "Notifications",
  queries: "Queries",
} as const;

function api(table: string, path = ""): string {
  if (!BASE) throw new Error("AIRTABLE_BASE_ID is not set");
  return `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(table)}${path}`;
}

function authHeaders(json = false): Record<string, string> {
  if (!TOKEN) throw new Error("AIRTABLE_TOKEN is not set");
  const h: Record<string, string> = { Authorization: `Bearer ${TOKEN}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

/**
 * Wrap fetch with retry-on-transient-error.
 *
 * Airtable occasionally serves 5xx (especially 502/503/504 gateway
 * blips) and 429 (rate-limit, 5 req/sec/base). Both are safe to retry.
 * 4xx other than 429 are not retried — they mean we sent something bad.
 *
 * Exponential backoff: 300ms, 800ms, 2000ms. Up to 3 retries.
 */
async function fetchWithRetry(url: string, init: RequestInit = {}): Promise<Response> {
  const delays = [300, 800, 2000];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const r = await fetch(url, init);
      if (r.ok) return r;
      if (r.status === 429 || (r.status >= 500 && r.status <= 599)) {
        if (attempt === delays.length) return r; // Out of retries — let caller see the bad response.
        const ra = r.headers.get("retry-after");
        const wait = ra ? Math.min(parseInt(ra, 10) * 1000 || 0, 5000) : delays[attempt];
        await new Promise((res) => setTimeout(res, wait));
        continue;
      }
      return r; // Non-retryable 4xx — return as-is.
    } catch (e) {
      lastErr = e;
      if (attempt === delays.length) throw e;
      await new Promise((res) => setTimeout(res, delays[attempt]));
    }
  }
  throw lastErr ?? new Error("fetchWithRetry: unreachable");
}

/* ── Low-level Airtable helpers ──────────────────────────────── */

interface ListOpts {
  filterFormula?: string;
  pageSize?: number;
}

async function listRecords(table: string, opts: ListOpts = {}): Promise<Array<{ id: string; fields: any }>> {
  const all: Array<{ id: string; fields: any }> = [];
  const pageSize = opts.pageSize ?? 100;
  let offset: string | undefined;
  do {
    const qs = new URLSearchParams({ pageSize: String(pageSize) });
    if (opts.filterFormula) qs.set("filterByFormula", opts.filterFormula);
    if (offset) qs.set("offset", offset);
    const r = await fetchWithRetry(`${api(table)}?${qs.toString()}`, { headers: authHeaders() });
    if (!r.ok) throw new Error(`Airtable list ${table}: HTTP ${r.status} ${await r.text()}`);
    const data = await r.json();
    for (const rec of data.records ?? []) all.push({ id: rec.id, fields: rec.fields ?? {} });
    offset = data.offset;
  } while (offset);
  return all;
}

async function findRecordIdByOurId(table: string, ourId: string): Promise<string | null> {
  // filterByFormula expects strings escaped — our IDs are hex uuids, no
  // quotes inside, but escape defensively.
  const safe = ourId.replace(/'/g, "\\'");
  const formula = `{id}='${safe}'`;
  const recs = await listRecords(table, { filterFormula: formula, pageSize: 1 });
  return recs[0]?.id ?? null;
}

async function createRecord(table: string, fields: Record<string, any>): Promise<void> {
  const r = await fetchWithRetry(api(table), {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(`Airtable create ${table}: HTTP ${r.status} ${await r.text()}`);
}

async function updateRecord(table: string, recId: string, fields: Record<string, any>): Promise<void> {
  const r = await fetchWithRetry(api(table, `/${recId}`), {
    method: "PATCH",
    headers: authHeaders(true),
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(`Airtable update ${table}: HTTP ${r.status} ${await r.text()}`);
}

async function deleteRecord(table: string, recId: string): Promise<void> {
  const r = await fetchWithRetry(api(table, `/${recId}`), {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!r.ok) throw new Error(`Airtable delete ${table}: HTTP ${r.status} ${await r.text()}`);
}

async function deleteRecords(table: string, recIds: string[]): Promise<void> {
  if (recIds.length === 0) return;
  // Airtable supports batch delete up to 10 ids per call via repeated `records[]` params.
  for (let i = 0; i < recIds.length; i += 10) {
    const slice = recIds.slice(i, i + 10);
    const qs = slice.map((id) => `records[]=${encodeURIComponent(id)}`).join("&");
    const r = await fetchWithRetry(`${api(table)}?${qs}`, { method: "DELETE", headers: authHeaders() });
    if (!r.ok) throw new Error(`Airtable batch delete ${table}: HTTP ${r.status} ${await r.text()}`);
  }
}

async function upsertByOurId(table: string, ourId: string, fields: Record<string, any>): Promise<void> {
  const recId = await findRecordIdByOurId(table, ourId);
  if (recId) await updateRecord(table, recId, fields);
  else await createRecord(table, fields);
}

/* ── Codecs (object ↔ Airtable fields) ───────────────────────── */
// Airtable returns missing/empty text fields as undefined. Defensive
// coalescing keeps the app's typed shapes intact.

function userToFields(u: User): Record<string, any> {
  return {
    id: u.id,
    email: u.email,
    name: u.name ?? "",
    role: u.role,
    active: u.active === true,
    createdAt: u.createdAt ?? "",
    passwordHash: u.passwordHash ?? "",
    passwordSetAt: u.passwordSetAt ?? "",
    sessionsRevokedAt: u.sessionsRevokedAt ?? "",
    invitedBy: u.invitedBy ?? "",
  };
}
function userFromFields(f: any): User {
  return {
    id: f.id,
    email: f.email,
    name: f.name ?? "",
    role: f.role,
    active: f.active === true,
    createdAt: f.createdAt,
    invitedBy: f.invitedBy || undefined,
    passwordHash: f.passwordHash || null,
    passwordSetAt: f.passwordSetAt || null,
    sessionsRevokedAt: f.sessionsRevokedAt || null,
  };
}

function taskToFields(t: Task): Record<string, any> {
  return {
    id: t.id,
    title: t.title,
    description: t.description ?? "",
    assigneeId: t.assigneeId ?? "",
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate ?? "",
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    createdBy: t.createdBy,
  };
}
function taskFromFields(f: any): Task {
  return {
    id: f.id,
    title: f.title ?? "",
    description: f.description ?? "",
    assigneeId: f.assigneeId || null,
    status: f.status,
    priority: f.priority,
    dueDate: f.dueDate || null,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    createdBy: f.createdBy,
  };
}

function entryToFields(e: TimeEntry): Record<string, any> {
  return {
    id: e.id,
    userId: e.userId,
    taskId: e.taskId ?? "",
    description: e.description ?? "",
    startedAt: e.startedAt,
    endedAt: e.endedAt ?? "",
    durationMinutes: e.durationMinutes ?? 0,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}
function entryFromFields(f: any): TimeEntry {
  return {
    id: f.id,
    userId: f.userId,
    taskId: f.taskId || null,
    description: f.description ?? "",
    startedAt: f.startedAt,
    endedAt: f.endedAt || null,
    durationMinutes: typeof f.durationMinutes === "number" ? f.durationMinutes : 0,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}

function invitationToFields(i: Invitation): Record<string, any> {
  return {
    id: i.id,
    email: i.email,
    role: i.role,
    invitedBy: i.invitedBy,
    createdAt: i.createdAt,
    expiresAt: i.expiresAt,
    acceptedAt: i.acceptedAt ?? "",
  };
}
function invitationFromFields(f: any): Invitation {
  return {
    id: f.id,
    email: f.email,
    role: f.role,
    invitedBy: f.invitedBy,
    createdAt: f.createdAt,
    expiresAt: f.expiresAt,
    acceptedAt: f.acceptedAt || undefined,
  };
}

function notificationToFields(n: Notification): Record<string, any> {
  return {
    id: n.id,
    userId: n.userId,
    kind: n.kind,
    title: n.title,
    body: n.body ?? "",
    link: n.link ?? "",
    taskId: n.taskId ?? "",
    fromUserId: n.fromUserId ?? "",
    fromUserName: n.fromUserName ?? "",
    readAt: n.readAt ?? "",
    createdAt: n.createdAt,
  };
}
function notificationFromFields(f: any): Notification {
  return {
    id: f.id,
    userId: f.userId,
    kind: f.kind,
    title: f.title ?? "",
    body: f.body ?? "",
    link: f.link || null,
    taskId: f.taskId || null,
    fromUserId: f.fromUserId || null,
    fromUserName: f.fromUserName || null,
    readAt: f.readAt || null,
    createdAt: f.createdAt,
  };
}

function queryToFields(q: SupportQuery): Record<string, any> {
  return {
    id: q.id,
    userId: q.userId,
    userName: q.userName ?? "",
    userEmail: q.userEmail ?? "",
    category: q.category,
    subject: q.subject,
    body: q.body ?? "",
    status: q.status,
    taskId: q.taskId ?? "",
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
    adminResponse: q.adminResponse ?? "",
    respondedAt: q.respondedAt ?? "",
    respondedBy: q.respondedBy ?? "",
    respondedByName: q.respondedByName ?? "",
  };
}
function queryFromFields(f: any): SupportQuery {
  return {
    id: f.id,
    userId: f.userId,
    userName: f.userName ?? "",
    userEmail: f.userEmail ?? "",
    category: f.category,
    subject: f.subject ?? "",
    body: f.body ?? "",
    status: f.status,
    taskId: f.taskId || null,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    adminResponse: f.adminResponse ?? "",
    respondedAt: f.respondedAt || null,
    respondedBy: f.respondedBy || null,
    respondedByName: f.respondedByName || null,
  };
}

/* ── Users ───────────────────────────────────────────────────── */

export async function listUsers(): Promise<User[]> {
  const recs = await listRecords(TABLE.users);
  return recs.map((r) => userFromFields(r.fields));
}
export async function findUserByEmail(email: string): Promise<User | null> {
  const e = email.trim().toLowerCase().replace(/'/g, "\\'");
  const recs = await listRecords(TABLE.users, {
    filterFormula: `LOWER({email})='${e}'`,
    pageSize: 1,
  });
  return recs[0] ? userFromFields(recs[0].fields) : null;
}
export async function findUserById(id: string): Promise<User | null> {
  const recId = await findRecordIdByOurId(TABLE.users, id);
  if (!recId) return null;
  // Re-fetch this single record's fields cheaply.
  const r = await fetchWithRetry(api(TABLE.users, `/${recId}`), { headers: authHeaders() });
  if (!r.ok) return null;
  const data = await r.json();
  return userFromFields(data.fields ?? {});
}
export async function upsertUser(u: User): Promise<void> {
  await upsertByOurId(TABLE.users, u.id, userToFields(u));
}
export async function removeUser(id: string): Promise<void> {
  const recId = await findRecordIdByOurId(TABLE.users, id);
  if (recId) await deleteRecord(TABLE.users, recId);
}

/**
 * Hard-delete a user: remove their row and wipe their time entries.
 * Tasks they own/created/are assigned to are left in place; admin can
 * reassign or delete those separately.
 */
export async function removeUserHard(id: string): Promise<void> {
  await removeUser(id);
  // Wipe their entries
  const entries = await listRecords(TABLE.timeEntries, {
    filterFormula: `{userId}='${id.replace(/'/g, "\\'")}'`,
  });
  await deleteRecords(TABLE.timeEntries, entries.map((e) => e.id));
}

/* ── Tasks ───────────────────────────────────────────────────── */

export async function listTasks(): Promise<Task[]> {
  const recs = await listRecords(TABLE.tasks);
  return recs.map((r) => taskFromFields(r.fields));
}
export async function findTask(id: string): Promise<Task | null> {
  const recId = await findRecordIdByOurId(TABLE.tasks, id);
  if (!recId) return null;
  const r = await fetchWithRetry(api(TABLE.tasks, `/${recId}`), { headers: authHeaders() });
  if (!r.ok) return null;
  const data = await r.json();
  return taskFromFields(data.fields ?? {});
}
export async function upsertTask(t: Task): Promise<void> {
  await upsertByOurId(TABLE.tasks, t.id, taskToFields(t));
}
export async function removeTask(id: string): Promise<void> {
  const recId = await findRecordIdByOurId(TABLE.tasks, id);
  if (recId) await deleteRecord(TABLE.tasks, recId);
}

/* ── Invitations ─────────────────────────────────────────────── */

export async function listInvitations(): Promise<Invitation[]> {
  const recs = await listRecords(TABLE.invitations);
  return recs.map((r) => invitationFromFields(r.fields));
}
export async function findInvitationByEmail(email: string): Promise<Invitation | null> {
  const e = email.trim().toLowerCase();
  const all = await listInvitations();
  // Active = not accepted and not expired
  const now = Date.now();
  return (
    all.find(
      (i) => i.email === e && !i.acceptedAt && new Date(i.expiresAt).getTime() > now,
    ) ?? null
  );
}
export async function upsertInvitation(inv: Invitation): Promise<void> {
  await upsertByOurId(TABLE.invitations, inv.id, invitationToFields(inv));
}

/* ── Time entries ────────────────────────────────────────────── */

export async function listEntriesForUser(userId: string): Promise<TimeEntry[]> {
  const safe = userId.replace(/'/g, "\\'");
  const recs = await listRecords(TABLE.timeEntries, {
    filterFormula: `{userId}='${safe}'`,
  });
  return recs.map((r) => entryFromFields(r.fields));
}
export async function upsertEntry(entry: TimeEntry): Promise<TimeEntry[]> {
  await upsertByOurId(TABLE.timeEntries, entry.id, entryToFields(entry));
  return listEntriesForUser(entry.userId);
}
export async function removeEntry(_userId: string, entryId: string): Promise<void> {
  const recId = await findRecordIdByOurId(TABLE.timeEntries, entryId);
  if (recId) await deleteRecord(TABLE.timeEntries, recId);
}

/** Admin: list entries across all users. */
export async function listAllEntries(): Promise<TimeEntry[]> {
  const recs = await listRecords(TABLE.timeEntries);
  return recs.map((r) => entryFromFields(r.fields));
}

/* ── Notifications ───────────────────────────────────────────── */

const NOTIF_PER_USER_CAP = 200;

export async function listNotificationsForUser(userId: string): Promise<Notification[]> {
  const safe = userId.replace(/'/g, "\\'");
  const recs = await listRecords(TABLE.notifications, {
    filterFormula: `{userId}='${safe}'`,
  });
  const items = recs.map((r) => notificationFromFields(r.fields));
  // Sort newest first (Airtable doesn't guarantee order across pages)
  items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return items;
}

/**
 * Replace a user's notification list with `items` (capped at NOTIF_PER_USER_CAP).
 * Diff against existing rows: update changed, delete dropped, insert new.
 */
export async function saveNotificationsForUser(userId: string, items: Notification[]): Promise<void> {
  const safe = userId.replace(/'/g, "\\'");
  const existing = await listRecords(TABLE.notifications, {
    filterFormula: `{userId}='${safe}'`,
  });
  const existingByOurId = new Map<string, { recId: string; fields: any }>();
  for (const r of existing) existingByOurId.set(r.fields.id, { recId: r.id, fields: r.fields });

  const trimmed = items.length > NOTIF_PER_USER_CAP ? items.slice(0, NOTIF_PER_USER_CAP) : items;
  const wantedIds = new Set(trimmed.map((n) => n.id));

  // Deletes — rows present in Airtable but not in the new list.
  const toDelete = [...existingByOurId.entries()]
    .filter(([id]) => !wantedIds.has(id))
    .map(([, v]) => v.recId);
  await deleteRecords(TABLE.notifications, toDelete);

  // Upserts — create new, update existing only if fields changed.
  for (const n of trimmed) {
    const fields = notificationToFields(n);
    const ex = existingByOurId.get(n.id);
    if (!ex) {
      await createRecord(TABLE.notifications, fields);
    } else {
      // Cheap structural compare — skip update when nothing changed.
      const same = Object.entries(fields).every(([k, v]) => (ex.fields[k] ?? "") === (v ?? ""));
      if (!same) await updateRecord(TABLE.notifications, ex.recId, fields);
    }
  }
}

export async function pushNotification(n: Notification): Promise<void> {
  // Just append — no need to diff. Cap enforcement happens on the next
  // saveNotificationsForUser call from /api/notifications.
  await createRecord(TABLE.notifications, notificationToFields(n));
}

export async function updateNotification(userId: string, id: string, patch: Partial<Notification>): Promise<Notification | null> {
  const list = await listNotificationsForUser(userId);
  const idx = list.findIndex((n) => n.id === id);
  if (idx === -1) return null;
  const next = { ...list[idx], ...patch };
  await upsertByOurId(TABLE.notifications, id, notificationToFields(next));
  return next;
}

export async function removeNotification(_userId: string, id: string): Promise<void> {
  const recId = await findRecordIdByOurId(TABLE.notifications, id);
  if (recId) await deleteRecord(TABLE.notifications, recId);
}

/* ── Compat shims (kept for callers that still use bulk save) ─ */
// These were heavily used by the old blob backend; the rewrite leaves
// them in for any straggler import. Each translates a "replace whole
// collection" into a per-record diff.

export async function saveUsers(users: User[]): Promise<void> {
  const existing = await listRecords(TABLE.users);
  const existingByOurId = new Map(existing.map((r) => [r.fields.id, r]));
  const wanted = new Set(users.map((u) => u.id));
  await deleteRecords(TABLE.users, [...existingByOurId].filter(([id]) => !wanted.has(id)).map(([, r]) => r.id));
  for (const u of users) await upsertByOurId(TABLE.users, u.id, userToFields(u));
}

export async function saveTasks(tasks: Task[]): Promise<void> {
  const existing = await listRecords(TABLE.tasks);
  const existingByOurId = new Map(existing.map((r) => [r.fields.id, r]));
  const wanted = new Set(tasks.map((t) => t.id));
  await deleteRecords(TABLE.tasks, [...existingByOurId].filter(([id]) => !wanted.has(id)).map(([, r]) => r.id));
  for (const t of tasks) await upsertByOurId(TABLE.tasks, t.id, taskToFields(t));
}

export async function saveInvitations(invitations: Invitation[]): Promise<void> {
  const existing = await listRecords(TABLE.invitations);
  const existingByOurId = new Map(existing.map((r) => [r.fields.id, r]));
  const wanted = new Set(invitations.map((i) => i.id));
  await deleteRecords(TABLE.invitations, [...existingByOurId].filter(([id]) => !wanted.has(id)).map(([, r]) => r.id));
  for (const i of invitations) await upsertByOurId(TABLE.invitations, i.id, invitationToFields(i));
}

export async function saveEntriesForUser(userId: string, entries: TimeEntry[]): Promise<void> {
  const safe = userId.replace(/'/g, "\\'");
  const existing = await listRecords(TABLE.timeEntries, { filterFormula: `{userId}='${safe}'` });
  const existingByOurId = new Map(existing.map((r) => [r.fields.id, r]));
  const wanted = new Set(entries.map((e) => e.id));
  await deleteRecords(TABLE.timeEntries, [...existingByOurId].filter(([id]) => !wanted.has(id)).map(([, r]) => r.id));
  for (const e of entries) await upsertByOurId(TABLE.timeEntries, e.id, entryToFields(e));
}

/* ── Queries (support tickets) ───────────────────────────────── */

export async function listQueries(): Promise<SupportQuery[]> {
  const recs = await listRecords(TABLE.queries);
  const out = recs.map((r) => queryFromFields(r.fields));
  out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return out;
}
export async function listQueriesForUser(userId: string): Promise<SupportQuery[]> {
  const safe = userId.replace(/'/g, "\\'");
  const recs = await listRecords(TABLE.queries, {
    filterFormula: `{userId}='${safe}'`,
  });
  const out = recs.map((r) => queryFromFields(r.fields));
  out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return out;
}
export async function findQuery(id: string): Promise<SupportQuery | null> {
  const recId = await findRecordIdByOurId(TABLE.queries, id);
  if (!recId) return null;
  const r = await fetchWithRetry(api(TABLE.queries, `/${recId}`), { headers: authHeaders() });
  if (!r.ok) return null;
  const data = await r.json();
  return queryFromFields(data.fields ?? {});
}
export async function upsertQuery(q: SupportQuery): Promise<void> {
  await upsertByOurId(TABLE.queries, q.id, queryToFields(q));
}
export async function removeQuery(id: string): Promise<void> {
  const recId = await findRecordIdByOurId(TABLE.queries, id);
  if (recId) await deleteRecord(TABLE.queries, recId);
}
