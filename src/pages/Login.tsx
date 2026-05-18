import { useState } from "react";
import { api } from "../lib/api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.post("/api/auth/request", { email: email.trim() });
      setSent(true);
    } catch (e: any) {
      setErr(e?.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="ko-card-glow p-8 w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-md bg-gradient-to-br from-brand-300 to-brand-500 flex items-center justify-center text-black font-display font-bold">K</div>
          <div className="leading-tight">
            <div className="font-display text-lg font-semibold tracking-tight">KubeGraf</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Internal Time Sheet</div>
          </div>
        </div>

        {sent ? (
          <div>
            <h1 className="font-display text-2xl mb-2">Check your inbox.</h1>
            <p className="text-sm text-white/70">
              If <span className="text-brand-100">{email}</span> is registered or invited,
              we sent a one-time sign-in link. It expires in 10 minutes.
            </p>
            <button
              type="button"
              onClick={() => { setSent(false); setEmail(""); }}
              className="ko-btn-ghost mt-6 h-10 px-4 text-sm w-full"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h1 className="font-display text-2xl mb-1">Sign in</h1>
            <p className="text-sm text-white/60 mb-6">
              Enter your work email. We'll send you a one-time sign-in link.
            </p>
            <label className="block text-xs uppercase tracking-[0.16em] text-white/50 mb-2">Email</label>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@kubegraf.io"
              className="ko-input"
            />
            {err && <div className="mt-3 text-sm text-red-300">{err}</div>}
            <button type="submit" disabled={busy || !email} className="ko-btn-primary w-full mt-6 h-11">
              {busy ? "Sending…" : "Send sign-in link"}
            </button>
            <p className="text-[11px] text-white/40 mt-5 leading-relaxed">
              Authorized employees only. Updates to time entries and tasks are
              audit-logged and reported to administrators.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
