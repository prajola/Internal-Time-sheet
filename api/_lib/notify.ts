/**
 * Admin notifications. Fire-and-forget — never blocks the
 * primary mutation. Pulls ADMIN_NOTIFY_EMAIL from env, defaults to
 * kubegraf@gmail.com so the user gets emails out-of-the-box.
 */
import type { Task, User } from "./types.js";
import { adminNotifyEmail, sendMail, taskAssignmentEmail } from "./email.js";

const DEFAULT_NOTIFY = "kubegraf@gmail.com";

export function adminNotifyAddress(): string {
  return process.env.ADMIN_NOTIFY_EMAIL || DEFAULT_NOTIFY;
}

function appUrl(): string {
  return (process.env.APP_URL || "https://internal-time-sheet.vercel.app").replace(/\/$/, "");
}

export async function notifyAdmin(opts: {
  subject: string;
  summary: string;
  details: Record<string, string | number | undefined>;
  byUser: User;
}): Promise<void> {
  const to = adminNotifyAddress();
  const email = adminNotifyEmail({
    subject: opts.subject,
    summary: opts.summary,
    details: opts.details,
    byUser: { name: opts.byUser.name, email: opts.byUser.email },
  });
  try {
    await sendMail({
      to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      replyTo: opts.byUser.email,
    });
  } catch (err) {
    console.warn("[notify] notifyAdmin failed (non-fatal):", err);
  }
}

/**
 * Email the assignee that a task has been (re)assigned to them. The
 * admin who assigned it is set as the Reply-To so the assignee can hit
 * Reply in their mail client to ask follow-up questions.
 *
 * Fire-and-forget — never blocks the underlying task mutation.
 */
export async function notifyAssignee(opts: {
  task: Task;
  assignee: User;
  assignedBy: User;
  isReassignment?: boolean;
}): Promise<void> {
  if (!opts.assignee.active) return; // Don't email deactivated users.

  const tpl = taskAssignmentEmail({
    to: opts.assignee.email,
    assigneeName: opts.assignee.name,
    taskTitle: opts.task.title,
    taskDescription: opts.task.description,
    priority: opts.task.priority,
    dueDate: opts.task.dueDate,
    assignedBy: { name: opts.assignedBy.name, email: opts.assignedBy.email },
    appUrl: appUrl(),
    isReassignment: opts.isReassignment,
  });

  try {
    await sendMail({
      to: opts.assignee.email,
      subject: tpl.subject,
      text: tpl.text,
      html: tpl.html,
      replyTo: opts.assignedBy.email,
    });
  } catch (err) {
    console.warn("[notify] notifyAssignee failed (non-fatal):", err);
  }
}
