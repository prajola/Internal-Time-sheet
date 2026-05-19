/**
 * GET  /api/queries — list support queries.
 *                     Employee → only their own. Admin → all.
 *
 * POST /api/queries — body { action } variants:
 *     { action: "create", category, subject, body, taskId? }
 *         Employee (or admin) raises a new query.
 *         → notifies all admins; returns the created query.
 *
 *     { action: "respond", id, response, status? }
 *         Admin only. Adds adminResponse (overwrites any prior),
 *         optionally also changes status. Notifies the query's owner.
 *
 *     { action: "update-status", id, status }
 *         Admin only. Changes just the status. Notifies the owner.
 *
 *     { action: "delete", id }
 *         Owner or admin. Removes the query record.
 *
 * Combined into one route to stay under Vercel Hobby's 12-function limit.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth } from "./_lib/auth.js";
import {
  listQueries,
  listQueriesForUser,
  findQuery,
  upsertQuery,
  removeQuery,
  listUsers,
  findUserById,
} from "./_lib/db.js";
import { readBody, ok, badRequest, methodNotAllowed, nowIso, uuid } from "./_lib/helpers.js";
import { notifyUser } from "./_lib/notify.js";
import type {
  SupportQuery,
  QueryCategory,
  QueryStatus,
} from "./_lib/types.js";

const VALID_CATEGORIES: QueryCategory[] = ["PORTAL", "TECHNICAL", "TASK", "OTHER"];
const VALID_STATUSES: QueryStatus[] = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];

interface PostBody {
  action?: "create" | "respond" | "update-status" | "delete";
  id?: string;
  category?: QueryCategory;
  subject?: string;
  body?: string;
  taskId?: string | null;
  response?: string;
  status?: QueryStatus;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const me = await requireAuth(req, res);
  if (!me) return;

  if (req.method === "GET") {
    const all = me.role === "ADMIN" ? await listQueries() : await listQueriesForUser(me.id);
    return ok(res, { queries: all });
  }

  if (req.method !== "POST") return methodNotAllowed(res);

  const body = readBody<PostBody>(req);

  /* ── create — any signed-in user ───────────────────────────── */
  if (body.action === "create") {
    if (!body.subject?.trim()) return badRequest(res, "Subject is required");
    if (!body.body?.trim()) return badRequest(res, "Description is required");
    if (!body.category || !VALID_CATEGORIES.includes(body.category)) {
      return badRequest(res, "Category must be one of PORTAL/TECHNICAL/TASK/OTHER");
    }

    const now = nowIso();
    const q: SupportQuery = {
      id: uuid(),
      userId: me.id,
      userName: me.name || "",
      userEmail: me.email,
      category: body.category,
      subject: body.subject.trim().slice(0, 200),
      body: body.body.trim(),
      status: "OPEN",
      taskId: body.taskId || null,
      createdAt: now,
      updatedAt: now,
      adminResponse: "",
      respondedAt: null,
      respondedBy: null,
      respondedByName: null,
    };
    await upsertQuery(q);

    // Notify every admin's inbox. (Fire-and-forget per recipient.)
    const admins = (await listUsers()).filter((u) => u.role === "ADMIN" && u.active);
    await Promise.all(
      admins.map((a) =>
        notifyUser({
          to: a,
          kind: "query-raised",
          title: `New ${q.category.toLowerCase()} query`,
          body: `${q.userName || q.userEmail}: ${q.subject}`,
          link: "/queries",
          from: { id: me.id, name: me.name, email: me.email },
        }),
      ),
    );

    return ok(res, { query: q }, 201);
  }

  /* ── respond — admin only ──────────────────────────────────── */
  if (body.action === "respond") {
    if (me.role !== "ADMIN") return res.status(403).json({ error: "Admin only" });
    if (!body.id) return badRequest(res, "id required");
    if (typeof body.response !== "string" || !body.response.trim()) {
      return badRequest(res, "response is required");
    }
    const q = await findQuery(body.id);
    if (!q) return badRequest(res, "Query not found");

    const now = nowIso();
    q.adminResponse = body.response.trim();
    q.respondedAt = now;
    q.respondedBy = me.id;
    q.respondedByName = me.name || me.email;
    q.updatedAt = now;
    if (body.status && VALID_STATUSES.includes(body.status)) q.status = body.status;

    await upsertQuery(q);

    // Tell the owner.
    const owner = await findUserById(q.userId);
    if (owner) {
      await notifyUser({
        to: owner,
        kind: "query-responded",
        title: "Your query has a response",
        body: `${me.name || me.email}: ${q.adminResponse.slice(0, 140)}${q.adminResponse.length > 140 ? "…" : ""}`,
        link: "/my-queries",
        from: { id: me.id, name: me.name, email: me.email },
      });
    }

    return ok(res, { query: q });
  }

  /* ── update-status — admin only ────────────────────────────── */
  if (body.action === "update-status") {
    if (me.role !== "ADMIN") return res.status(403).json({ error: "Admin only" });
    if (!body.id) return badRequest(res, "id required");
    if (!body.status || !VALID_STATUSES.includes(body.status)) {
      return badRequest(res, "status must be OPEN/IN_PROGRESS/RESOLVED/CLOSED");
    }
    const q = await findQuery(body.id);
    if (!q) return badRequest(res, "Query not found");

    if (q.status === body.status) return ok(res, { query: q });

    q.status = body.status;
    q.updatedAt = nowIso();
    await upsertQuery(q);

    const owner = await findUserById(q.userId);
    if (owner) {
      await notifyUser({
        to: owner,
        kind: "query-status-changed",
        title: `Query status: ${q.status.toLowerCase().replace("_", " ")}`,
        body: q.subject,
        link: "/my-queries",
        from: { id: me.id, name: me.name, email: me.email },
      });
    }
    return ok(res, { query: q });
  }

  /* ── delete — owner or admin ───────────────────────────────── */
  if (body.action === "delete") {
    if (!body.id) return badRequest(res, "id required");
    const q = await findQuery(body.id);
    if (!q) return ok(res, { success: true }); // idempotent
    if (q.userId !== me.id && me.role !== "ADMIN") {
      return res.status(403).json({ error: "You can only delete your own queries" });
    }
    await removeQuery(body.id);
    return ok(res, { success: true });
  }

  return badRequest(res, "Unknown action");
}
