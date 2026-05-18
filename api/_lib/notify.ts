/**
 * Admin notifications. Fire-and-forget — never blocks the
 * primary mutation. Pulls ADMIN_NOTIFY_EMAIL from env, defaults to
 * kubegraf@gmail.com so the user gets emails out-of-the-box.
 */
import type { User } from "./types";
import { adminNotifyEmail, sendMail } from "./email";

const DEFAULT_NOTIFY = "kubegraf@gmail.com";

export function adminNotifyAddress(): string {
  return process.env.ADMIN_NOTIFY_EMAIL || DEFAULT_NOTIFY;
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
