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
import { requireAdmin, requireAuth } from "../_lib/auth";
import {
  listUsers,
  upsertInvitation,
  findInvitationByEmail,
  findUserByEmail,
} from "../_lib/db";
import {
  uuid,
  nowIso,
  normalizeEmail,
  emailLooksValid,
  readBody,
  ok,
  badRequest,
  methodNotAllowed,
} from "../_lib/helpers";
import { sendMail, magicLinkEmail } from "../_lib/email";
import { issueMagicToken } from "../_lib/auth";
import { notifyAdmin } from "../_lib/notify";
import type { Role } from "../_lib/types";

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
    // Employees see only basic info (name + role); admins see all.
    if (me.role === "ADMIN") return ok(res, { users });
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

    // Send magic link straight away so they can complete signup on first click.
    const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
    if (appUrl) {
      const token = issueMagicToken(e);
      const link = `${appUrl}/auth/verify?token=${encodeURIComponent(token)}`;
      const email_ = magicLinkEmail({ to: e, link });
      await sendMail({
        to: e,
        subject: `${admin.name} invited you to KubeGraf Time Sheet`,
        text:
          `${admin.name} (${admin.email}) invited you to join the KubeGraf internal time sheet as a ${role.toLowerCase()}.\n\n` +
          email_.text,
        html: `<p>${admin.name} (&lt;${admin.email}&gt;) invited you as a <strong>${role.toLowerCase()}</strong>.</p>` + email_.html,
        replyTo: admin.email,
      });
    }

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
