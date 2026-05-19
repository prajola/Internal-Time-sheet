import { useEffect, useMemo, useState } from "react";
import { LifeBuoy, Plus, X, ArrowRight, CheckCircle2, Clock, AlertCircle, MessageSquare } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { fmtDate } from "../lib/format";
import type { SupportQuery, QueryCategory, QueryStatus, Task } from "../types";

const CATEGORIES: Array<{ value: QueryCategory; label: string; hint: string }> = [
  { value: "PORTAL",    label: "Portal issue",    hint: "Login, navigation, missing feature, anything about how the app behaves" },
  { value: "TECHNICAL", label: "Technical issue", hint: "Error message, slow page, broken button" },
  { value: "TASK",      label: "About a task",    hint: "Question about a specific assigned task — pick the task below" },
  { value: "OTHER",     label: "Other",           hint: "Something else entirely" },
];

const FILTERS: Array<{ value: "all" | "open" | "responded"; label: string }> = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "responded", label: "Responded" },
];

export default function MyQueries() {
  const { ok, err } = useToast();
  const [items, setItems] = useState<SupportQuery[]>([]);
  const [myTasks, setMyTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "open" | "responded">("all");
  const [composing, setComposing] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [q, t] = await Promise.all([
        api.get<{ queries: SupportQuery[] }>("/api/queries"),
        api.get<{ tasks: Task[] }>("/api/tasks"),
      ]);
      setItems(q.queries);
      setMyTasks(t.tasks);
    } catch (e: any) { err(e?.message || "Failed to load"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => ({
    all: items.length,
    open: items.filter((q) => q.status === "OPEN" || q.status === "IN_PROGRESS").length,
    responded: items.filter((q) => q.adminResponse).length,
  }), [items]);

  const visible = useMemo(() => {
    if (filter === "open") return items.filter((q) => q.status === "OPEN" || q.status === "IN_PROGRESS");
    if (filter === "responded") return items.filter((q) => !!q.adminResponse);
    return items;
  }, [items, filter]);

  return (
    <div>
      <PageHeader
        icon={<LifeBuoy size={18} />}
        eyebrow="My space"
        title="Help & support"
        description="Raise questions, report issues, or ask for help with a task. An admin will see and respond."
        actions={
          <button
            onClick={() => setComposing(true)}
            className="ko-btn-primary h-10 px-4 text-sm inline-flex items-center gap-1.5"
          >
            <Plus size={15} /> Raise a query
          </button>
        }
      />

      <div className="inline-flex bg-gray-100 rounded-lg p-1 mb-5">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={
              "h-8 px-3 rounded-md text-[12px] font-medium transition inline-flex items-center gap-1.5 " +
              (filter === f.value ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800")
            }
          >
            {f.label}
            <span className={"text-[10px] px-1.5 py-0.5 rounded " + (filter === f.value ? "bg-brand-50 text-brand-800" : "bg-gray-200 text-gray-600")}>
              {counts[f.value]}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid gap-3">
          {[1, 2].map((i) => <div key={i} className="ko-skel h-24 w-full" />)}
        </div>
      ) : visible.length === 0 ? (
        <div className="ko-card">
          <EmptyState
            icon={<LifeBuoy size={20} />}
            title={items.length === 0 ? "No queries yet" : "Nothing in this view"}
            description={items.length === 0 ? "If you hit a problem or have a question, raise it here and an admin will follow up." : "Switch to a different filter to see other queries."}
            action={items.length === 0 && (
              <button onClick={() => setComposing(true)} className="ko-btn-primary h-10 px-4 text-sm inline-flex items-center gap-1.5">
                <Plus size={15} /> Raise your first query
              </button>
            )}
          />
        </div>
      ) : (
        <div className="grid gap-3">
          {visible.map((q) => <QueryCard key={q.id} q={q} onDelete={load} />)}
        </div>
      )}

      {composing && (
        <ComposeDialog
          onClose={() => setComposing(false)}
          onCreated={(q) => { setItems((ls) => [q, ...ls]); setComposing(false); ok("Query raised. We'll get back to you."); }}
          myTasks={myTasks}
        />
      )}
    </div>
  );
}

