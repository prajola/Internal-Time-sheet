/**
 * POST /api/auth/verify
 * Body: { token }
 *
 * Verifies the magic-link JWT, looks up the user, and issues a long-
 * lived session cookie. Returns the user object so the frontend can
 * skip the immediate /me round-trip.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyMagicToken, issueSessionToken, setSessionCookie } from "../_lib/auth.js";
import { findUserByEmail } from "../_lib/db.js";
import { readBody, ok, badRequest, methodNotAllowed } from "../_lib/helpers.js";

interface Body { token?: string }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res);

  const { token } = readBody<Body>(req);
  if (!token || typeof token !== "string") return badRequest(res, "token required");

  const claims = verifyMagicToken(token);
  if (!claims) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const user = await findUserByEmail(claims.email);
  if (!user || !user.active) {
    res.status(403).json({ error: "Account not found or disabled" });
    return;
  }

  const session = issueSessionToken(user);
  setSessionCookie(res, session);

  return ok(res, {
    success: true,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
}
