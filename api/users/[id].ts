/**
 * GET    /api/users/:id                — view (auth required; non-admins only their own)
 * PATCH  /api/users/:id                — update name/role/active + forceSignOut + resetPassword (admin)
 * DELETE /api/users/:id                — soft-delete (default) or hard-delete with ?hard=1 (admin)
 *
 * Every admin action that affects a user is mirrored into that user's
 * in-app notification inbox AND emailed to their address.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth, requireAdmin, issueSetupToken } from "../_lib/auth.js";
import { findUserById, upsertUser, listUsers, removeUserHard } from "../_lib/db.js";
import { readBody, ok, badRequest, notFound, methodNotAllowed, nowIso } from "../_lib/helpers.js";
import { notifyAdmin, notifyUser } from "../_lib/notify.js";
import { sendMail, passwordSetupEmail, accountUpdateEmail } from "../_lib/email.js";
import { publicUser } from "../_lib/passwords.js";
import type { Role, User } from "../_lib/types.js";

interface PatchBody {
  name?: string;
  role?: Role;
  active?: boolean;
  forceSignOut?: boolean;   // admin → revokes all of this user's active sessions
  resetPassword?: boolean;  // admin → emails reset link, clears existing hash
}

function appUrl(): string {
  return (process.env.APP_URL || "https://internal-time-sheet.vercel.app").replace(/\/$/, "");
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
    return ok(res, { user: publicUser(u) });
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
    const next: User = { ...u };
    // Side-effect notifications to fire AFTER persistence succeeds.
    const userNotifications: Array<() => Promise<void>> = [];

    if (typeof body.name === "string" && body.name.trim() && (isSelf || isAdmin)) {
      changes.name = `${u.name} → ${body.name.trim()}`;
      next.name = body.name.trim();
    }

    if (body.role && isAdmin) {
      if (body.role !== "ADMIN" && body.role !== "EMPLOYEE") return badRequest(res, "Invalid role");
      if (body.role !== u.role) {
        changes.role = `${u.role} → ${body.role}`;
        next.role = body.role;
        if (!isSelf) {
          const newRole = body.role;
          userNotifications.push(() => notifyUser({
            to: next,
            kind: "account-role-changed",
            title: newRole === "ADMIN" ? "You're now a workspace admin" : "Your role was updated",
            body: newRole === "ADMIN"
              ? `${me.name} promoted you to Admin. You now have access to the Manage portal.`
              : `${me.name} changed your role to Employee.`,
            link: "/",
            from: { id: me.id, name: me.name, email: me.email },
            email: accountUpdateEmail({
              to: next.email,
              recipientName: next.name,
              actorName: me.name,
              headline: newRole === "ADMIN" ? "You're now a workspace admin" : "Your role was updated",
              detail: newRole === "ADMIN"
                ? `${me.name} promoted you to Admin. You now have access to the Manage portal in KubeGraf Time Sheet.`
                : `${me.name} changed your role to Employee in KubeGraf Time Sheet.`,
              appUrl: appUrl(),
              ctaLabel: "Open KubeGraf",
              ctaHref: appUrl(),
            }),
          }));
        }
      }
    }

    if (typeof body.active === "boolean" && isAdmin) {
      if (!body.active && u.id === me.id) return badRequest(res, "You can't deactivate yourself");
      if (body.active !== u.active) {
        changes.active = `${u.active} → ${body.active}`;
        next.active = body.active;
        if (!isSelf) {
          const enabled = body.active;
          userNotifications.push(() => notifyUser({
            to: { ...next, active: true }, // make sure the email still goes through on disable
            kind: enabled ? "account-enabled" : "account-disabled",
            title: enabled ? "Your account was re-enabled" : "Your account was disabled",
            body: enabled
              ? `${me.name} re-enabled your sign-in access.`
              : `${me.name} disabled your sign-in access. Contact ${me.email} if this was unexpected.`,
            from: { id: me.id, name: me.name, email: me.email },
            email: accountUpdateEmail({
              to: next.email,
              recipientName: next.name,
              actorName: me.name,
              headline: enabled ? "Your account was re-enabled" : "Your account was disabled",
              detail: enabled
                ? `${me.name} re-enabled your sign-in access to KubeGraf Time Sheet.`
                : `${me.name} disabled your sign-in access to KubeGraf Time Sheet. You will be signed out and won't be able to sign back in until access is restored.`,
              appUrl: appUrl(),
            }),
          }));
        }
      }
    }

    if (body.forceSignOut && isAdmin) {
      next.sessionsRevokedAt = nowIso();
      changes.forceSignOut = "all sessions revoked";
      if (!isSelf) {
        userNotifications.push(() => notifyUser({
          to: next,
          kind: "account-force-signout",
          title: "You were signed out of all sessions",
          body: `${me.name} revoked your active sessions. You'll need to sign in again.`,
          from: { id: me.id, name: me.name, email: me.email },
        }));
      }
    }

    // Admin "Reset password" — clears the existing hash, emails a 24h setup link.
    if (body.resetPassword && isAdmin) {
      next.passwordHash = null;
      next.passwordSetAt = null;
      changes.resetPassword = "reset link emailed";

      const token = issueSetupToken(u.email, "reset");
      const link = `${appUrl()}/auth/set-password?token=${encodeURIComponent(token)}`;
      const tpl = passwordSetupEmail({
        to: u.email,
        name: u.name,
        link,
        purpose: "reset",
        invitedBy: me.name,
      });
      // Email is sent here directly because we have a unique reset link
      // and don't want to duplicate it into the generic notify path.
      await sendMail({ to: u.email, subject: tpl.subject, text: tpl.text, html: tpl.html, replyTo: me.email })
        .catch((err) => console.warn("[users/[id]] reset email failed:", err));

      userNotifications.push(() => notifyUser({
        to: next,
        kind: "account-password-reset",
        title: "Password reset by admin",
        body: `${me.name} sent a password-reset link to your email. Your current password will no longer work.`,
        from: { id: me.id, name: me.name, email: me.email },
      }));
    }

    if (Object.keys(changes).length === 0) return badRequest(res, "No allowed changes");

    await upsertUser(next);

    // Fire all queued user notifications (in-app + their own emails).
    await Promise.all(userNotifications.map((fn) => fn().catch((err) => console.warn("[notify queued]", err))));

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

    return ok(res, { user: publicUser(next) });
  }

  if (req.method === "DELETE") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (admin.id === id) return badRequest(res, "You can't delete yourself");
    const u = await findUserById(id);
    if (!u) return notFound(res, "User not found");

    const hard = req.query.hard === "1" || req.query.hard === "true";

    const allUsers = await listUsers();
    if (u.role === "ADMIN") {
      const otherActiveAdmins = allUsers.filter((x) => x.role === "ADMIN" && x.active && x.id !== u.id);
      if (otherActiveAdmins.length === 0) {
        return badRequest(res, "Cannot remove the last active admin");
      }
    }

    if (hard) {
      await removeUserHard(u.id);
      // No in-app notification — the inbox is gone with the user.
      await sendMail({
        to: u.email,
        subject: "Your KubeGraf account was removed",
        text: `${admin.name} permanently removed your account from KubeGraf Internal Time Sheet.`,
        html: `<p>${admin.name} permanently removed your account from KubeGraf Internal Time Sheet.</p>`,
        replyTo: admin.email,
      }).catch((err) => console.warn("[users/[id]] hard-delete email failed:", err));

      await notifyAdmin({
        subject: "User permanently deleted",
        summary: `${admin.name} permanently deleted ${u.email}.`,
        details: {
          User: u.email,
          Role: u.role,
          "By": `${admin.name} <${admin.email}>`,
          Note: "Hard delete — user record + time entries removed.",
        },
        byUser: admin,
      });
      return ok(res, { success: true, hard: true });
    }

    const next: User = { ...u, active: false };
    await upsertUser(next);

    await notifyUser({
      to: { ...next, active: true }, // bypass the "skip deactivated" guard so the email still sends
      kind: "account-disabled",
      title: "Your account was disabled",
      body: `${admin.name} disabled your account. Contact ${admin.email} to restore access.`,
      from: { id: admin.id, name: admin.name, email: admin.email },
      email: accountUpdateEmail({
        to: next.email,
        recipientName: next.name,
        actorName: admin.name,
        headline: "Your account was disabled",
        detail: `${admin.name} disabled your KubeGraf Time Sheet account. You will be signed out and won't be able to sign back in until access is restored.`,
        appUrl: appUrl(),
      }),
    }).catch((err) => console.warn("[users/[id]] notifyUser disable failed:", err));

    await notifyAdmin({
      subject: "User deactivated",
      summary: `${admin.name} deactivated ${u.email}.`,
      details: { User: u.email, "By": `${admin.name} <${admin.email}>` },
      byUser: admin,
    });

    return ok(res, { user: publicUser(next) });
  }

  return methodNotAllowed(res);
}
