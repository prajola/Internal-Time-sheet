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
import { notifyAdmin } from "../_lib/notify.js";
import type { TimeEntry } from "../_lib/types.js";

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
        await notifyAdmin({
          subject: "Clock-in",
          summary: `${me.name} clocked in.`,
          details: { Started: entry.startedAt, TaskId: entry.taskId ?? "—", Note: entry.description || "—" },
          byUser: me,
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
      await notifyAdmin({
        subject: "Clock-out",
        summary: `${me.name} clocked out (${closed.durationMinutes} min).`,
        details: {
          Started: closed.startedAt,
          Ended: closed.endedAt!,
          Minutes: closed.durationMinutes,
          TaskId: closed.taskId ?? "—",
          Note: closed.description || "—",
        },
        byUser: me,
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
