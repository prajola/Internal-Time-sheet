import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  Bell, CheckCheck, ArrowRight,
  ClipboardList, ListChecks, ShieldCheck, KeyRound, LogOut as LogOutIcon,
  UserCog, UserX, UserCheck, Clock,
} from "lucide-react";
import { api } from "../lib/api";
import { EmptyState } from "./EmptyState";
import type { Notification, NotificationKind } from "../types";

interface Props {
  /** Maximum items shown inline. Defaults to 6. */
  limit?: number;
}

interface ApiResponse {
  items: Notification[];
  unread: number;
  total: number;
}

/**
 * Notifications panel rendered inline (e.g. on the Dashboard). Same data
 * source as the header bell — but always-visible so the user can't miss
 * anything important. Polls every 30s and refreshes on tab focus.
 */
export function NotificationFeed({ limit = 6 }: Props) {
  const [, navigate] = useLocation();
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const r = await api.get<ApiResponse>("/api/notifications");
      setItems(r.items);
      setUnread(r.unread);
    } catch {
      /* silent — empty state will appear */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    function onFocus() { load(); }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  async function markRead(n: Notification) {
    if (n.readAt) return;
    setItems((ls) => ls.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
    setUnread((c) => Math.max(0, c - 1));
    try { await api.post("/api/notifications", { action: "mark-read", id: n.id }); }
    catch { /* will reconcile on next poll */ }
  }

  async function markAllRead() {
    if (unread === 0) return;
    setItems((ls) => ls.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })));
    setUnread(0);
    try { await api.post("/api/notifications", { action: "mark-all-read" }); }
    catch { /* same */ }
  }

  function openItem(n: Notification) {
    markRead(n);
    if (n.link) navigate(n.link);
  }

  const shown = items.slice(0, limit);

  return (
    <section>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="ko-h2">Notifications</h2>
          {unread > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-brand-500 text-black text-[11px] font-semibold">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </div>
        {unread > 0 && (
          <button
            onClick={markAllRead}
            className="text-[12px] text-brand-700 hover:text-brand-800 hover:underline inline-flex items-center gap-1"
            title="Mark all as read"
          >
            <CheckCheck size={12} /> Mark all read
          </button>
        )}
      </div>

      {loading && items.length === 0 ? (
        <div className="ko-card p-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="ko-skel w-8 h-8 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <div className="ko-skel h-3 w-3/5" />
                <div className="ko-skel h-2.5 w-2/5" />
              </div>
            </div>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="ko-card">
          <EmptyState
            icon={<Bell size={20} />}
            title="No notifications yet"
            description="When something happens that involves you, it'll show up here."
            size="sm"
          />
        </div>
      ) : (
        <div className="ko-card overflow-hidden">
          <ul className="divide-y divide-gray-100">
            {shown.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => openItem(n)}
                  className={
                    "w-full text-left px-4 py-3 flex items-start gap-3 transition group " +
                    (n.readAt ? "hover:bg-gray-50" : "bg-brand-50/30 hover:bg-brand-50/60")
                  }
                >
                  <div className="flex-shrink-0 mt-0.5 relative">
                    <div className={"w-9 h-9 rounded-full inline-flex items-center justify-center " + kindBg(n.kind)}>
                      {kindIcon(n.kind)}
                    </div>
                    {!n.readAt && (
                      <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-brand-500 border-2 border-white" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={"text-sm " + (n.readAt ? "text-gray-700" : "text-gray-900 font-medium")}>
                      {n.title}
                    </div>
                    {n.body && (
                      <div className="text-[12px] text-gray-500 mt-0.5 line-clamp-2">{n.body}</div>
                    )}
                    <div className="text-[10px] uppercase tracking-[0.14em] text-gray-400 mt-1">
                      {timeAgo(n.createdAt)}{n.fromUserName ? ` · ${n.fromUserName}` : ""}
                    </div>
                  </div>
                  {n.link && (
                    <ArrowRight size={13} className="flex-shrink-0 text-gray-300 group-hover:text-brand-700 transition mt-1" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ── Icon + tint per kind ──────────────────────────────────── */

function kindBg(kind: NotificationKind): string {
  switch (kind) {
    case "clock-in":              return "bg-emerald-50 text-emerald-700 border border-emerald-200";
    case "clock-out":             return "bg-blue-50 text-blue-700 border border-blue-200";
    case "task-assigned":         return "bg-brand-50 text-brand-700 border border-brand-200";
    case "task-updated":          return "bg-brand-50 text-brand-700 border border-brand-200";
    case "task-status-changed":   return "bg-amber-50 text-amber-700 border border-amber-200";
    case "task-deleted":          return "bg-red-50 text-red-700 border border-red-200";
    case "account-role-changed":  return "bg-purple-50 text-purple-700 border border-purple-200";
    case "account-disabled":      return "bg-red-50 text-red-700 border border-red-200";
    case "account-enabled":       return "bg-emerald-50 text-emerald-700 border border-emerald-200";
    case "account-password-reset":return "bg-brand-50 text-brand-700 border border-brand-200";
    case "account-force-signout": return "bg-gray-100 text-gray-700 border border-gray-200";
    default:                      return "bg-gray-100 text-gray-700 border border-gray-200";
  }
}

function kindIcon(kind: NotificationKind) {
  const size = 14;
  switch (kind) {
    case "clock-in":
    case "clock-out":             return <Clock size={size} />;
    case "task-assigned":         return <ClipboardList size={size} />;
    case "task-updated":          return <ListChecks size={size} />;
    case "task-status-changed":   return <ListChecks size={size} />;
    case "task-deleted":          return <ListChecks size={size} />;
    case "account-role-changed":  return <UserCog size={size} />;
    case "account-disabled":      return <UserX size={size} />;
    case "account-enabled":       return <UserCheck size={size} />;
    case "account-password-reset":return <KeyRound size={size} />;
    case "account-force-signout": return <LogOutIcon size={size} />;
    default:                      return <ShieldCheck size={size} />;
  }
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "just now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
