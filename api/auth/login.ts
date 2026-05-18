/**
 * POST /api/auth/login
 * Body: { email, password }
 *
 * Verifies the email+password pair, issues a 30-day session cookie.
 *
 * Security notes:
 * - We don't reveal whether an account exists. All wrong-credential
 *   paths (no user, no password set, bad password, inactive) return
 *   the same 401 with a generic message — modulo the "no password set
 *   yet" hint, which is a usability tradeoff (an invitee needs to know
 *   to use their setup link).
 * - We always bcrypt.compare against *something* (a dummy hash) when
 *   the user is missing, to keep login timing constant.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { findUserByEmail } from "../_lib/db.js";
import { issueSessionToken, setSessionCookie } from "../_lib/auth.js";
import { verifyPassword, publicUser } from "../_lib/passwords.js";
import {
  readBody, ok, badRequest, methodNotAllowed,
  normalizeEmail, emailLooksValid,
  isAllowedEmail, emailDomainError,
} from "../_lib/helpers.js";

interface Body { email?: string; password?: string }

// Pre-computed bcrypt hash of an empty random string — used to keep
// timing constant when the user record doesn't exist.
const DUMMY_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8K6ovgB6BqEjEy5l52L8K2yKR.r2bC";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res);

  const body = readBody<Body>(req);
  const email = normalizeEmail(body.email || "");
  const password = typeof body.password === "string" ? body.password : "";

  if (!emailLooksValid(email)) return badRequest(res, "Enter a valid email");
  if (!isAllowedEmail(email)) return res.status(400).json({ error: emailDomainError(), code: "EMAIL_DOMAIN_NOT_ALLOWED" });
  if (!password) return badRequest(res, "Password is required");

  const user = await findUserByEmail(email);

  // Constant-time path: even if user is missing or has no hash yet,
  // we still call verifyPassword once so attackers can't enumerate by timing.
  const hash = user?.passwordHash || DUMMY_HASH;
  const passwordOk = await verifyPassword(password, hash);

  if (!user || !user.active) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  if (!user.passwordHash) {
    // No password set — most likely an invited user who hasn't activated yet.
    return res.status(403).json({
      error: "Account not activated. Use the 'Set your password' link from your invite email, or click 'Forgot password?' below.",
      code: "PASSWORD_NOT_SET",
    });
  }

  if (!passwordOk) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = issueSessionToken(user);
  setSessionCookie(res, token);
  return ok(res, { user: publicUser(user) });
}
