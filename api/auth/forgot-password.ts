/**
 * POST /api/auth/forgot-password
 * Body: { email }
 *
 * Sends a password-setup or password-reset link to the supplied email,
 * if it matches:
 *   - an existing active user (any role — admins included), OR
 *   - an outstanding invitation (creates the user on the fly), OR
 *   - the BOOTSTRAP_ADMIN_EMAIL env var on a fresh workspace (zero users).
 *
 * Always returns 200 with a generic message — never reveals whether
 * the email is registered.
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
import type { User } from "../_lib/types.js";

interface Body { email?: string }

function appUrl(): string {
  return process.env.APP_URL || "https://internal-time-sheet.vercel.app";
}

function setupLink(token: string): string {
  return `${appUrl().replace(/\/$/, "")}/auth/set-password?token=${encodeURIComponent(token)}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res);

  const body = readBody<Body>(req);
  const email = normalizeEmail(body.email || "");
  if (!emailLooksValid(email)) return badRequest(res, "Enter a valid email");

  // Generic response — same body whether or not the email matches.
  const generic = { success: true } as const;

  // 1) Existing user → reset link
  const existing = await findUserByEmail(email);
  if (existing && existing.active) {
    const purpose: "setup" | "reset" = existing.passwordHash ? "reset" : "setup";
    const token = issueSetupToken(email, purpose);
    const link = setupLink(token);
    const tpl = passwordSetupEmail({
      to: email,
      name: existing.name,
      link,
      purpose,
    });
    await sendMail({ to: email, subject: tpl.subject, text: tpl.text, html: tpl.html });
    return ok(res, generic);
  }

  // 2) Pending invitation → accept it, create the user, send setup link
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

    const token = issueSetupToken(email, "setup");
    const link = setupLink(token);
    const tpl = passwordSetupEmail({
      to: email, name: "", link, purpose: "setup",
    });
    await sendMail({ to: email, subject: tpl.subject, text: tpl.text, html: tpl.html });
    return ok(res, generic);
  }

  // 3) Bootstrap admin path (env-var + zero users)
  const bootstrapEmail = normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL || "");
  if (bootstrapEmail && bootstrapEmail === email) {
    const users = await listUsers();
    if (users.length === 0) {
      const newAdmin: User = {
        id: uuid(),
        email,
        name: "Admin",
        role: "ADMIN",
        active: true,
        createdAt: nowIso(),
        passwordHash: null,
        passwordSetAt: null,
      };
      await upsertUser(newAdmin);
      const token = issueSetupToken(email, "setup");
      const link = setupLink(token);
      const tpl = passwordSetupEmail({
        to: email, name: "Admin", link, purpose: "setup", isFirstAdmin: true,
      });
      await sendMail({ to: email, subject: tpl.subject, text: tpl.text, html: tpl.html });
      return ok(res, generic);
    }
  }

  // Generic response for the no-match path as well.
  return ok(res, generic);
}
