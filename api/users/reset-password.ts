/**
 * POST /api/users/reset-password
 * Body: { userId }
 *
 * Admin-only. Sends a "reset your password" link to the target user.
 *
 * This is the Microsoft 365 admin-center analogue of "Reset password"
 * on a user record — the admin doesn't see or set the new password
 * themselves; the user clicks the link and chooses their own.
 *
 * Side-effects:
 *   - Clears the target's passwordHash so the old password is no
 *     longer accepted at /api/auth/login.
 *   - Sends a 24h setup link to the target's email.
 *   - kubegraf@gmail.com receives an audit notification.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin, issueSetupToken } from "../_lib/auth.js";
import { findUserById, upsertUser } from "../_lib/db.js";
import { sendMail, passwordSetupEmail } from "../_lib/email.js";
import { readBody, ok, badRequest, notFound, methodNotAllowed, nowIso } from "../_lib/helpers.js";
import { notifyAdmin } from "../_lib/notify.js";

interface Body { userId?: string }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res);

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { userId } = readBody<Body>(req);
  if (!userId) return badRequest(res, "userId is required");

  const target = await findUserById(userId);
  if (!target) return notFound(res, "User not found");

  // Clear the hash so the old password stops working immediately.
  target.passwordHash = null;
  target.passwordSetAt = null;
  await upsertUser(target);

  const appUrlBase = (process.env.APP_URL || "https://internal-time-sheet.vercel.app").replace(/\/$/, "");
  const token = issueSetupToken(target.email, "reset");
  const link = `${appUrlBase}/auth/set-password?token=${encodeURIComponent(token)}`;
  const tpl = passwordSetupEmail({
    to: target.email,
    name: target.name,
    link,
    purpose: "reset",
    invitedBy: admin.name,
  });
  const send = await sendMail({
    to: target.email,
    subject: tpl.subject,
    text: tpl.text,
    html: tpl.html,
    replyTo: admin.email,
  });

  await notifyAdmin({
    subject: "Admin reset user password",
    summary: `${admin.name} sent a password-reset link to ${target.email}.`,
    details: {
      Target: target.email,
      Role: target.role,
      "Reset by": `${admin.name} <${admin.email}>`,
      "Email delivered": send.ok ? "yes" : `no (${send.error || "unknown"})`,
      At: nowIso(),
    },
    byUser: admin,
  });

  return ok(res, { success: true, emailSent: send.ok });
}
