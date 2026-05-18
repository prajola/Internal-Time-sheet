/**
 * POST /api/auth/request
 * Body: { email }
 *
 * Issues a magic-link JWT and emails it to the user. Three accepted
 * scenarios:
 *   1) email matches an existing user → send link
 *   2) email matches an active invitation → accept invite + send link
 *   3) email matches BOOTSTRAP_ADMIN_EMAIL and no users exist yet
 *      → create first admin + send link
 *
 * Otherwise we return success: true anyway (don't leak which addresses
 * have accounts), but no email is sent.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { findUserByEmail, listUsers, upsertUser, findInvitationByEmail, upsertInvitation } from "../_lib/db.js";
import { issueMagicToken } from "../_lib/auth.js";
import { sendMail, magicLinkEmail } from "../_lib/email.js";
import { uuid, nowIso, normalizeEmail, emailLooksValid, readBody, ok, badRequest, methodNotAllowed } from "../_lib/helpers.js";

interface Body { email?: string }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res);

  const { email } = readBody<Body>(req);
  if (!emailLooksValid(email)) return badRequest(res, "Valid email required");
  const e = normalizeEmail(email);

  const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
  if (!appUrl) {
    res.status(500).json({ error: "APP_URL not configured on server" });
    return;
  }

  // 1) Existing active user — send sign-in link.
  let user = await findUserByEmail(e);

  // 2) Active invitation — accept it + create the user.
  if (!user) {
    const invite = await findInvitationByEmail(e);
    if (invite) {
      user = {
        id: uuid(),
        email: e,
        name: e.split("@")[0],
        role: invite.role,
        active: true,
        createdAt: nowIso(),
        invitedBy: invite.invitedBy,
      };
      await upsertUser(user);
      await upsertInvitation({ ...invite, acceptedAt: nowIso() });
    }
  }

  // 3) Bootstrap admin — if the env-configured email signs in and no
  //    users exist yet, create them as the first admin.
  if (!user) {
    const bootstrap = (process.env.BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
    const userCount = (await listUsers()).length;
    if (bootstrap && bootstrap === e && userCount === 0) {
      user = {
        id: uuid(),
        email: e,
        name: "Admin",
        role: "ADMIN",
        active: true,
        createdAt: nowIso(),
      };
      await upsertUser(user);
    }
  }

  // Always return 200 — don't leak account existence.
  if (!user) {
    console.log("[auth.request] unknown email — ignored:", e);
    return ok(res, { success: true });
  }

  if (!user.active) {
    console.log("[auth.request] disabled user — ignored:", e);
    return ok(res, { success: true });
  }

  const token = issueMagicToken(e);
  const link = `${appUrl}/auth/verify?token=${encodeURIComponent(token)}`;
  const isFirstAdmin = (await listUsers()).length === 1 && user.role === "ADMIN";
  const email_ = magicLinkEmail({ to: e, link, isFirstAdmin });

  const result = await sendMail({
    to: e,
    subject: email_.subject,
    text: email_.text,
    html: email_.html,
  });
  if (!result.ok) console.warn("[auth.request] mail failed:", result.error);

  return ok(res, { success: true });
}
