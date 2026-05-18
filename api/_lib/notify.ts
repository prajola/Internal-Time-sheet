/**
 * Admin notifications. Fire-and-forget — never blocks the
 * primary mutation. Pulls ADMIN_NOTIFY_EMAIL from env, defaults to
 * kubegraf@gmail.com so the user gets emails out-of-the-box.
 */
import type { Notification, NotificationKind, Task, User } from "./types.js";
import { adminNotifyEmail, sendMail, taskAssignmentEmail } from "./email.js";
import { pushNotification } from "./db.js";
import { uuid, nowIso } from "./helpers.js";

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

/**
 * Generic in-app notifier: writes a Notification record AND optionally
 * sends an email. Use this for every user-visible event we want to
 * surface in the bell. Falls back silently on errors — never lets a
 * write failure block the underlying mutation.
 */
export async function notifyUser(opts: {
  to: User;
  kind: NotificationKind;
  title: string;
  body: string;
  link?: string;
  taskId?: string;
  from?: { id: string; name: string; email: string };
  email?: { subject: string; text: string; html: string };
}): Promise<void> {
  const n: Notification = {
    id: uuid(),
    userId: opts.to.id,
    kind: opts.kind,
    title: opts.title,
    body: opts.body,
    link: opts.link || null,
    taskId: opts.taskId || null,
    fromUserId: opts.from?.id || null,
    fromUserName: opts.from?.name || null,
    readAt: null,
    createdAt: nowIso(),
  };

  try { await pushNotification(n); } catch (err) {
    console.warn("[notify] pushNotification failed (non-fatal):", err);
  }

  if (opts.email && opts.to.active && opts.to.email) {
    try {
      await sendMail({
        to: opts.to.email,
        subject: opts.email.subject,
        text: opts.email.text,
        html: opts.email.html,
        replyTo: opts.from?.email,
      });
    } catch (err) {
      console.warn("[notify] notifyUser email failed (non-fatal):", err);
    }
  }
}
