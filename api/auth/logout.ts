import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clearSessionCookie } from "../_lib/auth.js";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  clearSessionCookie(res);
  res.status(200).json({ success: true });
}
