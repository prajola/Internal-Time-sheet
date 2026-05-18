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
