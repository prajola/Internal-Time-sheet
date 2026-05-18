/**
 * GET    /api/users/:id    — view (auth required; non-admins only their own)
 * PATCH  /api/users/:id    — update name (self) / role + active (admin only)
 * DELETE /api/users/:id    — soft-delete (admin only, can't delete self)
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth, requireAdmin } from "../_lib/auth.js";
import { findUserById, upsertUser, listUsers } from "../_lib/db.js";
import { readBody, ok, badRequest, notFound, methodNotAllowed } from "../_lib/helpers.js";
import { notifyAdmin } from "../_lib/notify.js";
import type { Role } from "../_lib/types.js";

interface PatchBody {
  name?: string;
  role?: Role;
  active?: boolean;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = String(req.query.id || "");
  if (!id) return badRequest(res, "id required");

  if (req.method === "GET") {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== "ADMIN" && me.id !== id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const u = await findUserById(id);
    if (!u) return notFound(res, "User not found");
    return ok(res, { user: u });
  }

  if (req.method === "PATCH") {
    const me = await requireAuth(req, res);
    if (!me) return;
    const u = await findUserById(id);
    if (!u) return notFound(res, "User not found");

    const body = readBody<PatchBody>(req);
    const isSelf = me.id === u.id;
    const isAdmin = me.role === "ADMIN";

    const changes: Record<string, string> = {};
    const next = { ...u };

    if (typeof body.name === "string" && body.name.trim() && (isSelf || isAdmin)) {
      changes.name = `${u.name} → ${body.name.trim()}`;
      next.name = body.name.trim();
    }
    if (body.role && isAdmin) {
      if (body.role !== "ADMIN" && body.role !== "EMPLOYEE") return badRequest(res, "Invalid role");
      changes.role = `${u.role} → ${body.role}`;
      next.role = body.role;
    }
    if (typeof body.active === "boolean" && isAdmin) {
      // Never let an admin deactivate themselves to lock out the workspace.
      if (!body.active && u.id === me.id) return badRequest(res, "You can't deactivate yourself");
      changes.active = `${u.active} → ${body.active}`;
      next.active = body.active;
    }

    if (Object.keys(changes).length === 0) return badRequest(res, "No allowed changes");

    await upsertUser(next);

    await notifyAdmin({
      subject: "User updated",
      summary: `${me.name} updated user ${u.email}.`,
      details: {
        User: u.email,
        ...changes,
        "By": `${me.name} <${me.email}>`,
      },
      byUser: me,
    });

    return ok(res, { user: next });
  }

  if (req.method === "DELETE") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (admin.id === id) return badRequest(res, "You can't delete yourself");
    const u = await findUserById(id);
    if (!u) return notFound(res, "User not found");

    // Soft-delete: deactivate (preserves time history + audit trail).
    const next = { ...u, active: false };
    await upsertUser(next);

    // If we just disabled the last active admin, re-promote to prevent lockout.
    const users = await listUsers();
    const activeAdmins = users.filter((x) => x.role === "ADMIN" && x.active);
    if (activeAdmins.length === 0) {
      const restored = { ...next, active: true };
      await upsertUser(restored);
      return badRequest(res, "Cannot remove the last active admin");
    }

    await notifyAdmin({
      subject: "User deactivated",
      summary: `${admin.name} deactivated ${u.email}.`,
      details: { User: u.email, "By": `${admin.name} <${admin.email}>` },
      byUser: admin,
    });

    return ok(res, { user: next });
  }

  return methodNotAllowed(res);
}
