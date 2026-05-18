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
  const tones = ["text-red-600", "text-red-600", "text-amber-600", "text-emerald-700", "text-emerald-700"] as const;
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
      window.history.replaceState({}, "", "/");
      setTimeout(() => navigate("/"), 900);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not set password. The link may have expired.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[460px]">
        <div className="flex items-center gap-2.5 mb-5">
          <img src="/kubegraf-logo.png" alt="KubeGraf" className="w-9 h-9 object-contain" />
          <div className="leading-tight">
            <div className="font-display text-[15px] font-semibold tracking-tight text-gray-900">KubeGraf</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Internal Time Sheet</div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-8 shadow-sm">
          {done ? (
            <div className="text-center py-2">
              <CheckCircle2 size={42} className="mx-auto text-emerald-600 mb-3" />
              <h1 className="text-[20px] font-semibold text-gray-900 mb-1.5">You're all set</h1>
              <p className="text-[13px] text-gray-500">Taking you to your dashboard…</p>
            </div>
          ) : err && !token ? (
            <>
              <h1 className="text-[20px] font-semibold text-gray-900 mb-1.5">Link error</h1>
              <p className="text-[13px] text-gray-600 mb-6">{err}</p>
              <a href="/login" className="ko-btn-primary inline-flex items-center justify-center h-11 px-5 text-[14px] font-semibold">
                Request a new link
              </a>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck size={18} className="text-brand-600" />
                <h1 className="text-[20px] font-semibold text-gray-900 tracking-tight">Set your password</h1>
              </div>
              <p className="text-[13px] text-gray-500 mb-6">Choose a password to sign in to KubeGraf Time Sheet.</p>

              <form onSubmit={submit} className="space-y-4">
                <label className="block">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-gray-500 mb-1.5 block">Display name <span className="normal-case tracking-normal text-gray-400">(optional)</span></span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your full name"
                    className="ko-input h-11"
                    autoFocus
                  />
                </label>

                <label className="block">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-gray-500 mb-1.5 block">New password</span>
                  <div className="relative">
                    <input
                      type={show ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="ko-input h-11 pr-11"
                    />
                    <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-md flex items-center justify-center text-gray-400 hover:text-gray-700" aria-label={show ? "Hide" : "Show"}>
                      {show ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {password && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1 rounded-full bg-gray-200 overflow-hidden">
                        <div className={"h-full transition-all " + barColor(strength.score)} style={{ width: `${(strength.score + 1) * 20}%` }} />
                      </div>
                      <span className={"text-[11px] font-medium " + strength.tone}>{strength.label}</span>
                    </div>
                  )}
                </label>

                <label className="block">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-gray-500 mb-1.5 block">Confirm password</span>
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
                  <div className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2.5">{err}</div>
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
    <li className={"flex items-center gap-2 " + (ok ? "text-emerald-700" : "text-gray-500")}>
      <span className={"w-3.5 h-3.5 rounded-full inline-flex items-center justify-center text-[9px] font-bold " + (ok ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-400")}>
        {ok ? "✓" : "•"}
      </span>
      {children}
    </li>
  );
}

function barColor(score: number): string {
  if (score <= 1) return "bg-red-500";
  if (score === 2) return "bg-amber-500";
  return "bg-emerald-500";
}
