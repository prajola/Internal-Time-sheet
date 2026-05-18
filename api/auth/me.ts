/**
 * GET /api/auth/me — returns the currently signed-in user, or 401.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSession } from "../_lib/auth";

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
