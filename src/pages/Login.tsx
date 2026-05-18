import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, Mail, AlertTriangle, User as UserIcon, Shield } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import type { User } from "../types";

type Intent = "signin" | "signup";
type Portal = "EMPLOYEE" | "ADMIN";

const ALLOWED_DOMAIN_HINT = "@kubegraf.io";
const DOMAIN_REGEX = /@kubegraf\.io$/i;

interface Strength { score: 0 | 1 | 2 | 3 | 4; label: string; tone: string }
function scoreStrength(pw: string): Strength {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  const labels = ["Very weak", "Weak", "Fair", "Strong", "Excellent"] as const;
  const tones  = ["text-red-600", "text-red-600", "text-amber-600", "text-emerald-700", "text-emerald-700"] as const;
  const c = Math.max(0, Math.min(4, s)) as 0|1|2|3|4;
  return { score: c, label: labels[c], tone: tones[c] };
}

export default function Login() {
  const [, navigate] = useLocation();
  const { setUser } = useAuth();

  const [intent, setIntent] = useState<Intent>("signin");
  const [portal, setPortal] = useState<Portal>("EMPLOYEE");

  // Shared form fields. Sign-up adds confirm + name on top.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [show, setShow] = useState(false);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  const trimmedEmail = email.trim();

  const clientDomainOk = useMemo(() => {
    if (!trimmedEmail) return true;
    return DOMAIN_REGEX.test(trimmedEmail);
  }, [trimmedEmail]);

  function checkDomain(): boolean {
    if (!trimmedEmail) return false;
    if (!DOMAIN_REGEX.test(trimmedEmail)) {
      setDomainError(`Wrong email. Please use your organization email (${ALLOWED_DOMAIN_HINT}). Gmail, Yahoo and other personal addresses aren't allowed.`);
      return false;
    }
    setDomainError(null);
    return true;
  }

  // Sign-up password requirements live state.
  const strength = useMemo(() => scoreStrength(password), [password]);
  const reqOk = useMemo(() => {
    const length = password.length >= 8;
    const letter = /[A-Za-z]/.test(password);
    const digit  = /\d/.test(password);
    const match  = password.length > 0 && password === confirm;
    return { length, letter, digit, match, all: length && letter && digit && match };
  }, [password, confirm]);

  function switchIntent(next: Intent) {
    setIntent(next);
    setErr(null);
    setDomainError(null);
    setPassword("");
    setConfirm("");
    setResetSent(false);
  }

  // Single-step sign-in: email + password → POST /api/auth/login.
  async function submitSignIn(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!checkDomain()) return;
    setBusy(true);
    try {
      const r = await api.post<{ user: User }>("/api/auth/login", {
        email: trimmedEmail,
        password,
        role: portal,
      });
      setUser(r.user);
      navigate(r.user.role === "ADMIN" ? "/manage" : "/");
    } catch (e) {
      if (e instanceof ApiError && (e as any).status === 403) {
        // PASSWORD_NOT_SET or ROLE_MISMATCH both arrive as 403 with helpful messages.
        setErr(e.message);
      } else {
        setErr(e instanceof Error ? e.message : "Sign-in failed");
      }
    } finally { setBusy(false); }
  }

  // Single-step sign-up: email + password + name → POST /api/auth/set-password.
  async function submitSignUp(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!checkDomain()) return;
    if (!reqOk.all) { setErr("Fix the highlighted requirements first."); return; }
    setBusy(true);
    try {
      const r = await api.post<{ user: User; firstSet: boolean }>(
        "/api/auth/set-password",
        { email: trimmedEmail, password, name: displayName.trim() },
      );
      setUser(r.user);
      navigate(r.user.role === "ADMIN" ? "/manage" : "/");
    } catch (e) {
      if (e instanceof ApiError && (e as any).status === 409) {
        setErr("An account already exists for that email. Switch to Sign in.");
      } else {
        setErr(e instanceof Error ? e.message : "Could not create account");
      }
    } finally { setBusy(false); }
  }

  async function sendReset() {
    if (!checkDomain()) return;
    setBusy(true); setErr(null);
    try {
      await api.post("/api/auth/start", { email: trimmedEmail, mode: "reset" });
      setResetSent(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not send reset link");
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[460px]">
        {/* Brand */}
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-brand-300 to-brand-500 flex items-center justify-center text-black font-display font-bold text-sm">K</div>
          <div className="leading-tight">
            <div className="font-display text-[15px] font-semibold tracking-tight text-gray-900">KubeGraf</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Internal Time Sheet</div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-8 shadow-sm">
          {resetSent ? (
            <div className="text-center py-2">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-brand-50 border border-brand-200 flex items-center justify-center">
                <Mail size={20} className="text-brand-600" />
              </div>
              <h1 className="text-[20px] font-semibold text-gray-900 mb-1.5">Check your inbox</h1>
              <p className="text-[13px] text-gray-600 mb-6 leading-relaxed">
                If <span className="text-gray-900 break-all">{trimmedEmail}</span> matches an account,
                a password reset link is on its way.
                <br />The link expires in 24 hours.
              </p>
              <div className="bg-gray-50 border border-gray-200 rounded-md p-3 mb-5 text-left text-[12px] text-gray-600 leading-relaxed">
                <div className="flex items-start gap-2">
                  <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0 mt-0.5" />
                  <span>Don't see it? Check spam or promotions. The sender is <span className="text-gray-900">kubegraf@gmail.com</span>.</span>
                </div>
              </div>
              <button onClick={() => { setResetSent(false); setErr(null); }} className="ko-btn-ghost inline-flex items-center justify-center h-10 px-4 text-[13px] gap-1.5">
                <ArrowLeft size={14} /> Back to sign in
              </button>
            </div>
          ) : (
            <>
              {/* Sign in / Sign up tabs */}
              <div className="flex bg-gray-100 rounded-lg p-1 mb-6">
                <button
                  type="button"
                  onClick={() => switchIntent("signin")}
                  className={
                    "flex-1 h-9 rounded-md text-[13px] font-medium transition " +
                    (intent === "signin"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700")
                  }
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => switchIntent("signup")}
                  className={
                    "flex-1 h-9 rounded-md text-[13px] font-medium transition " +
                    (intent === "signup"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700")
                  }
                >
                  Sign up
                </button>
              </div>

              {/* Portal selector — sign-in only */}
              {intent === "signin" && (
                <div className="mb-6">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-gray-500 mb-2">Sign in as</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => { setPortal("EMPLOYEE"); setErr(null); }}
                      className={
                        "flex items-center justify-center gap-2 px-3 py-2.5 rounded-md border text-[13px] font-medium transition " +
                        (portal === "EMPLOYEE"
                          ? "bg-brand-50 border-brand-300 text-brand-800"
                          : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")
                      }
                    >
                      <UserIcon size={14} /> User
                    </button>
                    <button
                      type="button"
                      onClick={() => { setPortal("ADMIN"); setErr(null); }}
                      className={
                        "flex items-center justify-center gap-2 px-3 py-2.5 rounded-md border text-[13px] font-medium transition " +
                        (portal === "ADMIN"
                          ? "bg-brand-50 border-brand-300 text-brand-800"
                          : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")
                      }
                    >
                      <Shield size={14} /> Admin
                    </button>
                  </div>
                </div>
              )}

              <h1 className="text-[22px] font-semibold text-gray-900 mb-1.5 tracking-tight">
                {intent === "signin"
                  ? (portal === "ADMIN" ? "Admin sign in" : "Sign in")
                  : "Create your account"}
              </h1>
              <p className="text-[13px] text-gray-500 mb-6">
                Use your work email — only <span className="text-gray-800">{ALLOWED_DOMAIN_HINT}</span> addresses are allowed.
              </p>

              {intent === "signin" ? (
                <form onSubmit={submitSignIn} className="space-y-4">
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-gray-500 mb-1.5 block">Email address</span>
                    <input
                      type="email"
                      autoComplete="username"
                      required
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setDomainError(null); }}
                      onBlur={() => trimmedEmail && checkDomain()}
                      placeholder={`you${ALLOWED_DOMAIN_HINT}`}
                      className={"ko-input h-11 " + (domainError ? "!border-red-300 focus:!border-red-400 focus:!ring-red-200" : "")}
                      autoFocus
                    />
                  </label>

                  <label className="block">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-gray-500 mb-1.5 block">Password</span>
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
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-md flex items-center justify-center text-gray-400 hover:text-gray-700"
                        aria-label={show ? "Hide" : "Show"}
                      >
                        {show ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </label>

                  {domainError && (
                    <div className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2.5 inline-flex items-start gap-2">
                      <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                      <span>{domainError}</span>
                    </div>
                  )}
                  {err && !domainError && (
                    <div className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2.5">{err}</div>
                  )}

                  <button
                    type="submit"
                    disabled={busy || !email || !password || !clientDomainOk}
                    className="ko-btn-primary w-full h-11 text-[14px] font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {busy ? "Signing in…" : <>Sign in <ArrowRight size={15} /></>}
                  </button>

                  <div className="text-center pt-2">
                    <button
                      type="button"
                      onClick={sendReset}
                      disabled={busy || !email}
                      className="text-[12px] text-brand-700 hover:text-brand-800 hover:underline disabled:opacity-50"
                    >
                      Forgot password?
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={submitSignUp} className="space-y-4">
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-gray-500 mb-1.5 block">
                      Display name <span className="normal-case tracking-normal text-gray-400">(optional)</span>
                    </span>
                    <input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Your full name"
                      className="ko-input h-11"
                      autoFocus
                    />
                  </label>

                  <label className="block">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-gray-500 mb-1.5 block">Email address</span>
                    <input
                      type="email"
                      autoComplete="username"
                      required
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setDomainError(null); }}
                      onBlur={() => trimmedEmail && checkDomain()}
                      placeholder={`you${ALLOWED_DOMAIN_HINT}`}
                      className={"ko-input h-11 " + (domainError ? "!border-red-300 focus:!border-red-400 focus:!ring-red-200" : "")}
                    />
                  </label>

                  <label className="block">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-gray-500 mb-1.5 block">Password</span>
                    <div className="relative">
                      <input
                        type={show ? "text" : "password"}
                        autoComplete="new-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="ko-input h-11 pr-11"
                      />
                      <button
                        type="button"
                        onClick={() => setShow((s) => !s)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-md flex items-center justify-center text-gray-400 hover:text-gray-700"
                        aria-label={show ? "Hide" : "Show"}
                      >
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
                    <Req ok={reqOk.length}>At least 8 characters</Req>
                    <Req ok={reqOk.letter}>Contains at least one letter</Req>
                    <Req ok={reqOk.digit}>Contains at least one number</Req>
                    <Req ok={reqOk.match}>Passwords match</Req>
                  </ul>

                  {domainError && (
                    <div className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2.5 inline-flex items-start gap-2">
                      <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                      <span>{domainError}</span>
                    </div>
                  )}
                  {err && !domainError && (
                    <div className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2.5">{err}</div>
                  )}

                  <button
                    type="submit"
                    disabled={busy || !email || !reqOk.all || !clientDomainOk}
                    className="ko-btn-primary w-full h-11 text-[14px] font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {busy ? "Creating account…" : <>Create account & sign in <ArrowRight size={15} /></>}
                  </button>
                </form>
              )}

              <p className="text-[11px] text-gray-500 mt-6 leading-relaxed text-center">
                {intent === "signin" ? "Don't have an account yet? " : "Already have an account? "}
                <button
                  type="button"
                  onClick={() => switchIntent(intent === "signin" ? "signup" : "signin")}
                  className="text-brand-700 hover:underline"
                >
                  {intent === "signin" ? "Sign up here" : "Sign in instead"}
                </button>
              </p>
            </>
          )}
        </div>

        <p className="text-[11px] text-gray-400 text-center mt-5">
          Authorized for KubeGraf team members · Audit-logged
        </p>
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
