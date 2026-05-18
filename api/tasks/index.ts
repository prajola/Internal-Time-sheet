/**
 * GET  /api/tasks         — list. Admin: all. Employee: only assigned to self.
 * POST /api/tasks         — create + assign (admin only).
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth, requireAdmin } from "../_lib/auth";
import { listTasks, upsertTask, findUserById } from "../_lib/db";
import {
  uuid,
  nowIso,
  readBody,
  ok,
  badRequest,
  methodNotAllowed,
} from "../_lib/helpers";
import { notifyAdmin } from "../_lib/notify";
import type { Task, TaskPriority, TaskStatus } from "../_lib/types";

interface CreateBody {
  title?: string;
  description?: string;
  assigneeId?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    const me = await requireAuth(req, res);
    if (!me) return;
    const tasks = await listTasks();
    const visible = me.role === "ADMIN" ? tasks : tasks.filter((t) => t.assigneeId === me.id);
    return ok(res, { tasks: visible });
  }

  if (req.method === "POST") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const body = readBody<CreateBody>(req);
    const title = (body.title || "").trim();
    if (!title) return badRequest(res, "title required");

    let assigneeName = "Unassigned";
    if (body.assigneeId) {
      const a = await findUserById(body.assigneeId);
      if (!a) return badRequest(res, "assigneeId does not match any user");
      assigneeName = a.name + " <" + a.email + ">";
    }

    const t: Task = {
      id: uuid(),
      title,
      description: (body.description || "").trim(),
      assigneeId: body.assigneeId || null,
      status: body.status ?? "TODO",
      priority: body.priority ?? "MEDIUM",
      dueDate: body.dueDate || null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: admin.id,
    };
    await upsertTask(t);

    await notifyAdmin({
      subject: "Task created",
      summary: `${admin.name} created task "${t.title}".`,
      details: {
        Title: t.title,
        Assignee: assigneeName,
        Priority: t.priority,
        Status: t.status,
        Due: t.dueDate ?? "—",
      },
      byUser: admin,
    });

    return ok(res, { task: t }, 201);
  }

  return methodNotAllowed(res);
}
