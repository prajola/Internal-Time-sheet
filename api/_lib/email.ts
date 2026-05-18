/**
 * Email sender. Wraps Nodemailer with the Gmail SMTP transport we
 * already use across the kubegraf stack (book-demo-relay).
 *
 * Env vars (set on Vercel project, Production scope):
 *   GMAIL_USER          — sending mailbox, e.g. kubegraf@gmail.com
 *   GMAIL_APP_PASSWORD  — 16-char Google App Password
 *
 * Both pieces of the same credential the book-demo-relay project
 * already uses. Reusing them keeps secrets centralised.
 */
import nodemailer from "nodemailer";

interface SendOpts {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export async function sendMail(opts: SendOpts): Promise<{ ok: boolean; error?: string }> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.warn("[email] GMAIL_USER/GMAIL_APP_PASSWORD missing — email skipped");
    console.log("[email] would-send:", JSON.stringify({ to: opts.to, subject: opts.subject }));
    return { ok: false, error: "SMTP not configured" };
  }

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });

  try {
    await transporter.sendMail({
      from: `"KubeGraf Internal Time Sheet" <${user}>`,
      to: opts.to,
      replyTo: opts.replyTo,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[email] sendMail failed:", msg);
    return { ok: false, error: msg };
  }
}

/* ── Password setup / reset email ─────────────────────────────── */

export function passwordSetupEmail(opts: {
  to: string;
  name?: string;
  link: string;
  purpose: "setup" | "reset";
  isFirstAdmin?: boolean;
  invitedBy?: string;
}): { subject: string; text: string; html: string } {
  const isReset = opts.purpose === "reset";
  const greeting = opts.name ? `Hi ${opts.name},` : "Hello,";

  const headline = isReset
    ? "Reset your KubeGraf password"
    : opts.isFirstAdmin
      ? "Welcome — set up your KubeGraf admin account"
      : "Set up your KubeGraf account";

  const intro = isReset
    ? "We received a request to reset the password on your KubeGraf Internal Time Sheet account."
    : opts.isFirstAdmin
      ? "You've been bootstrapped as the workspace administrator. Set a password to sign in."
      : opts.invitedBy
        ? `${opts.invitedBy} invited you to the KubeGraf Internal Time Sheet. Choose a password to activate your account.`
        : "You've been invited to the KubeGraf Internal Time Sheet. Choose a password to activate your account.";

  const cta = isReset ? "Reset password" : "Set password";
  const subject = isReset ? "Reset your KubeGraf password" : "Set up your KubeGraf account";

  const text = [
    greeting,
    "",
    intro,
    "",
    `Click the link below to ${isReset ? "reset" : "set"} your password. It expires in 24 hours.`,
    "",
    opts.link,
    "",
    "If you didn't request this, you can safely ignore this email — no changes will be made.",
    "",
    "— KubeGraf Internal Time Sheet",
  ].join("\n");

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;line-height:1.5;max-width:520px;margin:0 auto;padding:24px;">
      <div style="border:1px solid #e5e7eb;border-radius:12px;padding:32px;background:#fff;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
          <div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#ffd486,#ffa340);display:inline-flex;align-items:center;justify-content:center;color:#000;font-weight:700;">K</div>
          <div>
            <div style="font-weight:600;font-size:15px;color:#111;">KubeGraf</div>
            <div style="font-size:11px;color:#6b7280;letter-spacing:0.12em;text-transform:uppercase;">Internal Time Sheet</div>
          </div>
        </div>
        <h2 style="margin:0 0 12px 0;font-size:22px;font-weight:600;color:#111;">${headline}</h2>
        <p style="margin:0 0 16px 0;color:#374151;">${greeting}</p>
        <p style="margin:0 0 24px 0;color:#374151;">${intro}</p>
        <p style="margin:0 0 28px 0;">
          <a href="${opts.link}"
             style="display:inline-block;padding:12px 22px;background:#ffa340;color:#111;font-weight:600;
                    text-decoration:none;border-radius:8px;font-size:14px;">
            ${cta}
          </a>
        </p>
        <p style="margin:0 0 8px 0;color:#6b7280;font-size:12px;">This link expires in 24 hours and can only be used once.</p>
        <p style="margin:0 0 24px 0;color:#6b7280;font-size:12px;">If the button doesn't work, paste this URL into your browser:</p>
        <p style="margin:0 0 28px 0;font-size:12px;color:#9ca3af;word-break:break-all;background:#f9fafb;padding:10px 12px;border-radius:6px;border:1px solid #f3f4f6;">${opts.link}</p>
        <hr style="border:none;border-top:1px solid #f3f4f6;margin:20px 0;" />
        <p style="margin:0;color:#9ca3af;font-size:11px;">
          If you didn't request this, you can safely ignore this email — no changes will be made to your account.
        </p>
      </div>
      <p style="text-align:center;margin:16px 0 0 0;color:#9ca3af;font-size:11px;">
        KubeGraf · Internal use only
      </p>
    </div>
  `;
  return { subject, text, html };
}

/* ── Task assignment email (to the assignee) ──────────────────── */

export function taskAssignmentEmail(opts: {
  to: string;
  assigneeName: string;
  taskTitle: string;
  taskDescription?: string;
  priority: string;
  dueDate?: string | null;
  assignedBy: { name: string; email: string };
  appUrl: string;
  isReassignment?: boolean;
}): { subject: string; text: string; html: string } {
  const greeting = opts.assigneeName ? `Hi ${opts.assigneeName.split(" ")[0]},` : "Hi,";
  const headline = opts.isReassignment
    ? "A task was reassigned to you"
    : "You have a new task";

  const subject = opts.isReassignment
    ? `Reassigned: ${opts.taskTitle}`
    : `New task: ${opts.taskTitle}`;

  const dueLine = opts.dueDate ? `Due ${opts.dueDate}` : "No due date";
  const text = [
    greeting,
    "",
    opts.isReassignment
      ? `${opts.assignedBy.name} reassigned a task to you.`
      : `${opts.assignedBy.name} assigned a new task to you.`,
    "",
    `Title:    ${opts.taskTitle}`,
    `Priority: ${opts.priority}`,
    `${dueLine}`,
    opts.taskDescription ? `\n${opts.taskDescription}` : "",
    "",
    `Open it in your dashboard: ${opts.appUrl}/my-tasks`,
    "",
    "— KubeGraf Internal Time Sheet",
  ].filter(Boolean).join("\n");

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;line-height:1.5;max-width:560px;margin:0 auto;padding:24px;">
      <div style="border:1px solid #e5e7eb;border-radius:12px;padding:32px;background:#fff;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
          <div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#ffd486,#ffa340);display:inline-flex;align-items:center;justify-content:center;color:#000;font-weight:700;">K</div>
          <div>
            <div style="font-weight:600;font-size:15px;color:#111;">KubeGraf</div>
            <div style="font-size:11px;color:#6b7280;letter-spacing:0.12em;text-transform:uppercase;">Internal Time Sheet</div>
          </div>
        </div>

        <h2 style="margin:0 0 10px 0;font-size:22px;font-weight:600;color:#111;">${headline}</h2>
        <p style="margin:0 0 8px 0;color:#374151;">${greeting}</p>
        <p style="margin:0 0 24px 0;color:#374151;">
          <strong>${escapeHtml(opts.assignedBy.name)}</strong>
          ${opts.isReassignment ? "reassigned" : "assigned"} a task to you.
        </p>

        <div style="border:1px solid #f3f4f6;border-radius:10px;padding:16px 18px;margin:0 0 24px 0;background:#fafafa;">
          <div style="font-weight:600;color:#111;font-size:16px;margin-bottom:6px;">${escapeHtml(opts.taskTitle)}</div>
          ${
            opts.taskDescription
              ? `<div style="color:#4b5563;font-size:13px;margin-bottom:12px;white-space:pre-wrap;">${escapeHtml(opts.taskDescription)}</div>`
              : ""
          }
          <table style="border-collapse:collapse;font-size:12px;color:#6b7280;">
            <tr><td style="padding:2px 12px 2px 0;">Priority</td><td style="color:#111;">${escapeHtml(opts.priority)}</td></tr>
            <tr><td style="padding:2px 12px 2px 0;">${opts.dueDate ? "Due" : "Due date"}</td><td style="color:#111;">${escapeHtml(opts.dueDate || "—")}</td></tr>
            <tr><td style="padding:2px 12px 2px 0;">Assigned by</td><td style="color:#111;">${escapeHtml(opts.assignedBy.name)} &lt;${escapeHtml(opts.assignedBy.email)}&gt;</td></tr>
          </table>
        </div>

        <p style="margin:0 0 28px 0;">
          <a href="${opts.appUrl}/my-tasks"
             style="display:inline-block;padding:11px 22px;background:#ffa340;color:#111;font-weight:600;
                    text-decoration:none;border-radius:8px;font-size:14px;">
            Open my tasks
          </a>
        </p>

        <hr style="border:none;border-top:1px solid #f3f4f6;margin:20px 0;" />
        <p style="margin:0;color:#9ca3af;font-size:11px;">
          You're receiving this because a workspace admin assigned a task to you in KubeGraf Internal Time Sheet.
        </p>
      </div>
      <p style="text-align:center;margin:16px 0 0 0;color:#9ca3af;font-size:11px;">
        KubeGraf · Internal use only
      </p>
    </div>
  `;
  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ── Task status-changed email (to admin / creator) ───────────── */

export function taskStatusEmail(opts: {
  to: string;
  recipientName: string;
  actorName: string;
  taskTitle: string;
  oldStatus: string;
  newStatus: string;
  appUrl: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.recipientName ? `Hi ${opts.recipientName.split(" ")[0]},` : "Hi,";
  const isDone = opts.newStatus === "DONE";
  const subject = isDone
    ? `Done: ${opts.taskTitle}`
    : `Status update: ${opts.taskTitle}`;
  const text = [
    greeting,
    "",
    `${opts.actorName} changed the status of "${opts.taskTitle}".`,
    "",
    `Was:  ${opts.oldStatus}`,
    `Now:  ${opts.newStatus}`,
    "",
    `Open it: ${opts.appUrl}/tasks`,
    "",
    "— KubeGraf Internal Time Sheet",
  ].join("\n");
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;line-height:1.5;max-width:560px;margin:0 auto;padding:24px;">
      <div style="border:1px solid #e5e7eb;border-radius:12px;padding:32px;background:#fff;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
          <div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#ffd486,#ffa340);display:inline-flex;align-items:center;justify-content:center;color:#000;font-weight:700;">K</div>
          <div>
            <div style="font-weight:600;font-size:15px;color:#111;">KubeGraf</div>
            <div style="font-size:11px;color:#6b7280;letter-spacing:0.12em;text-transform:uppercase;">Internal Time Sheet</div>
          </div>
        </div>
        <h2 style="margin:0 0 10px 0;font-size:20px;font-weight:600;color:#111;">${isDone ? "Task marked done" : "Task status updated"}</h2>
        <p style="margin:0 0 8px 0;color:#374151;">${greeting}</p>
        <p style="margin:0 0 18px 0;color:#374151;">
          <strong>${escapeHtml(opts.actorName)}</strong> changed the status of
          <strong>${escapeHtml(opts.taskTitle)}</strong>.
        </p>
        <table style="border-collapse:collapse;font-size:13px;color:#6b7280;margin:0 0 22px 0;">
          <tr><td style="padding:3px 12px 3px 0;">Was</td><td style="color:#111;">${escapeHtml(opts.oldStatus)}</td></tr>
          <tr><td style="padding:3px 12px 3px 0;">Now</td><td style="color:#111;">${escapeHtml(opts.newStatus)}</td></tr>
        </table>
        <p style="margin:0 0 24px 0;">
          <a href="${opts.appUrl}/tasks"
             style="display:inline-block;padding:11px 22px;background:#ffa340;color:#111;font-weight:600;
                    text-decoration:none;border-radius:8px;font-size:14px;">Open tasks</a>
        </p>
        <hr style="border:none;border-top:1px solid #f3f4f6;margin:20px 0;" />
        <p style="margin:0;color:#9ca3af;font-size:11px;">
          KubeGraf · Internal use only
        </p>
      </div>
    </div>
  `;
  return { subject, text, html };
}

/* ── Account-management notification (to the affected user) ───── */

export function accountUpdateEmail(opts: {
  to: string;
  recipientName: string;
  actorName: string;
  headline: string;       // "Your role has been updated", "Your password was reset", etc.
  detail: string;         // human description of what changed
  appUrl: string;
  ctaLabel?: string;
  ctaHref?: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.recipientName ? `Hi ${opts.recipientName.split(" ")[0]},` : "Hi,";
  const subject = opts.headline;
  const text = [
    greeting,
    "",
    opts.detail,
    "",
    opts.ctaHref ? `Open it: ${opts.ctaHref}` : `Open the app: ${opts.appUrl}`,
    "",
    `If this wasn't expected, contact ${opts.actorName}.`,
    "",
    "— KubeGraf Internal Time Sheet",
  ].join("\n");
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;line-height:1.5;max-width:520px;margin:0 auto;padding:24px;">
      <div style="border:1px solid #e5e7eb;border-radius:12px;padding:32px;background:#fff;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
          <div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#ffd486,#ffa340);display:inline-flex;align-items:center;justify-content:center;color:#000;font-weight:700;">K</div>
          <div>
            <div style="font-weight:600;font-size:15px;color:#111;">KubeGraf</div>
            <div style="font-size:11px;color:#6b7280;letter-spacing:0.12em;text-transform:uppercase;">Internal Time Sheet</div>
          </div>
        </div>
        <h2 style="margin:0 0 10px 0;font-size:20px;font-weight:600;color:#111;">${escapeHtml(opts.headline)}</h2>
        <p style="margin:0 0 8px 0;color:#374151;">${greeting}</p>
        <p style="margin:0 0 22px 0;color:#374151;">${escapeHtml(opts.detail)}</p>
        <p style="margin:0 0 24px 0;">
          <a href="${opts.ctaHref || opts.appUrl}"
             style="display:inline-block;padding:11px 22px;background:#ffa340;color:#111;font-weight:600;
                    text-decoration:none;border-radius:8px;font-size:14px;">${escapeHtml(opts.ctaLabel || "Open KubeGraf")}</a>
        </p>
        <p style="margin:0 0 4px 0;color:#6b7280;font-size:12px;">
          This change was applied by <strong>${escapeHtml(opts.actorName)}</strong>.
        </p>
        <hr style="border:none;border-top:1px solid #f3f4f6;margin:20px 0;" />
        <p style="margin:0;color:#9ca3af;font-size:11px;">
          If you didn't expect this, reply to this email or contact your workspace admin.
        </p>
      </div>
    </div>
  `;
  return { subject, text, html };
}

/* ── Generic admin-notification email ─────────────────────────── */

export function adminNotifyEmail(opts: {
  subject: string;
  summary: string;
  details: Record<string, string | number | undefined>;
  byUser: { name: string; email: string };
}): { subject: string; text: string; html: string } {
  const rows = Object.entries(opts.details)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#666;">${k}</td><td>${String(v)}</td></tr>`,
    )
    .join("");
  const text = [
    opts.summary,
    "",
    `By: ${opts.byUser.name} <${opts.byUser.email}>`,
    "",
    ...Object.entries(opts.details).map(([k, v]) => `  ${k}: ${v ?? ""}`),
  ].join("\n");
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#111;line-height:1.5;max-width:560px">
      <h2 style="margin:0 0 8px 0;">${opts.subject}</h2>
      <p style="margin:0 0 16px 0;color:#444;">${opts.summary}</p>
      <table style="border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:4px 12px 4px 0;color:#666;">By</td><td><strong>${opts.byUser.name}</strong> &lt;${opts.byUser.email}&gt;</td></tr>
        ${rows}
      </table>
    </div>
  `;
  return { subject: opts.subject, text, html };
}
