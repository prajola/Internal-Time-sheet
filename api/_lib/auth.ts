/**
 * Auth utilities.
 *
 *   - magic-link JWT (10-min TTL, signed with JWT_SECRET)
 *   - session JWT (30-day TTL, set as httpOnly cookie `its_session`)
 *   - getSession(req) → reads cookie, verifies JWT, returns claims
 *   - requireAuth, requireAdmin: route guards (throws if not allowed)
 *
 * The cookie is httpOnly + SameSite=Lax. The frontend never reads it
 * directly — it calls /api/auth/me to learn who the user is.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import jwt, { type Secret, type SignOptions } from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import type { SessionClaims, SetupTokenClaims, User } from "./types.js";
import { findUserById } from "./db.js";

const SESSION_COOKIE = "its_session";
const SESSION_TTL = "30d";
const SETUP_TTL = "24h";

function secret(): Secret {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return s;
}

/**
 * Issue a password-setup / password-reset link token.
 * Same shape for both — the `purpose` field is just an email-copy hint.
 */
export function issueSetupToken(email: string, purpose: "setup" | "reset" = "setup"): string {
  const claims = {
    email: email.trim().toLowerCase(),
    purpose,
    nonce: randomBytes(12).toString("hex"),
  };
  const opts: SignOptions = { expiresIn: SETUP_TTL };
  return jwt.sign(claims, secret(), opts);
}

export function verifySetupToken(token: string): SetupTokenClaims | null {
  try {
    return jwt.verify(token, secret()) as SetupTokenClaims;
  } catch {
    return null;
  }
}

export function issueSessionToken(u: User): string {
  const claims = { sub: u.id, email: u.email, role: u.role };
  const opts: SignOptions = { expiresIn: SESSION_TTL };
  return jwt.sign(claims, secret(), opts);
}

export function setSessionCookie(res: VercelResponse, token: string): void {
  // 30 days in seconds
  const maxAge = 60 * 60 * 24 * 30;
  res.setHeader(
    "Set-Cookie",
    [
      `${SESSION_COOKIE}=${token}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      `Max-Age=${maxAge}`,
    ].join("; "),
  );
}

export function clearSessionCookie(res: VercelResponse): void {
  res.setHeader(
    "Set-Cookie",
    [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=0"].join("; "),
  );
}

export function readSessionToken(req: VercelRequest): string | null {
  const header = req.headers.cookie || "";
  const match = header.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${SESSION_COOKIE}=`));
  if (!match) return null;
  return match.slice(SESSION_COOKIE.length + 1) || null;
}

export function verifySessionToken(token: string): SessionClaims | null {
  try {
    return jwt.verify(token, secret()) as SessionClaims;
  } catch {
    return null;
  }
}

export async function getSession(req: VercelRequest): Promise<{ user: User; claims: SessionClaims } | null> {
  const token = readSessionToken(req);
  if (!token) return null;
  const claims = verifySessionToken(token);
  if (!claims) return null;
  const user = await findUserById(claims.sub);
  if (!user || !user.active) return null;

  // Admin-revoked sessions: if the token was issued before the user's
  // sessionsRevokedAt timestamp, treat it as signed out.
  if (user.sessionsRevokedAt) {
    const revokedAtSec = Math.floor(new Date(user.sessionsRevokedAt).getTime() / 1000);
    if (claims.iat < revokedAtSec) return null;
  }

  return { user, claims };
}

/** Guard helpers. Return null + send error response when not allowed; otherwise return the user. */
export async function requireAuth(req: VercelRequest, res: VercelResponse): Promise<User | null> {
  const s = await getSession(req);
  if (!s) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  return s.user;
}

export async function requireAdmin(req: VercelRequest, res: VercelResponse): Promise<User | null> {
  const u = await requireAuth(req, res);
  if (!u) return null;
  if (u.role !== "ADMIN") {
    res.status(403).json({ error: "Admin only" });
    return null;
  }
  return u;
}
