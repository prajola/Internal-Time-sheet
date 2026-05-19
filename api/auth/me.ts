/**
 * GET    /api/auth/me — returns the currently signed-in user, or 401.
 * DELETE /api/auth/me — clears the session cookie (logout). 200 even
 *                       if there was no session; idempotent.
 *
 * Merged into one file to stay under Vercel Hobby's 12-function limit.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSession, clearSessionCookie } from "../_lib/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "DELETE") {
    clearSessionCookie(res);
    res.status(200).json({ success: true });
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const s = await getSession(req);
  if (!s) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const { user } = s;
  res.status(200).json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
}
