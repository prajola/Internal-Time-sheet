import { useMemo, useState } from "react";
import { Eye, EyeOff, Wand2, X, Copy, Check, ShieldAlert } from "lucide-react";
import { api } from "../lib/api";
import type { User } from "../types";

interface Props {
  user: User;
  onClose: () => void;
  onSaved: () => void;
  onSuccessToast?: (msg: string) => void;
  onErrorToast?: (msg: string) => void;
}

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

function generatePassword(length = 14): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";   // excludes I, O
  const lower = "abcdefghijkmnpqrstuvwxyz";   // excludes l, o
  const digits = "23456789";                   // excludes 0, 1
  const symbols = "!@#$%^&*_-+=?";
  const all = upper + lower + digits + symbols;
  // Ensure at least one of each class
  const chars = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
  ];
  while (chars.length < length) {
    chars.push(all[Math.floor(Math.random() * all.length)]);
  }
  // Shuffle (Fisher–Yates)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export function SetPasswordDialog({ user, onClose, onSaved, onSuccessToast, onErrorToast }: Props) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const strength = useMemo(() => scoreStrength(pw), [pw]);
  const reqOk = useMemo(() => {
    const length = pw.length >= 8;
    const letter = /[A-Za-z]/.test(pw);
    const digit  = /\d/.test(pw);
    const match  = pw.length > 0 && pw === confirm;
    return { length, letter, digit, match, all: length && letter && digit && match };
  }, [pw, confirm]);

  function regenerate() {
    const gen = generatePassword(14);
    setPw(gen);
    setConfirm(gen);
    setShow(true);
    setErr(null);
  }

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(pw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!reqOk.all) { setErr("Fix the highlighted requirements first."); return; }
    setBusy(true);
    try {
      await api.patch(`/api/users/${user.id}`, { setPassword: pw });
      onSuccessToast?.(`Password updated for ${user.email}.`);
      onSaved();
    } catch (e: any) {
      const msg = e?.message || "Could not set password";
      setErr(msg);
      onErrorToast?.(msg);
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-40 bg-gray-900/50 backdrop-blur-md ko-fade-in flex items-center justify-center px-4">
      <form onSubmit={submit} className="ko-card-elevated p-6 w-full max-w-md">
        <div className="flex justify-between items-start mb-4 gap-3">
          <div>
            <h2 className="font-display text-xl text-gray-900">Set a new password</h2>
            <p className="text-[12px] text-gray-500 mt-0.5">For <span className="text-gray-900">{user.email}</span></p>
          </div>
          <button type="button" className="ko-btn-ghost h-8 w-8 inline-flex items-center justify-center" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>

        <div className="mb-4 text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2.5 inline-flex items-start gap-2 w-full">
          <ShieldAlert size={14} className="flex-shrink-0 mt-0.5" />
          <div>
            Choose a password and share it with this user securely. Their existing sessions will be signed out, and they'll receive a notification + email about the change.
          </div>
        </div>

        <div className="space-y-3">
          <label className="block">
            <div className="text-[11px] uppercase tracking-[0.14em] text-gray-500 mb-1.5 flex items-center justify-between">
              <span>New password</span>
              <button
                type="button"
                onClick={regenerate}
                className="normal-case tracking-normal text-[11px] text-brand-700 hover:text-brand-800 hover:underline inline-flex items-center gap-1"
              >
                <Wand2 size={11} /> Generate strong
              </button>
            </div>
            <div className="relative">
              <input
                type={show ? "text" : "password"}
                required
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                className="ko-input h-11 pr-20"
                autoFocus
              />
              <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                {pw && (
                  <button
                    type="button"
                    onClick={copyPassword}
                    className="w-8 h-8 rounded-md flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                    title={copied ? "Copied!" : "Copy"}
                  >
                    {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="w-8 h-8 rounded-md flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                  title={show ? "Hide" : "Show"}
                >
                  {show ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            {pw && (
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1 rounded-full bg-gray-200 overflow-hidden">
                  <div className={"h-full transition-all " + barColor(strength.score)} style={{ width: `${(strength.score + 1) * 20}%` }} />
                </div>
                <span className={"text-[11px] font-medium " + strength.tone}>{strength.label}</span>
              </div>
            )}
          </label>

          <label className="block">
            <div className="text-[11px] uppercase tracking-[0.14em] text-gray-500 mb-1.5">Confirm password</div>
            <input
              type={show ? "text" : "password"}
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

          {err && (
            <div className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2.5">{err}</div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button type="button" onClick={onClose} className="ko-btn-ghost h-10 px-4 text-sm">Cancel</button>
          <button type="submit" disabled={busy || !reqOk.all} className="ko-btn-primary h-10 px-5 text-sm">
            {busy ? "Setting…" : "Apply new password"}
          </button>
        </div>
      </form>
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
