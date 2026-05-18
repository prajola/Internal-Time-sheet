/**
 * GET  /api/time-entries                        — list with filters (day|from/to|month|year|userId|taskId)
 * GET  /api/time-entries?open=1                 — returns the caller's currently-open entry, or null
 * POST /api/time-entries                        — create entry (manual log)
 * POST /api/time-entries (body: { action })     — "clock-in" / "clock-out" shortcuts
 *
 * Admin can see all entries; employees only their own. The filter param
 * userId is admin-only.
 *
 * Why one handler: Vercel Hobby caps deployments at 12 serverless functions,
 * so we fold the clock-in/clock-out actions into the list/create handler
 * rather than carrying a separate /clock endpoint.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth } from "../_lib/auth.js";
import {
  listEntriesForUser,
  listAllEntries,
  upsertEntry,
  listUsers,
} from "../_lib/db.js";
import {
  uuid,
  nowIso,
  diffMinutes,
  readBody,
  ok,
  badRequest,
  methodNotAllowed,
  applyEntryFilter,
  EntryFilter,
} from "../_lib/helpers.js";
import { notifyAdmin, notifyUser } from "../_lib/notify.js";
import type { TimeEntry, User } from "../_lib/types.js";

async function pingAdmins(opts: {
  actor: User;
  kind: "clock-in" | "clock-out";
  title: string;
  body: string;
}): Promise<void> {
  const users = await listUsers();
  const admins = users.filter((u) => u.role === "ADMIN" && u.active && u.id !== opts.actor.id);
  await Promise.all(
    admins.map((a) =>
      notifyUser({
        to: a,
        kind: opts.kind,
        title: opts.title,
        body: opts.body,
        link: "/manage",
        from: { id: opts.actor.id, name: opts.actor.name, email: opts.actor.email },
      }).catch((err) => console.warn("[time-entries] admin ping failed:", err))
    ),
  );
}

interface PostBody {
  // Action shortcuts:
  action?: "clock-in" | "clock-out";

  // Manual-create / clock-in extras:
  taskId?: string | null;
  description?: string;
  startedAt?: string;
  endedAt?: string | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    const me = await requireAuth(req, res);
    if (!me) return;

    // ?open=1 → return the user's current open entry, or null.
    if (typeof req.query.open === "string" && req.query.open !== "0" && req.query.open !== "false") {
      const mine = await listEntriesForUser(me.id);
      const open = mine.find((e) => !e.endedAt) ?? null;
      return ok(res, { open });
    }

    // ?openAll=1 → admin only: every user that's currently clocked in.
    // Returns an array of { user, entry } pairs so the UI can render a
    // live "Currently clocked in" panel without N+1 lookups.
    if (
      typeof req.query.openAll === "string" &&
      req.query.openAll !== "0" &&
      req.query.openAll !== "false"
    ) {
      if (me.role !== "ADMIN") {
        res.status(403).json({ error: "Admin only" });
        return;
      }
      const all = await listAllEntries();
      const open = all.filter((e) => !e.endedAt);
      const users = await listUsers();
      const items = open
        .map((entry) => {
          const u = users.find((x) => x.id === entry.userId);
          if (!u) return null;
          return {
            entry,
            user: {
              id: u.id,
              email: u.email,
              name: u.name,
              role: u.role,
              active: u.active,
            },
          };
        })
        .filter(Boolean);
      return ok(res, { items });
    }

    const f: EntryFilter = {
      day: typeof req.query.day === "string" ? req.query.day : undefined,
      from: typeof req.query.from === "string" ? req.query.from : undefined,
      to: typeof req.query.to === "string" ? req.query.to : undefined,
      month: typeof req.query.month === "string" ? req.query.month : undefined,
      year: typeof req.query.year === "string" ? req.query.year : undefined,
      userId: typeof req.query.userId === "string" ? req.query.userId : undefined,
      taskId: typeof req.query.taskId === "string" ? req.query.taskId : undefined,
    };

    let entries: TimeEntry[];
    if (me.role === "ADMIN") {
      entries = await listAllEntries();
    } else {
      entries = await listEntriesForUser(me.id);
      // Force userId filter to self for non-admins (even if query param tries otherwise).
      f.userId = me.id;
    }

    const filtered = applyEntryFilter(entries, f);
    filtered.sort((a, b) => (a.startedAt > b.startedAt ? -1 : 1));

    return ok(res, { entries: filtered });
  }

  if (req.method === "POST") {
    const me = await requireAuth(req, res);
    if (!me) return;

    const body = readBody<PostBody>(req);

    if (body.action === "clock-in" || body.action === "clock-out") {
      const mine = await listEntriesForUser(me.id);
      const open = mine.find((e) => !e.endedAt);

      if (body.action === "clock-in") {
        if (open) return badRequest(res, "Already clocked in — close the existing entry first");
        const entry: TimeEntry = {
          id: uuid(),
          userId: me.id,
          taskId: body.taskId || null,
          description: (body.description || "").trim(),
          startedAt: nowIso(),
          endedAt: null,
          durationMinutes: 0,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        await upsertEntry(entry);
        // Ping every admin's notification bell. This shows up in real time
        // in their /manage view.
        await pingAdmins({
          actor: me,
          kind: "clock-in",
          title: `${me.name || me.email} clocked in`,
          body: entry.description
            ? `Started working: ${entry.description}`
            : "Started a new work session",
        });
        return ok(res, { entry }, 201);
      }

      // clock-out
      if (!open) return badRequest(res, "No open entry to clock out of");
      const endedAt = nowIso();
      const closed: TimeEntry = {
        ...open,
        endedAt,
        durationMinutes: diffMinutes(open.startedAt, endedAt),
        updatedAt: endedAt,
      };
      await upsertEntry(closed);
      const hours = Math.floor(closed.durationMinutes / 60);
      const mins = closed.durationMinutes % 60;
      const durStr =
        hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
      await pingAdmins({
        actor: me,
        kind: "clock-out",
        title: `${me.name || me.email} clocked out`,
        body: `Worked ${durStr}${closed.description ? ` · ${closed.description}` : ""}`,
      });
      return ok(res, { entry: closed });
    }

    // Manual create
    const startedAt = body.startedAt || nowIso();
    const endedAt = body.endedAt ?? null;

    if (!startedAt) return badRequest(res, "startedAt required");
    if (endedAt && new Date(endedAt) <= new Date(startedAt)) {
      return badRequest(res, "endedAt must be after startedAt");
    }

    const e: TimeEntry = {
      id: uuid(),
      userId: me.id,
      taskId: body.taskId || null,
      description: (body.description || "").trim(),
      startedAt,
      endedAt,
      durationMinutes: endedAt ? diffMinutes(startedAt, endedAt) : 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    await upsertEntry(e);

    await notifyAdmin({
      subject: "Time entry created",
      summary: `${me.name} logged a time entry.`,
      details: {
        Description: e.description || "—",
        TaskId: e.taskId ?? "—",
        Started: e.startedAt,
        Ended: e.endedAt ?? "(in progress)",
        Minutes: e.durationMinutes,
      },
      byUser: me,
    });

    return ok(res, { entry: e }, 201);
  }

  return methodNotAllowed(res);
}
