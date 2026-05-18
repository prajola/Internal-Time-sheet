/**
 * GET    /api/tasks/:id
 * PATCH  /api/tasks/:id  — admins can edit anything; employees can update status of their own
 * DELETE /api/tasks/:id  — admin only
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth, requireAdmin } from "../_lib/auth.js";
import { findTask, upsertTask, removeTask, findUserById } from "../_lib/db.js";
import {
  nowIso,
  readBody,
  ok,
  badRequest,
  notFound,
  methodNotAllowed,
} from "../_lib/helpers.js";
import { notifyAdmin } from "../_lib/notify.js";
import type { Task, TaskPriority, TaskStatus } from "../_lib/types.js";

interface PatchBody {
  title?: string;
  description?: string;
  assigneeId?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = String(req.query.id || "");
  if (!id) return badRequest(res, "id required");

  if (req.method === "GET") {
    const me = await requireAuth(req, res);
    if (!me) return;
    const t = await findTask(id);
    if (!t) return notFound(res, "Task not found");
    if (me.role !== "ADMIN" && t.assigneeId !== me.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    return ok(res, { task: t });
  }

  if (req.method === "PATCH") {
    const me = await requireAuth(req, res);
    if (!me) return;
    const t = await findTask(id);
    if (!t) return notFound(res, "Task not found");

    const isAdmin = me.role === "ADMIN";
    const isAssignee = t.assigneeId === me.id;
    if (!isAdmin && !isAssignee) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const body = readBody<PatchBody>(req);
    const next: Task = { ...t, updatedAt: nowIso() };
    const diff: Record<string, string> = {};

    // Employees can only flip status; admins can edit everything.
    if (isAdmin) {
      if (typeof body.title === "string" && body.title.trim()) {
        diff.title = `${t.title} → ${body.title.trim()}`;
        next.title = body.title.trim();
      }
      if (typeof body.description === "string") {
        next.description = body.description.trim();
        diff.description = "updated";
      }
      if (body.assigneeId !== undefined) {
        if (body.assigneeId) {
          const a = await findUserById(body.assigneeId);
          if (!a) return badRequest(res, "assigneeId does not match any user");
        }
        diff.assignee = `${t.assigneeId ?? "—"} → ${body.assigneeId ?? "—"}`;
        next.assigneeId = body.assigneeId;
      }
      if (body.priority) {
        diff.priority = `${t.priority} → ${body.priority}`;
        next.priority = body.priority;
      }
      if (body.dueDate !== undefined) {
        diff.dueDate = `${t.dueDate ?? "—"} → ${body.dueDate ?? "—"}`;
        next.dueDate = body.dueDate;
      }
    }

    if (body.status && (isAdmin || isAssignee)) {
      diff.status = `${t.status} → ${body.status}`;
      next.status = body.status;
    }

    if (Object.keys(diff).length === 0) return badRequest(res, "No allowed changes");

    await upsertTask(next);

    await notifyAdmin({
      subject: "Task updated",
      summary: `${me.name} updated task "${t.title}".`,
      details: { Task: t.title, ...diff },
      byUser: me,
    });

    return ok(res, { task: next });
  }

  if (req.method === "DELETE") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const t = await findTask(id);
    if (!t) return notFound(res, "Task not found");
    await removeTask(id);
    await notifyAdmin({
      subject: "Task deleted",
      summary: `${admin.name} deleted task "${t.title}".`,
      details: { Task: t.title, "Was assigned to": t.assigneeId ?? "—" },
      byUser: admin,
    });
    return ok(res, { success: true });
  }

  return methodNotAllowed(res);
}
