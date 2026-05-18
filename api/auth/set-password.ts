/**
 * POST /api/auth/set-password
 * Body: { token, password, name? }
 *
 * Validates the setup token, validates the password, hashes it, stores
 * it on the user, and signs the user in (session cookie).
 *
 * Token TTL is 24h. The token is single-use in spirit but we don't
 * persist nonces — JWT verification + the `passwordSetAt` audit field
 * are enough for this internal tool. A second use of the same token
 * before expiry would silently re-hash the same password.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { findUserByEmail, upsertUser } from "../_lib/db.js";
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
} from "../_lib/helpers.js";
import { notifyAdmin } from "../_lib/notify.js";

interface Body { token?: string; password?: string; name?: string }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res);

  const body = readBody<Body>(req);
  const token = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!token) return badRequest(res, "Missing token");
  const claims = verifySetupToken(token);
  if (!claims) return badRequest(res, "This link is invalid or has expired. Request a new one.");

  const strength = validateStrength(password);
  if (!strength.ok) return badRequest(res, strength.reason || "Password is too weak");

  const user = await findUserByEmail(claims.email);
  if (!user || !user.active) return badRequest(res, "Account not found or inactive");

  const wasFirstSet = !user.passwordHash;
  user.passwordHash = await hashPassword(password);
  user.passwordSetAt = nowIso();
  if (wasFirstSet && name) user.name = name;
  await upsertUser(user);

  // Issue a session cookie so they don't have to log in again.
  const sessionToken = issueSessionToken(user);
  setSessionCookie(res, sessionToken);

  // Audit notification — admins love these.
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
