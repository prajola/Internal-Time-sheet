/**
 * POST /api/auth/set-password
 * Body (token mode):  { token, password, name? }
 * Body (direct mode): { email, password, name? }
 *
 * Sets a password on a user account and signs them in (session cookie).
 *
 *  - Token mode is used by the "Reset password" / "Set up your account"
 *    email link. We verify a 24h JWT and resolve the user by claims.email.
 *  - Direct mode is used by the on-screen signup form. Anyone with an
 *    @kubegraf.io email (or the bootstrap admin override) can claim a
 *    fresh account by setting a password. If the email already has a
 *    password set, we refuse — they must use Sign in or "Forgot password".
 *
 * For an internal tool restricted to a single email domain, direct mode
 * is the accepted tradeoff: it removes the email-roundtrip dependency
 * (which fails when @kubegraf.io has no real MX setup) without lowering
 * the trust boundary below "valid org email".
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  findUserByEmail,
  listUsers,
  upsertUser,
  findInvitationByEmail,
  upsertInvitation,
} from "../_lib/db.js";
import {
  verifySetupToken,
  issueSessionToken,
  setSessionCookie,
} from "../_lib/auth.js";
import {
  hashPassword,
  validateStrength,
  publicUser,
} from "../_lib/passwords.js";
import {
  readBody, ok, badRequest, methodNotAllowed, nowIso,
  normalizeEmail, emailLooksValid, uuid,
  isAllowedEmail, emailDomainError,
} from "../_lib/helpers.js";
import { notifyAdmin } from "../_lib/notify.js";
import type { Role, User } from "../_lib/types.js";

interface Body {
  token?: string;
  email?: string;
  password?: string;
  name?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res);

  const body = readBody<Body>(req);
  const token = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";

  const strength = validateStrength(password);
  if (!strength.ok) return badRequest(res, strength.reason || "Password is too weak");

  /* ── Token mode (email-link reset / first-time setup via link) ── */
  if (token) {
    const claims = verifySetupToken(token);
    if (!claims) return badRequest(res, "This link is invalid or has expired. Request a new one.");

    let user = await findUserByEmail(claims.email);

    // Invite-acceptance path: no user record yet, but maybe a pending
    // invitation. If so, consume it and create the user with that role.
    // (Without this, the email link from "Invite user" would always say
    // "Account not found" — old behavior, now fixed.)
    if (!user) {
      const invitation = await findInvitationByEmail(claims.email);
      if (!invitation) {
        return badRequest(res, "Account not found. Ask your admin for a fresh invitation.");
      }
      user = {
        id: uuid(),
        email: claims.email,
        name: name || "",
        role: invitation.role,
        active: true,
        createdAt: nowIso(),
        invitedBy: invitation.invitedBy,
        passwordHash: null,
        passwordSetAt: null,
      };
      // Mark the invitation accepted so it can't be re-used.
      invitation.acceptedAt = nowIso();
      try { await upsertInvitation(invitation); } catch { /* non-fatal */ }
    } else if (!user.active) {
      return badRequest(res, "Your account is disabled. Contact an admin.");
    }

    const wasFirstSet = !user.passwordHash;
    user.passwordHash = await hashPassword(password);
    user.passwordSetAt = nowIso();
    if (wasFirstSet && name) user.name = name;
    await upsertUser(user);

    setSessionCookie(res, issueSessionToken(user));

    await notifyAdmin({
      subject: wasFirstSet ? "Account activated" : "Password reset",
      summary: wasFirstSet
        ? `${user.name || user.email} activated their account.`
        : `${user.name || user.email} reset their password.`,
      details: { Email: user.email, Role: user.role, At: user.passwordSetAt! },
      byUser: user,
    });

    return ok(res, { user: publicUser(user), firstSet: wasFirstSet });
  }

  /* ── Direct mode (email + password — fresh signup or pending invite) ── */
  const email = normalizeEmail(body.email || "");
  if (!emailLooksValid(email)) return badRequest(res, "Enter a valid email");
  if (!isAllowedEmail(email)) {
    return res.status(400).json({ error: emailDomainError(), code: "EMAIL_DOMAIN_NOT_ALLOWED" });
  }

  let user = await findUserByEmail(email);

  if (user && user.passwordHash) {
    return res.status(409).json({
      error: "An account already exists for that email. Use Sign in or Forgot password.",
      code: "ACCOUNT_EXISTS",
    });
  }

  const wasFirstSet = !user;
  if (!user) {
    // Create a fresh user. If this is the bootstrap admin email on an
    // empty workspace, promote them; otherwise default to EMPLOYEE.
    const allUsers = await listUsers();
    const bootstrapEmail = normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL || "");
    const isFirstAdmin = allUsers.length === 0 && bootstrapEmail === email;
    const role: Role = isFirstAdmin ? "ADMIN" : "EMPLOYEE";

    user = {
      id: uuid(),
      email,
      name: name || "",
      role,
      active: true,
      createdAt: nowIso(),
      passwordHash: null,
      passwordSetAt: null,
    };
  } else if (name) {
    user.name = name;
  }

  user.passwordHash = await hashPassword(password);
  user.passwordSetAt = nowIso();
  await upsertUser(user);

  setSessionCookie(res, issueSessionToken(user));

  await notifyAdmin({
    subject: wasFirstSet ? "New signup" : "Account activated",
    summary: wasFirstSet
      ? `${user.name || user.email} signed up to the Internal Time Sheet.`
      : `${user.name || user.email} activated their account.`,
    details: { Email: user.email, Role: user.role, "Signed up at": user.passwordSetAt! },
    byUser: user,
  });

  return ok(res, { user: publicUser(user as User), firstSet: wasFirstSet });
}
