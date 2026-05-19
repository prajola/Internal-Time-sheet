import { useEffect, useMemo, useState } from "react";
import {
  LifeBuoy, Search as SearchIcon, XCircle, MessageSquare, Mail, Clock, CheckCircle2, ArrowRight, Filter, Send,
} from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { fmtDate } from "../lib/format";
import type { SupportQuery, QueryCategory, QueryStatus } from "../types";

const CATEGORIES: Array<{ value: QueryCategory; label: string }> = [
  { value: "PORTAL",    label: "Portal" },
  { value: "TECHNICAL", label: "Technical" },
  { value: "TASK",      label: "Task" },
  { value: "OTHER",     label: "Other" },
];

const STATUSES: QueryStatus[] = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];

export default function AdminQueries() {
  const { ok, err } = useToast();
  const [items, setItems] = useState<SupportQuery[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | QueryStatus>("all");
  const [filterCategory, setFilterCategory] = useState<"all" | QueryCategory>("all");
  const [filterUser, setFilterUser] = useState<string>("all");

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<{ queries: SupportQuery[] }>("/api/queries");
      setItems(r.queries);
    } catch (e: any) { err(e?.message || "Failed to load"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const users = useMemo(() => {
    const set = new Map<string, string>();
    for (const q of items) set.set(q.userId, q.userName || q.userEmail);
    return [...set.entries()].map(([id, name]) => ({ id, name }));
  }, [items]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((q) => {
      if (filterStatus !== "all" && q.status !== filterStatus) return false;
      if (filterCategory !== "all" && q.category !== filterCategory) return false;
      if (filterUser !== "all" && q.userId !== filterUser) return false;
      if (term && !(
        q.subject.toLowerCase().includes(term) ||
        q.body.toLowerCase().includes(term) ||
        q.userName.toLowerCase().includes(term) ||
        q.userEmail.toLowerCase().includes(term)
      )) return false;
      return true;
    });
  }, [items, search, filterStatus, filterCategory, filterUser]);

  const activeFilterCount =
    (search ? 1 : 0) +
    (filterStatus !== "all" ? 1 : 0) +
    (filterCategory !== "all" ? 1 : 0) +
    (filterUser !== "all" ? 1 : 0);

  function clearFilters() {
    setSearch("");
    setFilterStatus("all");
    setFilterCategory("all");
    setFilterUser("all");
  }

  const counts = useMemo(() => ({
    open: items.filter((q) => q.status === "OPEN").length,
    inProgress: items.filter((q) => q.status === "IN_PROGRESS").length,
    resolved: items.filter((q) => q.status === "RESOLVED" || q.status === "CLOSED").length,
  }), [items]);

  function patch(q: SupportQuery) {
    setItems((ls) => ls.map((x) => (x.id === q.id ? q : x)));
  }

  return (
    <div>
      <PageHeader
        icon={<LifeBuoy size={18} />}
        eyebrow="Administration"
        title="Support queries"
        description="Questions, technical issues, and task help raised by your team. Respond inline."
      />

      {/* Top-line counts */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <StatCard tone="amber"   icon={<Clock size={14} />}        label="Open"        value={counts.open} />
        <StatCard tone="blue"    icon={<Clock size={14} />}        label="In progress" value={counts.inProgress} />
        <StatCard tone="emerald" icon={<CheckCircle2 size={14} />} label="Resolved"    value={counts.resolved} />
      </div>

      {/* Filter card */}
      {items.length > 0 && (
        <div className="ko-card p-4 mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">Search</div>
              <div className="relative">
                <SearchIcon size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Subject, body, user…"
                  className="ko-input h-9 pl-8 pr-8 text-sm"
                />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
                    <XCircle size={13} />
                  </button>
                )}
              </div>
            </div>

            <div className="w-full sm:w-auto">
              <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">Status</div>
              <select className="ko-input h-9 w-full sm:w-40" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as any)}>
                <option value="all">All statuses</option>
                {STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase().replace("_", " ")}</option>)}
              </select>
            </div>

            <div className="w-full sm:w-auto">
              <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">Category</div>
              <select className="ko-input h-9 w-full sm:w-40" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value as any)}>
                <option value="all">All categories</option>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>

            {users.length > 0 && (
              <div className="w-full sm:w-auto">
                <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">User</div>
                <select className="ko-input h-9 w-full sm:w-48" value={filterUser} onChange={(e) => setFilterUser(e.target.value)}>
                  <option value="all">All users</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            )}

            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="ko-btn-ghost h-9 px-3 text-xs inline-flex items-center gap-1.5 w-full sm:w-auto sm:ml-auto justify-center">
                <XCircle size={12} /> Clear all ({activeFilterCount})
              </button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => <div key={i} className="ko-skel h-28 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="ko-card">
          <EmptyState
            icon={items.length === 0 ? <LifeBuoy size={20} /> : <Filter size={20} />}
            title={items.length === 0 ? "No queries raised yet" : "No queries match these filters"}
            description={items.length === 0 ? "When your team raises a query through the support page, it'll show up here." : "Try clearing one or more filters."}
            action={items.length > 0 && activeFilterCount > 0 && (
              <button onClick={clearFilters} className="ko-btn-ghost h-10 px-4 text-sm inline-flex items-center gap-1.5">
                <XCircle size={14} /> Clear filters
              </button>
            )}
          />
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((q) => <AdminQueryCard key={q.id} q={q} onChanged={patch} onDeleted={(id) => setItems((ls) => ls.filter((x) => x.id !== id))} />)}
        </div>
      )}
    </div>
  );
}

