/**
 * POST /api/time-entries/clock
 *   action: "in"   → starts a new entry. Body { taskId?, description? }.
 *   action: "out"  → closes the currently-open entry (latest with endedAt == null).
 *
 * GET  /api/time-entries/clock     — returns the open entry for the current user, or null.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth } from "../_lib/auth";
import { listEntriesForUser, upsertEntry } from "../_lib/db";
import {
  uuid,
  nowIso,
  diffMinutes,
  readBody,
  ok,
  badRequest,
  methodNotAllowed,
} from "../_lib/helpers";
import { notifyAdmin } from "../_lib/notify";
import type { TimeEntry } from "../_lib/types";

interface Body {
  action?: "in" | "out";
  taskId?: string | null;
  description?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const me = await requireAuth(req, res);
  if (!me) return;

  if (req.method === "GET") {
    const mine = await listEntriesForUser(me.id);
    const open = mine.find((e) => !e.endedAt) ?? null;
    return ok(res, { open });
  }

  if (req.method !== "POST") return methodNotAllowed(res);

  const body = readBody<Body>(req);
  const action = body.action;
  if (action !== "in" && action !== "out") {
    return badRequest(res, "action must be 'in' or 'out'");
  }

  const mine = await listEntriesForUser(me.id);
  const open = mine.find((e) => !e.endedAt);

  if (action === "in") {
    if (open) {
      return badRequest(res, "Already clocked in — close the existing entry first");
    }
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

  // action === "out"
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
