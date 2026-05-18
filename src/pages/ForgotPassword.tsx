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
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[440px]">
        <div className="flex items-center gap-2.5 mb-5">
          <img src="/kubegraf-logo.png" alt="KubeGraf" className="w-9 h-9 object-contain" />
          <div className="leading-tight">
            <div className="font-display text-[15px] font-semibold tracking-tight text-gray-900">KubeGraf</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Internal Time Sheet</div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-8 shadow-sm">
          {sent ? (
            <div className="text-center py-2">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-brand-50 border border-brand-200 flex items-center justify-center">
                <Mail size={20} className="text-brand-600" />
              </div>
              <h1 className="text-[20px] font-semibold text-gray-900 mb-1.5">Check your inbox</h1>
              <p className="text-[13px] text-gray-600 mb-6">
                If <span className="text-gray-900">{email}</span> matches an account or pending invite,
                a password setup link is on its way. It's valid for 24 hours.
              </p>
              <a href="/login" className="ko-btn-ghost inline-flex items-center justify-center h-10 px-4 text-[13px] gap-1.5">
                <ArrowLeft size={14} /> Back to sign in
              </a>
            </div>
          ) : (
            <>
              <h1 className="text-[20px] font-semibold text-gray-900 mb-1.5 tracking-tight">Reset your password</h1>
              <p className="text-[13px] text-gray-500 mb-7">Enter your email and we'll send you a link to set a new password.</p>

              <form onSubmit={submit} className="space-y-4">
                <label className="block">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-gray-500 mb-1.5 block">Email address</span>
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
                  <div className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2.5">{err}</div>
                )}

                <button
                  type="submit"
                  disabled={busy || !email}
                  className="ko-btn-primary w-full h-11 text-[14px] font-semibold disabled:opacity-50"
                >
                  {busy ? "Sending…" : "Send reset link"}
                </button>
              </form>

              <div className="mt-6 pt-5 border-t border-gray-200">
                <a href="/login" className="text-[13px] text-gray-500 hover:text-gray-900 inline-flex items-center gap-1.5">
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
