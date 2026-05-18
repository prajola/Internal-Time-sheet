/**
 * GET    /api/tasks/:id
 * PATCH  /api/tasks/:id  — admins can edit anything; employees can update status of their own
 * DELETE /api/tasks/:id  — admin only
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth, requireAdmin } from "../_lib/auth.js";
import { findTask, upsertTask, removeTask, findUserById, listUsers } from "../_lib/db.js";
import {
  nowIso,
  readBody,
  ok,
  badRequest,
  notFound,
  methodNotAllowed,
} from "../_lib/helpers.js";
import { notifyAdmin, notifyAssignee, notifyUser } from "../_lib/notify.js";
import { taskStatusEmail } from "../_lib/email.js";
import type { Task, TaskPriority, TaskStatus, User } from "../_lib/types.js";

function appUrl(): string {
  return (process.env.APP_URL || "https://internal-time-sheet.vercel.app").replace(/\/$/, "");
}

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

    // Track whether the assignee actually changed so we know whether to
    // send the assignment email (and to whom).
    let newAssignee: User | null = null;
    let assigneeChanged = false;

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
        const requested = body.assigneeId || null;
        if (requested !== t.assigneeId) {
          if (requested) {
            const a = await findUserById(requested);
            if (!a) return badRequest(res, "assigneeId does not match any user");
            newAssignee = a;
          }
          diff.assignee = `${t.assigneeId ?? "—"} → ${requested ?? "—"}`;
          next.assigneeId = requested;
          assigneeChanged = true;
        }
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

    // Notify the new assignee (if any) that they own this task now.
    let assigneeNotified = false;
    if (assigneeChanged && newAssignee) {
      await notifyAssignee({
        task: next,
        assignee: newAssignee,
        assignedBy: me,
        isReassignment: true,
      });
      await notifyUser({
        to: newAssignee,
        kind: "task-assigned",
        title: `Reassigned: ${next.title}`,
        body: `${me.name} reassigned this task to you · ${next.priority}${next.dueDate ? ` · due ${next.dueDate}` : ""}`,
        link: "/my-tasks",
        taskId: next.id,
        from: { id: me.id, name: me.name, email: me.email },
      });
      assigneeNotified = true;
    }

    // Status change by an employee → notify admins (so they see "marked done" in real time).
    if (diff.status && !isAdmin) {
      // The bell goes to every active admin; the email goes to the task creator
      // when available, otherwise to the configured admin notification address.
      const creator = await findUserById(t.createdBy);
      const allUsers = await listUsers();
      const admins = allUsers.filter((u) => u.role === "ADMIN" && u.active);

      // Email — single addressee (creator first, fall back to all admins via notifyAdmin already)
      if (creator) {
        const tpl = taskStatusEmail({
          to: creator.email,
          recipientName: creator.name,
          actorName: me.name,
          taskTitle: t.title,
          oldStatus: t.status,
          newStatus: next.status,
          appUrl: appUrl(),
        });
        await notifyUser({
          to: creator,
          kind: "task-status-changed",
          title: `${me.name} marked "${t.title}" as ${next.status.replace("_", " ")}`,
          body: `Status: ${t.status} → ${next.status}`,
          link: "/tasks",
          taskId: next.id,
          from: { id: me.id, name: me.name, email: me.email },
          email: tpl,
        });
      }
      // Bell-only for the other admins (avoid email noise — they all get notifyAdmin below too).
      for (const a of admins) {
        if (creator && a.id === creator.id) continue;
        if (a.id === me.id) continue;
        await notifyUser({
          to: a,
          kind: "task-status-changed",
          title: `${me.name} marked "${t.title}" as ${next.status.replace("_", " ")}`,
          body: `Status: ${t.status} → ${next.status}`,
          link: "/tasks",
          taskId: next.id,
          from: { id: me.id, name: me.name, email: me.email },
        });
      }
    }

    // Status change by an admin → notify the assignee.
    if (diff.status && isAdmin && next.assigneeId && next.assigneeId !== me.id) {
      const assignee = await findUserById(next.assigneeId);
      if (assignee) {
        await notifyUser({
          to: assignee,
          kind: "task-status-changed",
          title: `Status updated on "${next.title}"`,
          body: `${me.name} changed status: ${t.status} → ${next.status}`,
          link: "/my-tasks",
          taskId: next.id,
          from: { id: me.id, name: me.name, email: me.email },
        });
      }
    }

    // Generic edit by admin (non-status, non-reassign) → ping the assignee.
    const hasNonStatusEdit = Boolean(diff.title || diff.description || diff.priority || diff.dueDate);
    if (isAdmin && hasNonStatusEdit && next.assigneeId && !assigneeChanged && next.assigneeId !== me.id) {
      const assignee = await findUserById(next.assigneeId);
      if (assignee) {
        await notifyUser({
          to: assignee,
          kind: "task-updated",
          title: `Task updated: ${next.title}`,
          body: `${me.name} updated details on a task assigned to you.`,
          link: "/my-tasks",
          taskId: next.id,
          from: { id: me.id, name: me.name, email: me.email },
        });
      }
    }

    await notifyAdmin({
      subject: "Task updated",
      summary: `${me.name} updated task "${t.title}".`,
      details: {
        Task: t.title,
        ...diff,
        ...(assigneeChanged ? { "Assignee notified": assigneeNotified ? "yes" : "no" } : {}),
      },
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

    if (t.assigneeId && t.assigneeId !== admin.id) {
      const assignee = await findUserById(t.assigneeId);
      if (assignee) {
        await notifyUser({
          to: assignee,
          kind: "task-deleted",
          title: `Task removed: ${t.title}`,
          body: `${admin.name} deleted a task that was assigned to you.`,
          link: "/my-tasks",
          taskId: t.id,
          from: { id: admin.id, name: admin.name, email: admin.email },
        });
      }
    }

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
