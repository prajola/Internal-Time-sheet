import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import type { User } from "../types";

export default function Login() {
  const [, navigate] = useLocation();
  const { setUser } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setHint(null); setBusy(true);
    try {
      const r = await api.post<{ user: User }>("/api/auth/login", { email: email.trim(), password });
      setUser(r.user);
      navigate("/");
    } catch (e) {
      if (e instanceof ApiError && e.status === 403 && /not activated/i.test(e.message)) {
        setHint(e.message);
      } else {
        setErr(e instanceof Error ? e.message : "Sign-in failed");
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-[#0b0b0d]">
      <div className="w-full max-w-[440px]">
        {/* Brand row */}
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-brand-300 to-brand-500 flex items-center justify-center text-black font-display font-bold text-sm">K</div>
          <div className="leading-tight">
            <div className="font-display text-[15px] font-semibold tracking-tight text-white">KubeGraf</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">Internal Time Sheet</div>
          </div>
        </div>

        {/* Login card */}
        <div className="bg-[#141418] border border-white/[0.06] rounded-xl p-8 shadow-[0_2px_6px_rgba(0,0,0,0.4)]">
          <h1 className="text-[22px] font-semibold text-white mb-1.5 tracking-tight">Sign in</h1>
          <p className="text-[13px] text-white/55 mb-7">to continue to your workspace</p>

          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="text-[11px] uppercase tracking-[0.14em] text-white/50 mb-1.5 block">Email address</span>
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@kubegraf.io"
                className="ko-input h-11"
                autoFocus
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-[0.14em] text-white/50 mb-1.5 block flex items-center justify-between">
                <span>Password</span>
                <a href="/forgot-password" className="normal-case tracking-normal text-[12px] text-brand-100 hover:text-brand-50 hover:underline">Forgot password?</a>
              </span>
              <div className="relative">
                <input
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="ko-input h-11 pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-md flex items-center justify-center text-white/45 hover:text-white/80"
                  aria-label={show ? "Hide password" : "Show password"}
                >
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            {err && (
              <div className="text-[13px] text-red-300 bg-red-500/10 border border-red-400/20 rounded-md px-3 py-2.5">
                {err}
              </div>
            )}
            {hint && (
              <div className="text-[13px] text-amber-200 bg-amber-500/10 border border-amber-400/25 rounded-md px-3 py-2.5">
                {hint}{" "}
                <a href="/forgot-password" className="underline underline-offset-2 hover:text-amber-100">Send setup link</a>
              </div>
            )}

            <button
              type="submit"
              disabled={busy || !email || !password}
              className="ko-btn-primary w-full h-11 text-[14px] font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {busy ? "Signing in…" : <>Sign in <ArrowRight size={15} /></>}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-white/[0.06] text-[12px] text-white/45 leading-relaxed">
            First time? Use the <span className="text-white/65">Set your password</span> link
            from your invite email, or click <a href="/forgot-password" className="text-brand-100 hover:underline">Forgot password?</a> above.
          </div>
        </div>

        <p className="text-[11px] text-white/35 text-center mt-5">
          Authorized employees only · Audit-logged
        </p>
      </div>
    </div>
  );
}
