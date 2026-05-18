import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import type { User } from "../types";

interface Strength { score: 0 | 1 | 2 | 3 | 4; label: string; tone: string }

function scoreStrength(pw: string): Strength {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  const labels = ["Very weak", "Weak", "Fair", "Strong", "Excellent"] as const;
  const tones = ["text-red-300", "text-red-300", "text-amber-200", "text-emerald-300", "text-emerald-300"] as const;
  const c = Math.max(0, Math.min(4, s)) as 0|1|2|3|4;
  return { score: c, label: labels[c], tone: tones[c] };
}

export default function SetPassword() {
  const [, navigate] = useLocation();
  const { setUser } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token");
    if (!t) setErr("Missing token in URL.");
    else setToken(t);
  }, []);

  const strength = useMemo(() => scoreStrength(password), [password]);
  const requirements = useMemo(() => ({
    length: password.length >= 8,
    letter: /[A-Za-z]/.test(password),
    digit:  /\d/.test(password),
    match:  password.length > 0 && password === confirm,
  }), [password, confirm]);

  const allOk = requirements.length && requirements.letter && requirements.digit && requirements.match;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (!allOk) { setErr("Fix the highlighted requirements first."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ user: User; firstSet: boolean }>("/api/auth/set-password", {
        token, password, name: name.trim(),
      });
      setUser(r.user);
      setDone(true);
      // Strip token from history and navigate after a short success beat.
      window.history.replaceState({}, "", "/");
      setTimeout(() => navigate("/"), 900);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not set password. The link may have expired.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-[#0b0b0d]">
      <div className="w-full max-w-[460px]">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-brand-300 to-brand-500 flex items-center justify-center text-black font-display font-bold text-sm">K</div>
          <div className="leading-tight">
            <div className="font-display text-[15px] font-semibold tracking-tight text-white">KubeGraf</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">Internal Time Sheet</div>
          </div>
        </div>

        <div className="bg-[#141418] border border-white/[0.06] rounded-xl p-8 shadow-[0_2px_6px_rgba(0,0,0,0.4)]">
          {done ? (
            <div className="text-center py-2">
              <CheckCircle2 size={42} className="mx-auto text-emerald-300 mb-3" />
              <h1 className="text-[20px] font-semibold text-white mb-1.5">You're all set</h1>
              <p className="text-[13px] text-white/55">Taking you to your dashboard…</p>
            </div>
          ) : err && !token ? (
            <>
              <h1 className="text-[20px] font-semibold text-white mb-1.5">Link error</h1>
              <p className="text-[13px] text-white/65 mb-6">{err}</p>
              <a href="/forgot-password" className="ko-btn-primary inline-flex items-center justify-center h-11 px-5 text-[14px] font-semibold">
                Request a new link
              </a>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck size={18} className="text-brand-300" />
                <h1 className="text-[20px] font-semibold text-white tracking-tight">Set your password</h1>
              </div>
              <p className="text-[13px] text-white/55 mb-6">Choose a password to sign in to KubeGraf Time Sheet.</p>

              <form onSubmit={submit} className="space-y-4">
                <label className="block">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-white/50 mb-1.5 block">Display name <span className="normal-case tracking-normal text-white/30">(optional)</span></span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your full name"
                    className="ko-input h-11"
                    autoFocus
                  />
                </label>

                <label className="block">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-white/50 mb-1.5 block">New password</span>
                  <div className="relative">
                    <input
                      type={show ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="ko-input h-11 pr-11"
                    />
                    <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-md flex items-center justify-center text-white/45 hover:text-white/80" aria-label={show ? "Hide" : "Show"}>
                      {show ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {password && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1 rounded-full bg-white/8 overflow-hidden">
                        <div className={"h-full transition-all " + barColor(strength.score)} style={{ width: `${(strength.score + 1) * 20}%` }} />
                      </div>
                      <span className={"text-[11px] font-medium " + strength.tone}>{strength.label}</span>
                    </div>
                  )}
                </label>

                <label className="block">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-white/50 mb-1.5 block">Confirm password</span>
                  <input
                    type={show ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="ko-input h-11"
                  />
                </label>

                <ul className="space-y-1.5 text-[12px]">
                  <Req ok={requirements.length}>At least 8 characters</Req>
                  <Req ok={requirements.letter}>Contains at least one letter</Req>
                  <Req ok={requirements.digit}>Contains at least one number</Req>
                  <Req ok={requirements.match}>Passwords match</Req>
                </ul>

                {err && (
                  <div className="text-[13px] text-red-300 bg-red-500/10 border border-red-400/20 rounded-md px-3 py-2.5">{err}</div>
                )}

                <button
                  type="submit"
                  disabled={busy || !allOk}
                  className="ko-btn-primary w-full h-11 text-[14px] font-semibold disabled:opacity-50"
                >
                  {busy ? "Setting password…" : "Set password and sign in"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Req({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={"flex items-center gap-2 " + (ok ? "text-emerald-300" : "text-white/45")}>
      <span className={"w-3.5 h-3.5 rounded-full inline-flex items-center justify-center text-[9px] font-bold " + (ok ? "bg-emerald-400/20 text-emerald-300" : "bg-white/8 text-white/30")}>
        {ok ? "✓" : "•"}
      </span>
      {children}
    </li>
  );
}

function barColor(score: number): string {
  if (score <= 1) return "bg-red-400";
  if (score === 2) return "bg-amber-400";
  return "bg-emerald-400";
}
