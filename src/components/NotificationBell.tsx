import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Bell, Check, CheckCheck, Trash2, X } from "lucide-react";
import { api } from "../lib/api";
import type { Notification } from "../types";

const POLL_INTERVAL_MS = 30_000;
const POLL_VISIBLE_MS  = 8_000; // tighter cadence while the panel is open

interface NotifResponse {
  items: Notification[];
  unread: number;
  total: number;
}

export function NotificationBell() {
  const [, navigate] = useLocation();
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<NotifResponse>("/api/notifications");
      setItems(r.items);
      setUnread(r.unread);
    } catch { /* swallow — bell shouldn't shout when offline */ }
    finally { setLoading(false); }
  }

  // Initial load + interval (faster while open).
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const interval = open ? POLL_VISIBLE_MS : POLL_INTERVAL_MS;
    const id = setInterval(load, interval);
    return () => clearInterval(id);
  }, [open]);

  // Refresh when the tab regains focus — common pattern.
  useEffect(() => {
    function onFocus() { load(); }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markRead(n: Notification) {
    if (n.readAt) return;
    setItems((ls) => ls.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
    setUnread((c) => Math.max(0, c - 1));
    try { await api.post("/api/notifications", { action: "mark-read", id: n.id }); }
    catch { /* server-side sync will reconcile on next poll */ }
  }

  async function markAllRead() {
    if (unread === 0) return;
    setItems((ls) => ls.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })));
    setUnread(0);
    try { await api.post("/api/notifications", { action: "mark-all-read" }); }
    catch { /* same — reconciled on next poll */ }
  }

  async function remove(n: Notification, ev: React.MouseEvent) {
    ev.stopPropagation();
    setItems((ls) => ls.filter((x) => x.id !== n.id));
    if (!n.readAt) setUnread((c) => Math.max(0, c - 1));
    try { await api.post("/api/notifications", { action: "delete", id: n.id }); }
    catch { /* tolerated */ }
  }

  function openItem(n: Notification) {
    markRead(n);
    if (n.link) {
      setOpen(false);
      navigate(n.link);
    }
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        className="relative h-9 w-9 rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 flex items-center justify-center transition"
        aria-label="Notifications"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-brand-500 text-black text-[10px] font-semibold rounded-full inline-flex items-center justify-center border-2 border-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 mt-2 w-[380px] max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-xl shadow-[0_8px_24px_rgba(16,24,40,0.12)] overflow-hidden z-50"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <div>
              <div className="font-semibold text-sm text-gray-900">Notifications</div>
              <div className="text-[11px] text-gray-500">
                {unread > 0 ? `${unread} unread` : "All caught up"}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[11px] text-brand-700 hover:text-brand-800 hover:underline inline-flex items-center gap-1"
                  title="Mark all as read"
                >
                  <CheckCheck size={12} /> Mark all read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 rounded-md hover:bg-gray-100 inline-flex items-center justify-center text-gray-500"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {loading && items.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12px] text-gray-500">Loading…</div>
            ) : items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Bell size={20} className="mx-auto mb-2 text-gray-300" />
                <div className="text-[13px] text-gray-500">No notifications yet</div>
                <div className="text-[11px] text-gray-400 mt-1">We'll let you know when something happens.</div>
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openItem(n)}
                  className={
                    "w-full text-left px-4 py-3 border-b border-gray-100 last:border-b-0 transition flex items-start gap-3 group " +
                    (n.readAt ? "hover:bg-gray-50" : "bg-brand-50/40 hover:bg-brand-50")
                  }
                >
                  <div className="flex-shrink-0 mt-1">
                    {n.readAt ? (
                      <div className="w-2 h-2 rounded-full bg-transparent" />
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-brand-500" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={"text-[13px] " + (n.readAt ? "text-gray-700" : "text-gray-900 font-medium")}>
                      {n.title}
                    </div>
                    {n.body && (
                      <div className="text-[12px] text-gray-500 mt-0.5 line-clamp-2">{n.body}</div>
                    )}
                    <div className="text-[10px] text-gray-400 mt-1 uppercase tracking-wider">
                      {timeAgo(n.createdAt)}
                      {n.fromUserName ? ` · ${n.fromUserName}` : ""}
                    </div>
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 transition flex items-center gap-1 flex-shrink-0">
                    {!n.readAt && (
                      <span
                        role="button"
                        onClick={(e) => { e.stopPropagation(); markRead(n); }}
                        className="w-7 h-7 rounded-md hover:bg-white inline-flex items-center justify-center text-gray-400 hover:text-gray-700"
                        title="Mark as read"
                      >
                        <Check size={12} />
                      </span>
                    )}
                    <span
                      role="button"
                      onClick={(e) => remove(n, e)}
                      className="w-7 h-7 rounded-md hover:bg-white inline-flex items-center justify-center text-gray-400 hover:text-red-700"
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
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
