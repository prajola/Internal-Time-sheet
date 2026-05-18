/**
 * PATCH  /api/time-entries/:id   — edit one entry. Admins anyone; users own only.
 * DELETE /api/time-entries/:id   — admin or owner.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth } from "../_lib/auth";
import {
  listEntriesForUser,
  listAllEntries,
  upsertEntry,
  removeEntry,
} from "../_lib/db";
import {
  nowIso,
  diffMinutes,
  readBody,
  ok,
  badRequest,
  notFound,
  methodNotAllowed,
} from "../_lib/helpers";
import { notifyAdmin } from "../_lib/notify";
import type { TimeEntry } from "../_lib/types";

interface PatchBody {
  taskId?: string | null;
  description?: string;
  startedAt?: string;
  endedAt?: string | null;
}

async function findEntry(id: string, viewerId: string, viewerIsAdmin: boolean): Promise<TimeEntry | null> {
  if (viewerIsAdmin) {
    const all = await listAllEntries();
    return all.find((e) => e.id === id) ?? null;
  }
  const mine = await listEntriesForUser(viewerId);
  return mine.find((e) => e.id === id) ?? null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = String(req.query.id || "");
  if (!id) return badRequest(res, "id required");

  const me = await requireAuth(req, res);
  if (!me) return;

  if (req.method === "PATCH") {
    const e = await findEntry(id, me.id, me.role === "ADMIN");
    if (!e) return notFound(res, "Entry not found");
    if (me.role !== "ADMIN" && e.userId !== me.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const body = readBody<PatchBody>(req);
    const diff: Record<string, string> = {};
    const next: TimeEntry = { ...e, updatedAt: nowIso() };

    if (body.taskId !== undefined) {
      diff.taskId = `${e.taskId ?? "—"} → ${body.taskId ?? "—"}`;
      next.taskId = body.taskId;
    }
    if (typeof body.description === "string") {
      next.description = body.description.trim();
      diff.description = "updated";
    }
    if (body.startedAt) {
      diff.startedAt = `${e.startedAt} → ${body.startedAt}`;
      next.startedAt = body.startedAt;
    }
    if (body.endedAt !== undefined) {
      diff.endedAt = `${e.endedAt ?? "—"} → ${body.endedAt ?? "—"}`;
      next.endedAt = body.endedAt;
    }
    next.durationMinutes = next.endedAt ? diffMinutes(next.startedAt, next.endedAt) : 0;

    if (Object.keys(diff).length === 0) return badRequest(res, "No allowed changes");

    await upsertEntry(next);

    await notifyAdmin({
      subject: "Time entry updated",
      summary: `${me.name} updated a time entry.`,
      details: {
        EntryId: e.id,
        ...diff,
        Started: next.startedAt,
        Ended: next.endedAt ?? "(in progress)",
        Minutes: next.durationMinutes,
      },
      byUser: me,
    });

    return ok(res, { entry: next });
  }

  if (req.method === "DELETE") {
    const e = await findEntry(id, me.id, me.role === "ADMIN");
    if (!e) return notFound(res, "Entry not found");
    if (me.role !== "ADMIN" && e.userId !== me.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    await removeEntry(e.userId, e.id);
    await notifyAdmin({
      subject: "Time entry deleted",
      summary: `${me.name} deleted a time entry.`,
      details: { EntryId: e.id, Started: e.startedAt, Ended: e.endedAt ?? "—" },
      byUser: me,
    });
    return ok(res, { success: true });
  }

  return methodNotAllowed(res);
}
