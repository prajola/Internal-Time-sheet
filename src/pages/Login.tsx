import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, Mail, AlertTriangle } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import type { User } from "../types";

type Step = "email" | "password" | "email-sent";
type Intent = "signin" | "signup";

const ALLOWED_DOMAIN_HINT = "@kubegraf.io";
const DOMAIN_REGEX = /@kubegraf\.io$/i;

export default function Login() {
  const [, navigate] = useLocation();
  const { setUser } = useAuth();
  const [intent, setIntent] = useState<Intent>("signin");
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [domainError, setDomainError] = useState<string | null>(null);

  const trimmedEmail = email.trim();

  const clientDomainOk = useMemo(() => {
    if (!trimmedEmail) return true; // don't yell at an empty field
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

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!checkDomain()) return;
    setBusy(true);
    try {
      const r = await api.post<{ action: "password" | "email-sent"; name?: string }>(
        "/api/auth/start",
        { email: trimmedEmail, intent },
      );
      if (r.action === "password") {
        setName(r.name || "");
        setStep("password");
      } else {
        setStep("email-sent");
      }
    } catch (e) {
      if (e instanceof ApiError && (e as any).status === 404 && intent === "signin") {
        setErr("No account exists for that email. Switch to Sign up to create one.");
      } else if (e instanceof ApiError && (e as any).status === 409 && intent === "signup") {
        setErr("An account already exists. Switch to Sign in.");
      } else {
        setErr(e instanceof Error ? e.message : "Something went wrong");
      }
    } finally { setBusy(false); }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const r = await api.post<{ user: User }>("/api/auth/login", {
        email: trimmedEmail, password,
      });
      setUser(r.user);
      navigate("/");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Sign-in failed");
    } finally { setBusy(false); }
  }

  async function sendReset() {
    setErr(null); setBusy(true);
    try {
      await api.post("/api/auth/start", { email: trimmedEmail, mode: "reset" });
      setStep("email-sent");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not send link");
    } finally { setBusy(false); }
  }

  function goBack() {
    setStep("email");
    setPassword("");
    setErr(null);
  }

  function switchIntent(next: Intent) {
    setIntent(next);
    setErr(null);
    setDomainError(null);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[440px]">
        {/* Brand */}
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-brand-300 to-brand-500 flex items-center justify-center text-black font-display font-bold text-sm">K</div>
          <div className="leading-tight">
            <div className="font-display text-[15px] font-semibold tracking-tight text-gray-900">KubeGraf</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Internal Time Sheet</div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-8 shadow-sm">
          {step === "email" && (
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

              <h1 className="text-[22px] font-semibold text-gray-900 mb-1.5 tracking-tight">
                {intent === "signin" ? "Welcome back" : "Create your account"}
              </h1>
              <p className="text-[13px] text-gray-500 mb-6">
                Use your work email — only <span className="text-gray-800">{ALLOWED_DOMAIN_HINT}</span> addresses are allowed.
              </p>

              <form onSubmit={submitEmail} className="space-y-4">
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
                  disabled={busy || !email || !clientDomainOk}
                  className="ko-btn-primary w-full h-11 text-[14px] font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {busy
                    ? "Continuing…"
                    : intent === "signin"
                      ? <>Sign in <ArrowRight size={15} /></>
                      : <>Create account <ArrowRight size={15} /></>}
                </button>
              </form>

              <p className="text-[11px] text-gray-500 mt-6 leading-relaxed">
                {intent === "signin"
                  ? "Don't have an account yet? "
                  : "Already have an account? "}
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

          {step === "password" && (
            <>
              <button type="button" onClick={goBack} className="text-[12px] text-gray-500 hover:text-gray-900 inline-flex items-center gap-1 mb-3">
                <ArrowLeft size={12} /> {trimmedEmail}
              </button>
              <h1 className="text-[22px] font-semibold text-gray-900 mb-1.5 tracking-tight">
                {name ? `Welcome back, ${name.split(" ")[0]}` : "Welcome back"}
              </h1>
              <p className="text-[13px] text-gray-500 mb-7">Enter your password to sign in.</p>
              <form onSubmit={submitPassword} className="space-y-4">
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
                      autoFocus
                    />
                    <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-md flex items-center justify-center text-gray-400 hover:text-gray-700" aria-label={show ? "Hide" : "Show"}>
                      {show ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </label>
                {err && (
                  <div className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2.5">{err}</div>
                )}
                <button
                  type="submit"
                  disabled={busy || !password}
                  className="ko-btn-primary w-full h-11 text-[14px] font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {busy ? "Signing in…" : <>Sign in <ArrowRight size={15} /></>}
                </button>
              </form>
              <div className="mt-5">
                <button
                  type="button"
                  onClick={sendReset}
                  disabled={busy}
                  className="text-[12px] text-brand-700 hover:text-brand-800 hover:underline disabled:opacity-50"
                >
                  Forgot password?
                </button>
              </div>
            </>
          )}

          {step === "email-sent" && (
            <div className="text-center py-2">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-brand-50 border border-brand-200 flex items-center justify-center">
                <Mail size={20} className="text-brand-600" />
              </div>
              <h1 className="text-[20px] font-semibold text-gray-900 mb-1.5">Check your inbox</h1>
              <p className="text-[13px] text-gray-600 mb-6 leading-relaxed">
                We sent a {intent === "signup" ? "setup" : "sign-in"} link to <span className="text-gray-900 break-all">{trimmedEmail}</span>.
                <br />Click it to finish {intent === "signup" ? "creating your account" : "signing in"}. The link expires in 24 hours.
              </p>
              <div className="bg-gray-50 border border-gray-200 rounded-md p-3 mb-5 text-left text-[12px] text-gray-600 leading-relaxed">
                <div className="flex items-start gap-2">
                  <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0 mt-0.5" />
                  <span>Don't see it? Check spam or promotions. The sender is <span className="text-gray-900">kubegraf@gmail.com</span>.</span>
                </div>
              </div>
              <button onClick={goBack} className="ko-btn-ghost inline-flex items-center justify-center h-10 px-4 text-[13px] gap-1.5">
                <ArrowLeft size={14} /> Use a different email
              </button>
            </div>
          )}
        </div>

        <p className="text-[11px] text-gray-400 text-center mt-5">
          Authorized for KubeGraf team members · Audit-logged
        </p>
      </div>
    </div>
  );
}
