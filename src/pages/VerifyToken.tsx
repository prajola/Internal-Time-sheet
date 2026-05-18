import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";

export default function VerifyToken() {
  const [, navigate] = useLocation();
  const { setUser } = useAuth();
  const [msg, setMsg] = useState("Signing you in…");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) {
      setErr("Missing token in URL.");
      return;
    }
    (async () => {
      try {
        const r = await api.post<{ user: any }>("/api/auth/verify", { token });
        setUser(r.user);
        setMsg("Signed in. Redirecting…");
        // strip token from history
        window.history.replaceState({}, "", "/");
        setTimeout(() => navigate("/"), 400);
      } catch (e: any) {
        setErr(e?.message || "Sign-in link is invalid or expired.");
      }
    })();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="ko-card-glow p-8 w-full max-w-md text-center">
        {err ? (
          <>
            <h1 className="font-display text-2xl mb-2">Sign-in failed</h1>
            <p className="text-sm text-white/70 mb-6">{err}</p>
            <a href="/login" className="ko-btn-primary inline-flex items-center h-10 px-5 text-sm">Try again</a>
          </>
        ) : (
          <p className="text-sm text-white/80">{msg}</p>
        )}
      </div>
    </div>
  );
}
