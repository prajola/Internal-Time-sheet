/**
 * GET  /api/tasks         — list. Admin: all. Employee: only assigned to self.
 * POST /api/tasks         — create + assign (admin only).
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth, requireAdmin } from "../_lib/auth.js";
import { listTasks, upsertTask, findUserById } from "../_lib/db.js";
import {
  uuid,
  nowIso,
  readBody,
  ok,
  badRequest,
  methodNotAllowed,
} from "../_lib/helpers.js";
import { notifyAssignee, notifyUser } from "../_lib/notify.js";
import type { Task, TaskPriority, TaskStatus, User } from "../_lib/types.js";

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

    let assigneeUser: User | null = null;
    if (body.assigneeId) {
      const a = await findUserById(body.assigneeId);
      if (!a) return badRequest(res, "assigneeId does not match any user");
      assigneeUser = a;
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

    // Notify only the assignee — admins do not receive an audit email
    // for actions they performed themselves (it's just inbox noise).
    if (assigneeUser) {
      await notifyAssignee({ task: t, assignee: assigneeUser, assignedBy: admin });
      await notifyUser({
        to: assigneeUser,
        kind: "task-assigned",
        title: `New task: ${t.title}`,
        body: `${admin.name} assigned a task to you · ${t.priority}${t.dueDate ? ` · due ${t.dueDate}` : ""}`,
        link: "/my-tasks",
        taskId: t.id,
        from: { id: admin.id, name: admin.name, email: admin.email },
      });
    }

    return ok(res, { task: t }, 201);
  }

  return methodNotAllowed(res);
}
