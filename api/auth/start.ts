/**
 * POST /api/auth/start
 * Body: { email, mode?: "reset", intent?: "signin" | "signup" }
 *
 * Email-first entry point. Decides what the UI should show next.
 *
 *   1. Existing active user WITH password set:
 *      → { action: "password", name }  (UI shows password input)
 *      If mode === "reset", we send an email reset link instead and
 *      return { action: "email-sent" }.
 *
 *   2. Existing active user WITHOUT a password yet (admin reset / pending
 *      invite):
 *      → { action: "create-password", name }  (UI shows password setup form)
 *
 *   3. Inactive account → generic "email-sent" (no enumeration leak).
 *
 *   4. Pending invitation → accept it on the fly, then
 *      { action: "create-password" }.
 *
 *   5. Brand-new email (signup) → { action: "create-password" }. The
 *      actual user record is created by /api/auth/set-password once the
 *      password is supplied. This skips the email-roundtrip verification
 *      entirely; the @kubegraf.io domain restriction acts as the gate.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  findUserByEmail, upsertUser,
  findInvitationByEmail, upsertInvitation,
} from "../_lib/db.js";
import { issueSetupToken } from "../_lib/auth.js";
import { sendMail, passwordSetupEmail } from "../_lib/email.js";
import {
  readBody, ok, badRequest, methodNotAllowed,
  normalizeEmail, emailLooksValid, uuid, nowIso,
  isAllowedEmail, emailDomainError,
} from "../_lib/helpers.js";
import type { User } from "../_lib/types.js";

interface Body {
  email?: string;
  mode?: "reset";
  intent?: "signin" | "signup";   // explicit user intent from the UI
}

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
  const intent: "signin" | "signup" | null =
    body.intent === "signin" ? "signin" :
    body.intent === "signup" ? "signup" : null;

  if (!emailLooksValid(email)) return badRequest(res, "Enter a valid email address");
  if (!isAllowedEmail(email)) return res.status(400).json({ error: emailDomainError(), code: "EMAIL_DOMAIN_NOT_ALLOWED" });

  const existing = await findUserByEmail(email);

  // Enforce explicit intent when supplied.
  if (intent === "signin" && !existing && mode !== "reset") {
    // Don't silently create a new account on a sign-in attempt.
    return res.status(404).json({
      error: "No account exists for that email. Create one with Sign up.",
      code: "NO_ACCOUNT",
    });
  }
  if (intent === "signup" && existing && existing.active && existing.passwordHash) {
    return res.status(409).json({
      error: "An account already exists for that email. Use Sign in instead.",
      code: "ACCOUNT_EXISTS",
    });
  }

  /* 1. Existing active user with a password */
  if (existing && existing.active && existing.passwordHash) {
    if (mode === "reset") {
      await sendSetupLink({ to: email, name: existing.name, purpose: "reset" });
      return ok(res, { action: "email-sent" });
    }
    return ok(res, { action: "password", name: existing.name || "" });
  }

  /* 2. Existing user, no password yet → let them set one directly */
  if (existing && existing.active && !existing.passwordHash) {
    return ok(res, { action: "create-password", name: existing.name || "" });
  }

  /* 3. Inactive account — generic response, no email sent */
  if (existing && !existing.active) {
    return ok(res, { action: "email-sent" });
  }

  /* 4. Pending invitation → accept on the fly, ask for password */
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
    return ok(res, { action: "create-password", name: "" });
  }

  /* 5. Brand-new email → tell the UI to ask for a password (no email roundtrip) */
  return ok(res, { action: "create-password", name: "" });
}
