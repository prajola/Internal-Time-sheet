/**
 * Vercel Blob-backed JSON store.
 *
 * Each collection is one blob:
 *   db/users.json         — { users: User[] }
 *   db/tasks.json         — { tasks: Task[] }
 *   db/invitations.json   — { invitations: Invitation[] }
 *
 * Time entries are sharded per-user to avoid write contention:
 *   db/time-entries/<userId>.json — { entries: TimeEntry[] }
 *
 * Concurrency: we use a simple read-modify-write per blob. For a
 * small internal team the conflict window is tiny; if it becomes a
 * problem later, switch to per-record blobs (like the book-demo
 * relay's `submissions/` pattern).
 */
import { list, put } from "@vercel/blob";
import type { User, Task, Invitation, TimeEntry, Notification } from "./types.js";

const COLL = {
  users: "db/users.json",
  tasks: "db/tasks.json",
  invitations: "db/invitations.json",
} as const;

const TE_PREFIX = "db/time-entries/";
const NOTIF_PREFIX = "db/notifications/";

// Cap each user's inbox so it doesn't grow unbounded over time. Older
// records past this count are truncated on every write.
const NOTIF_PER_USER_CAP = 200;

async function readBlob<T>(pathname: string): Promise<T | null> {
  try {
    const { blobs } = await list({ prefix: pathname });
    const found = blobs.find((b) => b.pathname === pathname);
    if (!found) return null;
    // Cache-bust at the request layer: `?_=ts` defeats any CDN edge that
    // might serve a stale copy after our overwrite. Pair this with the
    // cacheControlMaxAge:0 on put() below — together they give us
    // read-after-write consistency for our small JSON state.
    const url = `${found.url}${found.url.includes("?") ? "&" : "?"}_=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function writeBlob(pathname: string, data: unknown): Promise<void> {
  await put(pathname, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    // Tell Vercel's CDN not to cache — these blobs are mutable state.
    cacheControlMaxAge: 0,
  });
}

/* ── Users ───────────────────────────────────────────────────── */

export async function listUsers(): Promise<User[]> {
  const data = await readBlob<{ users: User[] }>(COLL.users);
  return data?.users ?? [];
}
export async function saveUsers(users: User[]): Promise<void> {
  await writeBlob(COLL.users, { users });
}
export async function findUserByEmail(email: string): Promise<User | null> {
  const e = email.trim().toLowerCase();
  const users = await listUsers();
  return users.find((u) => u.email === e) ?? null;
}
export async function findUserById(id: string): Promise<User | null> {
  const users = await listUsers();
  return users.find((u) => u.id === id) ?? null;
}
export async function upsertUser(u: User): Promise<void> {
  const users = await listUsers();
  const i = users.findIndex((x) => x.id === u.id);
  if (i === -1) users.push(u);
  else users[i] = u;
  await saveUsers(users);
}
export async function removeUser(id: string): Promise<void> {
  const users = await listUsers();
  await saveUsers(users.filter((u) => u.id !== id));
}

/**
 * Hard-delete a user: removes the user record AND their time-entry shard.
 * Tasks they own/created/are assigned to are left in place; admin can
 * reassign or delete those separately.
 */
export async function removeUserHard(id: string): Promise<void> {
  await removeUser(id);
  // Best-effort: wipe their entries by writing an empty shard.
  await saveEntriesForUser(id, []);
}

/* ── Tasks ───────────────────────────────────────────────────── */

export async function listTasks(): Promise<Task[]> {
  const data = await readBlob<{ tasks: Task[] }>(COLL.tasks);
  return data?.tasks ?? [];
}
export async function saveTasks(tasks: Task[]): Promise<void> {
  await writeBlob(COLL.tasks, { tasks });
}
export async function findTask(id: string): Promise<Task | null> {
  const tasks = await listTasks();
  return tasks.find((t) => t.id === id) ?? null;
}
export async function upsertTask(t: Task): Promise<void> {
  const tasks = await listTasks();
  const i = tasks.findIndex((x) => x.id === t.id);
  if (i === -1) tasks.push(t);
  else tasks[i] = t;
  await saveTasks(tasks);
}
export async function removeTask(id: string): Promise<void> {
  const tasks = await listTasks();
  await saveTasks(tasks.filter((t) => t.id !== id));
}

/* ── Invitations ─────────────────────────────────────────────── */

export async function listInvitations(): Promise<Invitation[]> {
  const data = await readBlob<{ invitations: Invitation[] }>(COLL.invitations);
  return data?.invitations ?? [];
}
export async function saveInvitations(invitations: Invitation[]): Promise<void> {
  await writeBlob(COLL.invitations, { invitations });
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
  const all = await listInvitations();
  const idx = all.findIndex((x) => x.id === inv.id);
  if (idx === -1) all.push(inv);
  else all[idx] = inv;
  await saveInvitations(all);
}

/* ── Time entries (sharded per user) ────────────────────────── */

export async function listEntriesForUser(userId: string): Promise<TimeEntry[]> {
  const data = await readBlob<{ entries: TimeEntry[] }>(`${TE_PREFIX}${userId}.json`);
  return data?.entries ?? [];
}
export async function saveEntriesForUser(userId: string, entries: TimeEntry[]): Promise<void> {
  await writeBlob(`${TE_PREFIX}${userId}.json`, { entries });
}
export async function upsertEntry(entry: TimeEntry): Promise<TimeEntry[]> {
  const list = await listEntriesForUser(entry.userId);
  const idx = list.findIndex((e) => e.id === entry.id);
  if (idx === -1) list.push(entry);
  else list[idx] = entry;
  await saveEntriesForUser(entry.userId, list);
  return list;
}
export async function removeEntry(userId: string, entryId: string): Promise<void> {
  const list = await listEntriesForUser(userId);
  await saveEntriesForUser(userId, list.filter((e) => e.id !== entryId));
}

/* ── Notifications (sharded per recipient) ──────────────────── */

export async function listNotificationsForUser(userId: string): Promise<Notification[]> {
  const data = await readBlob<{ items: Notification[] }>(`${NOTIF_PREFIX}${userId}.json`);
  return data?.items ?? [];
}

export async function saveNotificationsForUser(userId: string, items: Notification[]): Promise<void> {
  // Keep the inbox bounded — drop the oldest beyond the cap.
  const trimmed = items.length > NOTIF_PER_USER_CAP
    ? items.slice(0, NOTIF_PER_USER_CAP)
    : items;
  await writeBlob(`${NOTIF_PREFIX}${userId}.json`, { items: trimmed });
}

/** Insert a fresh notification at the head of the recipient's inbox. */
export async function pushNotification(n: Notification): Promise<void> {
  const list = await listNotificationsForUser(n.userId);
  list.unshift(n);
  await saveNotificationsForUser(n.userId, list);
}

export async function updateNotification(userId: string, id: string, patch: Partial<Notification>): Promise<Notification | null> {
  const list = await listNotificationsForUser(userId);
  const idx = list.findIndex((n) => n.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch };
  await saveNotificationsForUser(userId, list);
  return list[idx];
}

export async function removeNotification(userId: string, id: string): Promise<void> {
  const list = await listNotificationsForUser(userId);
  await saveNotificationsForUser(userId, list.filter((n) => n.id !== id));
}

/** Admin: list entries across all users. Use with care — O(users) reads. */
export async function listAllEntries(): Promise<TimeEntry[]> {
  const { blobs } = await list({ prefix: TE_PREFIX });
  const results = await Promise.all(
    blobs.map(async (b) => {
      try {
        const res = await fetch(b.url, { cache: "no-store" });
        if (!res.ok) return [] as TimeEntry[];
        const json = (await res.json()) as { entries: TimeEntry[] };
        return json.entries ?? [];
      } catch {
        return [] as TimeEntry[];
      }
    }),
  );
  return results.flat();
}
