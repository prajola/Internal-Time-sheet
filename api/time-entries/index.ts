/**
 * GET  /api/time-entries        — list with filters (day|from/to|month|year|userId|taskId)
 * POST /api/time-entries        — create entry (manual log)
 *
 * Admin can see all entries; employees only their own. The filter param
 * userId is admin-only.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth } from "../_lib/auth";
import {
  listEntriesForUser,
  listAllEntries,
  upsertEntry,
} from "../_lib/db";
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
} from "../_lib/helpers";
import { notifyAdmin } from "../_lib/notify";
import type { TimeEntry } from "../_lib/types";

interface CreateBody {
  taskId?: string | null;
  description?: string;
  startedAt?: string;
  endedAt?: string | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    const me = await requireAuth(req, res);
    if (!me) return;

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

    const body = readBody<CreateBody>(req);
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
