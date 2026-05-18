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

/* ── Magic-link email ─────────────────────────────────────────── */

export function magicLinkEmail(opts: {
  to: string;
  link: string;
  isFirstAdmin?: boolean;
}): { subject: string; text: string; html: string } {
  const greeting = opts.isFirstAdmin
    ? "Welcome — you've been bootstrapped as the workspace admin."
    : "Sign in to your KubeGraf workspace.";
  const subject = "Your KubeGraf sign-in link";
  const text = [
    greeting,
    "",
    "Click the link below to sign in. It expires in 10 minutes.",
    "",
    opts.link,
    "",
    "If you didn't request this, you can safely ignore the email.",
  ].join("\n");
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#111;line-height:1.5;max-width:520px">
      <h2 style="margin:0 0 12px 0;color:#000;">${greeting}</h2>
      <p style="margin:0 0 18px 0;color:#444;">
        Click the button below to sign in. The link is valid for 10 minutes and can only be used once.
      </p>
      <p>
        <a href="${opts.link}"
           style="display:inline-block;padding:12px 24px;background:#ffa340;color:#000;font-weight:600;
                  text-decoration:none;border-radius:8px;">
          Sign in to KubeGraf
        </a>
      </p>
      <p style="margin-top:24px;color:#666;font-size:12px;">
        If the button doesn't work, paste this URL into your browser:<br>
        <span style="color:#888;word-break:break-all;">${opts.link}</span>
      </p>
      <p style="margin-top:24px;color:#888;font-size:12px;">
        If you didn't request this, you can safely ignore this email.
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
