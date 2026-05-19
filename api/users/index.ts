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
  isAllowedEmail,
  emailDomainError,
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

/**
 * Choose the base URL for setup links. Prefer the explicit APP_URL env
 * var (set in production), otherwise derive from the request itself so
 * `vercel dev` on localhost generates localhost links rather than the
 * production-ish placeholder.
 */
function appUrlFromRequest(req: VercelRequest): string {
  const fromEnv = process.env.APP_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string) || "http";
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "localhost:5050";
  return `${proto}://${host}`;
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
    if (!isAllowedEmail(e)) return badRequest(res, emailDomainError());
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

    // Generate the "Set your password" link. The admin gets it back in
    // the response so they can copy + share via Slack/WhatsApp/SMS even
    // when SMTP isn't configured. We still try to email it.
    const appUrlBase = appUrlFromRequest(req);
    const token = issueSetupToken(e, "setup");
    const setupLink = `${appUrlBase}/auth/set-password?token=${encodeURIComponent(token)}`;
    const tpl = passwordSetupEmail({
      to: e,
      name: name || "",
      link: setupLink,
      purpose: "setup",
      invitedBy: admin.name,
    });
    const mail = await sendMail({
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

    return ok(res, {
      success: true,
      invitation: { id: inv.id, email: inv.email, role: inv.role },
      setupLink,
      emailSent: mail.ok,
    }, 201);
  }

  return methodNotAllowed(res);
}
