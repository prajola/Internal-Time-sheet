/**
 * GET  /api/users           — list (auth required, admin-scoped data)
 * POST /api/users           — invite new user (admin only)
 *
 * Invite flow: admin POSTs { email, role }. We create an Invitation
 * record (7-day expiry) and email the invitee a magic-link sign-in
 * URL. On first sign-in, /api/auth/request consumes the invitation
 * and creates the User.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin, requireAuth } from "../_lib/auth.js";
import {
  listUsers,
  upsertInvitation,
  findInvitationByEmail,
  findUserByEmail,
} from "../_lib/db.js";
import {
  uuid,
  nowIso,
  normalizeEmail,
  emailLooksValid,
  readBody,
  ok,
  badRequest,
  methodNotAllowed,
} from "../_lib/helpers.js";
import { sendMail, passwordSetupEmail } from "../_lib/email.js";
import { issueSetupToken } from "../_lib/auth.js";
import { notifyAdmin } from "../_lib/notify.js";
import { publicUser } from "../_lib/passwords.js";
import type { Role } from "../_lib/types.js";

interface CreateBody {
  email?: string;
  name?: string;
  role?: Role;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    const me = await requireAuth(req, res);
    if (!me) return;
    const users = await listUsers();
    // Employees see only basic info (name + role); admins see everything except the password hash.
    if (me.role === "ADMIN") return ok(res, { users: users.map(publicUser) });
    return ok(res, {
      users: users.map((u) => ({ id: u.id, name: u.name, role: u.role, active: u.active })),
    });
  }

  if (req.method === "POST") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { email, name, role = "EMPLOYEE" } = readBody<CreateBody>(req);
    if (!emailLooksValid(email)) return badRequest(res, "Valid email required");
    if (role !== "ADMIN" && role !== "EMPLOYEE") return badRequest(res, "role must be ADMIN or EMPLOYEE");

    const e = normalizeEmail(email!);
    if (await findUserByEmail(e)) return badRequest(res, "User already exists");
    if (await findInvitationByEmail(e)) return badRequest(res, "Invite already pending for this email");

    const inv = {
      id: uuid(),
      email: e,
      role,
      invitedBy: admin.id,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    };
    await upsertInvitation(inv);

    // Email the invitee a "Set your password" link — single click activates account.
    const appUrlBase = (process.env.APP_URL || "https://internal-time-sheet.vercel.app").replace(/\/$/, "");
    const token = issueSetupToken(e, "setup");
    const link = `${appUrlBase}/auth/set-password?token=${encodeURIComponent(token)}`;
    const tpl = passwordSetupEmail({
      to: e,
      name: name || "",
      link,
      purpose: "setup",
      invitedBy: admin.name,
    });
    await sendMail({
      to: e,
      subject: `${admin.name} invited you to KubeGraf Time Sheet`,
      text: tpl.text,
      html: tpl.html,
      replyTo: admin.email,
    });

    await notifyAdmin({
      subject: "User invited to Time Sheet",
      summary: `${admin.name} invited ${e} as ${role}.`,
      details: {
        Invitee: e,
        "Suggested name": name ?? "",
        Role: role,
        "Invited by": `${admin.name} <${admin.email}>`,
      },
      byUser: admin,
    });

    return ok(res, { success: true, invitation: { id: inv.id, email: inv.email, role: inv.role } }, 201);
  }

  return methodNotAllowed(res);
}