function QueryCard({ q, onDelete }: { q: SupportQuery; onDelete: () => void }) {
  const { ok, err } = useToast();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!confirm("Delete this query? This can't be undone.")) return;
    setBusy(true);
    try {
      await api.post("/api/queries", { action: "delete", id: q.id });
      ok("Query deleted.");
      onDelete();
    } catch (e: any) { err(e?.message || "Failed to delete"); }
    finally { setBusy(false); }
  }

  return (
    <div className="ko-card p-4">
      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <CategoryBadge category={q.category} />
            <StatusPill status={q.status} />
            <span className="text-[11px] text-gray-500">{fmtDate(q.createdAt)}</span>
          </div>
          <h3 className="text-[15px] font-medium text-gray-900 truncate">{q.subject}</h3>
        </div>
        <button onClick={remove} disabled={busy} className="ko-btn-ghost h-8 px-2 text-[12px] inline-flex items-center gap-1 text-gray-500 hover:text-red-700">
          <X size={13} /> Delete
        </button>
      </div>

      <p className="text-[13px] text-gray-700 whitespace-pre-wrap mb-3">{q.body}</p>

      {q.adminResponse ? (
        <div className="mt-3 rounded-md bg-emerald-50 border border-emerald-200 p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-800 uppercase tracking-[0.14em] font-semibold mb-1.5">
            <MessageSquare size={11} /> Admin response · {q.respondedByName} · {q.respondedAt && fmtDate(q.respondedAt)}
          </div>
          <p className="text-[13px] text-gray-800 whitespace-pre-wrap">{q.adminResponse}</p>
        </div>
      ) : (
        <div className="mt-2 text-[12px] text-gray-500 inline-flex items-center gap-1.5">
          <Clock size={12} /> Awaiting admin response
        </div>
      )}
    </div>
  );
}

function ComposeDialog({ onClose, onCreated, myTasks }: { onClose: () => void; onCreated: (q: SupportQuery) => void; myTasks: Task[] }) {
  const { err } = useToast();
  const [category, setCategory] = useState<QueryCategory>("PORTAL");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [taskId, setTaskId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const cat = CATEGORIES.find((c) => c.value === category)!;
  const isTaskCat = category === "TASK";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !body.trim()) { err("Subject and description are required."); return; }
    setBusy(true);
    try {
      const r = await api.post<{ query: SupportQuery }>("/api/queries", {
        action: "create",
        category,
        subject: subject.trim(),
        body: body.trim(),
        taskId: isTaskCat && taskId ? taskId : null,
      });
      onCreated(r.query);
    } catch (e: any) { err(e?.message || "Failed to raise query"); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-40 bg-gray-900/50 backdrop-blur-md ko-fade-in flex items-center justify-center px-4">
      <div className="ko-card-glow p-6 w-full max-w-lg ko-modal-body">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-display text-xl">Raise a query</h2>
          <button onClick={onClose} className="ko-btn-ghost h-8 w-8 inline-flex items-center justify-center"><X size={14} /></button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">Category</div>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategory(c.value)}
                  className={
                    "h-11 rounded-md border text-[13px] font-medium transition px-3 text-left " +
                    (category === c.value
                      ? "bg-brand-50 border-brand-300 text-brand-800"
                      : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50")
                  }
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="mt-2 text-[12px] text-gray-500 inline-flex items-start gap-1.5">
              <AlertCircle size={12} className="mt-0.5 flex-shrink-0" /> {cat.hint}
            </div>
          </div>

          {isTaskCat && myTasks.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">Related task (optional)</div>
              <select className="ko-input h-10" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                <option value="">— No specific task —</option>
                {myTasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </div>
          )}

          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">Subject</div>
            <input
              type="text"
              className="ko-input h-10"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Short summary — e.g. 'Can't see my January timesheet'"
              maxLength={200}
              required
              autoFocus
            />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">Description</div>
            <textarea
              className="ko-input min-h-[120px]"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Tell us what happened, what you expected, and any steps to reproduce. The more detail, the faster we can help."
              required
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="ko-btn-ghost h-10 px-4 text-sm">Cancel</button>
            <button type="submit" disabled={busy} className="ko-btn-primary h-10 px-5 text-sm inline-flex items-center gap-1.5">
              {busy ? "Sending…" : <>Send <ArrowRight size={14} /></>}
            </button>
          </div>
        </form>
      </div>
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
  const icons: Record<QueryStatus, React.ReactNode> = {
    OPEN:         <Clock size={10} />,
    IN_PROGRESS:  <Clock size={10} />,
    RESOLVED:     <CheckCircle2 size={10} />,
    CLOSED:       <CheckCircle2 size={10} />,
  };
  return (
    <span className={"inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-full border " + styles[status]}>
      {icons[status]} {status.toLowerCase().replace("_", " ")}
    </span>
  );
}
