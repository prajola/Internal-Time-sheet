/**
 * GET  /api/notifications              — list mine (newest first). ?unread=1 filters to unread.
 * POST /api/notifications              — Body { action } where action is one of:
 *     { action: "mark-read", id }      — mark a single notification read
 *     { action: "mark-all-read" }      — mark every unread notification read
 *     { action: "delete", id }         — remove a single notification
 *
 * Combined into one function for the Vercel Hobby 12-function ceiling.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth } from "./_lib/auth.js";
import {
  listNotificationsForUser,
  saveNotificationsForUser,
  updateNotification,
  removeNotification,
} from "./_lib/db.js";
import { readBody, ok, badRequest, methodNotAllowed, nowIso } from "./_lib/helpers.js";

interface PostBody {
  action?: "mark-read" | "mark-all-read" | "delete";
  id?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const me = await requireAuth(req, res);
  if (!me) return;

  if (req.method === "GET") {
    const items = await listNotificationsForUser(me.id);
    const unreadOnly = req.query.unread === "1" || req.query.unread === "true";
    const filtered = unreadOnly ? items.filter((n) => !n.readAt) : items;
    const unreadCount = items.filter((n) => !n.readAt).length;
    return ok(res, { items: filtered, unread: unreadCount, total: items.length });
  }

  if (req.method !== "POST") return methodNotAllowed(res);

  const body = readBody<PostBody>(req);
  const action = body.action;

  if (action === "mark-read") {
    if (!body.id) return badRequest(res, "id required");
    const updated = await updateNotification(me.id, body.id, { readAt: nowIso() });
    if (!updated) return badRequest(res, "Notification not found");
    return ok(res, { item: updated });
  }

  if (action === "mark-all-read") {
    const items = await listNotificationsForUser(me.id);
    const now = nowIso();
    const next = items.map((n) => (n.readAt ? n : { ...n, readAt: now }));
    await saveNotificationsForUser(me.id, next);
    return ok(res, { success: true, marked: items.filter((n) => !n.readAt).length });
  }

  if (action === "delete") {
    if (!body.id) return badRequest(res, "id required");
    await removeNotification(me.id, body.id);
    return ok(res, { success: true });
  }

  return badRequest(res, "Unknown action");
}
