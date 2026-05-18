/**
 * POST /api/auth/start
 * Body: { email, mode?: "reset" }
 *
 * The single email-first entry point for the auth flow.
 *
 *   1. If the user exists, is active, and has a password set:
 *      → returns { action: "password", name } so the UI can ask for it.
 *      Exception: if mode === "reset", we always send a reset link instead.
 *
 *   2. Otherwise (user missing, no password yet, or admin force-reset):
 *      → we auto-create the user if they don't exist (self-signup as
 *        EMPLOYEE; bootstrap admin if env matches on an empty workspace),
 *      → email them a 24-hour password-setup / reset link,
 *      → notify the admin about new signups.
 *      Returns { action: "email-sent" }.
 *
 *   3. Inactive accounts return a generic "email-sent" too (constant-time,
 *      no enumeration) but no email is actually sent.
 *
 * This is the Notion/Linear "magic-email-then-password" pattern — anyone
 * with a working email can join, the link goes to that email itself
 * (never re-routed to admin), and admins get a heads-up audit trail.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  findUserByEmail, listUsers, upsertUser,
  findInvitationByEmail, upsertInvitation,
} from "../_lib/db.js";
import { issueSetupToken } from "../_lib/auth.js";
import { sendMail, passwordSetupEmail } from "../_lib/email.js";
import {
  readBody, ok, badRequest, methodNotAllowed,
  normalizeEmail, emailLooksValid, uuid, nowIso,
} from "../_lib/helpers.js";
import { notifyAdmin } from "../_lib/notify.js";
import type { User, Role } from "../_lib/types.js";

interface Body { email?: string; mode?: "reset" }

function appUrl(): string {
  return (process.env.APP_URL || "https://internal-time-sheet.vercel.app").replace(/\/$/, "");
}

function setupLink(token: string): string {
  return `${appUrl()}/auth/set-password?token=${encodeURIComponent(token)}`;
}

async function sendSetupLink(opts: {
  to: string;
  name: string;
  purpose: "setup" | "reset";
  isFirstAdmin?: boolean;
  invitedBy?: string;
}) {
  const token = issueSetupToken(opts.to, opts.purpose);
  const link = setupLink(token);
  const tpl = passwordSetupEmail({
    to: opts.to,
    name: opts.name,
    link,
    purpose: opts.purpose,
    isFirstAdmin: opts.isFirstAdmin,
    invitedBy: opts.invitedBy,
  });
  return sendMail({ to: opts.to, subject: tpl.subject, text: tpl.text, html: tpl.html });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res);

  const body = readBody<Body>(req);
  const email = normalizeEmail(body.email || "");
  const mode = body.mode === "reset" ? "reset" : "normal";

  if (!emailLooksValid(email)) return badRequest(res, "Enter a valid email address");

  const existing = await findUserByEmail(email);

  /* 1. Existing active user with a password */
  if (existing && existing.active && existing.passwordHash) {
    if (mode === "reset") {
      await sendSetupLink({ to: email, name: existing.name, purpose: "reset" });
      return ok(res, { action: "email-sent" });
    }
    return ok(res, { action: "password", name: existing.name || "" });
  }

  /* 2. Existing user, no password yet → send setup link */
  if (existing && existing.active && !existing.passwordHash) {
    await sendSetupLink({ to: email, name: existing.name, purpose: "setup" });
    return ok(res, { action: "email-sent" });
  }

  /* 3. Inactive account — generic response, no email sent */
  if (existing && !existing.active) {
    return ok(res, { action: "email-sent" });
  }

  /* 4. Pending invitation → accept + send setup link */
  const invite = await findInvitationByEmail(email);
  if (invite && !invite.acceptedAt && new Date(invite.expiresAt) > new Date()) {
    const newUser: User = {
      id: uuid(),
      email,
      name: "",
      role: invite.role,
      active: true,
      createdAt: nowIso(),
      invitedBy: invite.invitedBy,
      passwordHash: null,
      passwordSetAt: null,
    };
    await upsertUser(newUser);
    invite.acceptedAt = nowIso();
    await upsertInvitation(invite);
    await sendSetupLink({ to: email, name: "", purpose: "setup" });
    return ok(res, { action: "email-sent" });
  }

  /* 5. Brand-new email → self-signup */
  const allUsers = await listUsers();
  const bootstrapEmail = normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL || "");
  const isFirstAdmin = allUsers.length === 0 && bootstrapEmail === email;
  const role: Role = isFirstAdmin ? "ADMIN" : "EMPLOYEE";

  const newUser: User = {
    id: uuid(),
    email,
    name: "",
    role,
    active: true,
    createdAt: nowIso(),
    passwordHash: null,
    passwordSetAt: null,
  };
  await upsertUser(newUser);

  await sendSetupLink({
    to: email,
    name: "",
    purpose: "setup",
    isFirstAdmin,
  });

  // Audit ping to the admin inbox — doesn't gate access, just an FYI.
  if (!isFirstAdmin) {
    await notifyAdmin({
      subject: "New signup",
      summary: `${email} signed up to the Internal Time Sheet.`,
      details: { Email: email, Role: role, "Signed up at": newUser.createdAt },
      byUser: newUser,
    });
  }

  return ok(res, { action: "email-sent" });
}
