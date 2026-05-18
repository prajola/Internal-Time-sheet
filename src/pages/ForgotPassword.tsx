import { useState } from "react";
import { ArrowLeft, Mail } from "lucide-react";
import { api } from "../lib/api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.post("/api/auth/start", { email: email.trim(), mode: "reset" });
      setSent(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not send link");
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-[#0b0b0d]">
      <div className="w-full max-w-[440px]">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-brand-300 to-brand-500 flex items-center justify-center text-black font-display font-bold text-sm">K</div>
          <div className="leading-tight">
            <div className="font-display text-[15px] font-semibold tracking-tight text-white">KubeGraf</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">Internal Time Sheet</div>
          </div>
        </div>

        <div className="bg-[#141418] border border-white/[0.06] rounded-xl p-8 shadow-[0_2px_6px_rgba(0,0,0,0.4)]">
          {sent ? (
            <div className="text-center py-2">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-brand-500/15 border border-brand-400/30 flex items-center justify-center">
                <Mail size={20} className="text-brand-200" />
              </div>
              <h1 className="text-[20px] font-semibold text-white mb-1.5">Check your inbox</h1>
              <p className="text-[13px] text-white/60 mb-6">
                If <span className="text-white/85">{email}</span> matches an account or pending invite,
                a password setup link is on its way. It's valid for 24 hours.
              </p>
              <a href="/login" className="ko-btn-ghost inline-flex items-center justify-center h-10 px-4 text-[13px] gap-1.5">
                <ArrowLeft size={14} /> Back to sign in
              </a>
            </div>
          ) : (
            <>
              <h1 className="text-[20px] font-semibold text-white mb-1.5 tracking-tight">Reset your password</h1>
              <p className="text-[13px] text-white/55 mb-7">Enter your email and we'll send you a link to set a new password.</p>

              <form onSubmit={submit} className="space-y-4">
                <label className="block">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-white/50 mb-1.5 block">Email address</span>
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@kubegraf.io"
                    className="ko-input h-11"
                    autoFocus
                  />
                </label>

                {err && (
                  <div className="text-[13px] text-red-300 bg-red-500/10 border border-red-400/20 rounded-md px-3 py-2.5">{err}</div>
                )}

                <button
                  type="submit"
                  disabled={busy || !email}
                  className="ko-btn-primary w-full h-11 text-[14px] font-semibold disabled:opacity-50"
                >
                  {busy ? "Sending…" : "Send reset link"}
                </button>
              </form>

              <div className="mt-6 pt-5 border-t border-white/[0.06]">
                <a href="/login" className="text-[13px] text-white/55 hover:text-white inline-flex items-center gap-1.5">
                  <ArrowLeft size={14} /> Back to sign in
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
