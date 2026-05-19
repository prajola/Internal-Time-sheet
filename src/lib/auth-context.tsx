import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { api, ApiUser } from "./api";

interface AuthState {
  user: ApiUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: ApiUser | null) => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, _setUser] = useState<ApiUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Refs let us reason about ordering without re-creating the refresh
  // function on every render. `userSetExplicitly` flips true when a
  // caller (Login form, etc.) sets the user directly. An in-flight
  // refresh that returns 401 must NOT clobber that — that bug was
  // sending people back to /login right after a successful sign-in.
  const userSetExplicitlyRef = useRef(false);
  const refreshIdRef = useRef(0);

  function setUser(u: ApiUser | null) {
    userSetExplicitlyRef.current = true;
    _setUser(u);
  }

  async function refresh() {
    const myId = ++refreshIdRef.current;
    try {
      const r = await api.get<{ user: ApiUser }>("/api/auth/me");
      // If someone explicitly set the user during the in-flight call
      // (e.g. a successful login), don't overwrite that — the data we
      // got back from /me should match anyway, but the comparison would
      // race with React's commit phase.
      if (myId !== refreshIdRef.current || userSetExplicitlyRef.current) return;
      _setUser(r.user);
    } catch {
      // Crucially: do NOT _setUser(null) here. If we're still null we
      // stay null; if a login just set us, we keep that. Cookie expiry
      // and explicit logout flows handle null state on their own.
    } finally {
      // Only the latest refresh flips loading off.
      if (myId === refreshIdRef.current) setLoading(false);
    }
  }

  async function logout() {
    try { await api.del("/api/auth/me"); } catch { /* noop */ }
    userSetExplicitlyRef.current = true;
    _setUser(null);
    // Hard-navigate to /login so the entire app state (including any
    // cached protected-page data) gets reset.
    window.location.href = "/login";
  }

  useEffect(() => { refresh(); }, []);

  return (
    <Ctx.Provider value={{ user, loading, refresh, logout, setUser }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}