function AdminQueryCard({ q, onChanged, onDeleted }: { q: SupportQuery; onChanged: (q: SupportQuery) => void; onDeleted: (id: string) => void }) {
  const { ok, err } = useToast();
  const [reply, setReply] = useState(q.adminResponse);
  const [replyOpen, setReplyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusDraft, setStatusDraft] = useState<QueryStatus>(q.status);

  async function setStatus(status: QueryStatus) {
    if (status === q.status) return;
    setBusy(true);
    try {
      const r = await api.post<{ query: SupportQuery }>("/api/queries", {
        action: "update-status", id: q.id, status,
      });
      onChanged(r.query);
      setStatusDraft(status);
      ok("Status updated.");
    } catch (e: any) { err(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  async function sendResponse() {
    if (!reply.trim()) { err("Response can't be empty."); return; }
    setBusy(true);
    try {
      const r = await api.post<{ query: SupportQuery }>("/api/queries", {
        action: "respond", id: q.id, response: reply.trim(),
        // bump to IN_PROGRESS unless already further along
        status: q.status === "OPEN" ? "IN_PROGRESS" : undefined,
      });
      onChanged(r.query);
      setStatusDraft(r.query.status);
      setReplyOpen(false);
      ok("Response sent.");
    } catch (e: any) { err(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm("Delete this query?")) return;
    setBusy(true);
    try {
      await api.post("/api/queries", { action: "delete", id: q.id });
      onDeleted(q.id);
      ok("Deleted.");
    } catch (e: any) { err(e?.message || "Failed to delete"); }
    finally { setBusy(false); }
  }

  return (
    <div className="ko-card p-4">
      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <CategoryBadge category={q.category} />
            <StatusPill status={q.status} />
            <span className="text-[11px] text-gray-500">{fmtDate(q.createdAt)}</span>
          </div>
          <h3 className="text-[15px] font-medium text-gray-900 mb-0.5">{q.subject}</h3>
          <div className="text-[12px] text-gray-600 inline-flex items-center gap-1.5">
            <Mail size={11} className="text-gray-400" />
            <span className="text-gray-900">{q.userName || "—"}</span>
            <span className="text-gray-500">&lt;{q.userEmail}&gt;</span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            disabled={busy}
            value={statusDraft}
            onChange={(e) => setStatus(e.target.value as QueryStatus)}
            className="ko-input h-8 text-[12px] w-36"
          >
            {STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase().replace("_", " ")}</option>)}
          </select>
          <button onClick={remove} disabled={busy} className="ko-btn-ghost h-8 px-2 text-[12px] text-gray-500 hover:text-red-700 inline-flex items-center gap-1">
            <XCircle size={13} /> Delete
          </button>
        </div>
      </div>

      <p className="text-[13px] text-gray-700 whitespace-pre-wrap mb-3">{q.body}</p>

      {q.adminResponse && !replyOpen && (
        <div className="mt-2 rounded-md bg-emerald-50 border border-emerald-200 p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-800 uppercase tracking-[0.14em] font-semibold mb-1.5">
            <MessageSquare size={11} /> Response · {q.respondedByName} · {q.respondedAt && fmtDate(q.respondedAt)}
          </div>
          <p className="text-[13px] text-gray-800 whitespace-pre-wrap">{q.adminResponse}</p>
          <button onClick={() => { setReply(q.adminResponse); setReplyOpen(true); }} className="ko-btn-ghost h-7 px-2 text-[11px] mt-2">
            Edit response
          </button>
        </div>
      )}

      {!q.adminResponse && !replyOpen && (
        <button onClick={() => setReplyOpen(true)} className="ko-btn-primary h-9 px-4 text-[13px] inline-flex items-center gap-1.5">
          <MessageSquare size={13} /> Reply
        </button>
      )}

      {replyOpen && (
        <div className="mt-3 rounded-md border border-brand-200 bg-brand-50/40 p-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-brand-800 mb-1.5">Your response</div>
          <textarea
            className="ko-input min-h-[100px] text-[13px]"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Hi — here's what's going on…"
            autoFocus
          />
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => { setReplyOpen(false); setReply(q.adminResponse); }} className="ko-btn-ghost h-9 px-3 text-[12px]">
              Cancel
            </button>
            <button onClick={sendResponse} disabled={busy} className="ko-btn-primary h-9 px-4 text-[12px] inline-flex items-center gap-1.5">
              {busy ? "Sending…" : <><Send size={12} /> Send response</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryBadge({ category }: { category: QueryCategory }) {
  const c = CATEGORIES.find((x) => x.value === category)!;
  return (
    <span className="text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200">
      {c.label}
    </span>
  );
}

function StatusPill({ status }: { status: QueryStatus }) {
  const styles: Record<QueryStatus, string> = {
    OPEN:         "bg-amber-50 text-amber-800 border-amber-200",
    IN_PROGRESS:  "bg-blue-50 text-blue-800 border-blue-200",
    RESOLVED:     "bg-emerald-50 text-emerald-800 border-emerald-200",
    CLOSED:       "bg-gray-100 text-gray-600 border-gray-200",
  };
  return (
    <span className={"inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-full border " + styles[status]}>
      {status.toLowerCase().replace("_", " ")}
    </span>
  );
}

function StatCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: "amber" | "blue" | "emerald" }) {
  const tones = {
    amber:   "bg-amber-50 text-amber-800 border-amber-200",
    blue:    "bg-blue-50 text-blue-800 border-blue-200",
    emerald: "bg-emerald-50 text-emerald-800 border-emerald-200",
  };
  return (
    <div className={"ko-card p-3 border " + tones[tone]}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] font-semibold mb-1">
        {icon} {label}
      </div>
      <div className="font-display text-2xl leading-none">{value}</div>
    </div>
  );
}
