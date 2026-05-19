import { useEffect, useMemo, useState } from "react";
import { Plus, X, Pencil, Trash2, ListChecks, Download, Search as SearchIcon, Filter, XCircle, CalendarRange } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { fmtDate, todayYmd } from "../lib/format";
import { downloadCsv, dateStampedName } from "../lib/csv";
import type { Task, TaskPriority, TaskStatus, User } from "../types";

const STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"];
const PRIORITIES: TaskPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

export default function AdminTasks() {
  const { ok, err } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterAssignee, setFilterAssignee] = useState<string>("all");
  // Date filter: which date column to apply, and what period to match.
  const [dateField, setDateField] = useState<"due" | "created" | "updated">("due");
  const [period, setPeriod] = useState<"all" | "today" | "week" | "month" | "year" | "overdue" | "custom">("all");
  const [customDay, setCustomDay] = useState<string>("");      // YYYY-MM-DD
  const [search, setSearch] = useState<string>("");

  async function load() {
    setLoading(true);
    try {
      const [t, u] = await Promise.all([
        api.get<{ tasks: Task[] }>("/api/tasks"),
        api.get<{ users: User[] }>("/api/users"),
      ]);
      setTasks(t.tasks);
      setUsers(u.users);
    } catch (e: any) { err(e?.message || "Failed"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      // Status filter
      if (filterStatus !== "all" && t.status !== filterStatus) return false;

      // Assignee filter
      if (filterAssignee !== "all") {
        if (filterAssignee === "none" ? Boolean(t.assigneeId) : t.assigneeId !== filterAssignee) return false;
      }

      // Search across title + description + assignee name/email
      if (q) {
        const a = users.find((u) => u.id === t.assigneeId);
        const hay = [t.title, t.description, a?.name, a?.email].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }

      // Date filter
      if (period !== "all") {
        const fieldVal =
          dateField === "due"     ? t.dueDate :
          dateField === "created" ? t.createdAt :
                                    t.updatedAt;

        if (period === "overdue") {
          // Only meaningful for the due date — task must have a due date in the past + not done.
          if (!t.dueDate) return false;
          if (t.status === "DONE") return false;
          if (new Date(t.dueDate + "T23:59:59") >= new Date()) return false;
          return true;
        }

        if (!fieldVal) return false;
        const d = new Date(fieldVal);
        if (Number.isNaN(d.getTime())) return false;

        if (period === "today") {
          const today = todayYmd();
          if (fieldVal.slice(0, 10) !== today) return false;
        } else if (period === "week") {
          const start = startOfWeek(new Date()).getTime();
          const end   = start + 7 * 24 * 3600 * 1000;
          if (d.getTime() < start || d.getTime() >= end) return false;
        } else if (period === "month") {
          const start = startOfMonth(new Date()).getTime();
          const end   = startOfMonth(addMonths(new Date(), 1)).getTime();
          if (d.getTime() < start || d.getTime() >= end) return false;
        } else if (period === "year") {
          const start = startOfYear(new Date()).getTime();
          const end   = startOfYear(addYears(new Date(), 1)).getTime();
          if (d.getTime() < start || d.getTime() >= end) return false;
        } else if (period === "custom") {
          if (!customDay) return true; // no day picked yet → don't filter out
          if (fieldVal.slice(0, 10) !== customDay) return false;
        }
      }

      return true;
    });
  }, [tasks, users, filterStatus, filterAssignee, period, dateField, customDay, search]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filterStatus !== "all")   n++;
    if (filterAssignee !== "all") n++;
    if (period !== "all")         n++;
    if (search.trim())            n++;
    return n;
  }, [filterStatus, filterAssignee, period, search]);

  function clearFilters() {
    setFilterStatus("all");
    setFilterAssignee("all");
    setPeriod("all");
    setDateField("due");
    setCustomDay("");
    setSearch("");
  }

  async function remove(t: Task) {
    if (!confirm(`Delete task "${t.title}"?`)) return;
    try {
      await api.del(`/api/tasks/${t.id}`);
      setTasks((ls) => ls.filter((x) => x.id !== t.id));
      ok("Task deleted.");
    } catch (e: any) { err(e?.message || "Failed"); }
  }

  function exportCsv() {
    if (filtered.length === 0) { err("No tasks to export"); return; }
    const rows: Array<Array<unknown>> = [
      ["ID", "Title", "Description", "Assignee", "Assignee email", "Status", "Priority", "Due date", "Created", "Updated", "Created by"],
      ...filtered.map((t) => {
        const a = users.find((u) => u.id === t.assigneeId);
        const c = users.find((u) => u.id === t.createdBy);
        return [
          t.id,
          t.title,
          (t.description || "").replace(/\s+/g, " "),
          a?.name || "",
          a?.email || "",
          t.status,
          t.priority,
          t.dueDate || "",
          t.createdAt,
          t.updatedAt,
          c?.email || "",
        ];
      }),
    ];
    downloadCsv(dateStampedName("kubegraf-tasks"), rows);
    ok(`Tasks CSV downloaded (${filtered.length} row${filtered.length === 1 ? "" : "s"}).`);
  }

  return (
    <div>
      <PageHeader
        icon={<ListChecks size={18} />}
        eyebrow="Administration"
        title="Tasks"
        description="Create, assign and follow tasks across the team."
        actions={
          <>
            <button onClick={exportCsv} disabled={filtered.length === 0} className="ko-btn-ghost h-10 px-4 text-sm inline-flex items-center gap-1.5">
              <Download size={14} /> Export CSV
            </button>
            <button onClick={() => setCreating(true)} className="ko-btn-primary h-10 px-4 text-sm inline-flex items-center gap-1.5">
              <Plus size={16} /> New task
            </button>
          </>
        }
      />

      <div className="ko-card p-4 mb-4">
        {/* Top row — search + dropdowns + clear */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">Search</div>
            <div className="relative">
              <SearchIcon size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Title, description, assignee…"
                className="ko-input h-9 pl-8 pr-8 text-sm"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                  aria-label="Clear search"
                >
                  <XCircle size={13} />
                </button>
              )}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">Status</div>
            <select className="ko-input h-9 w-40" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="all">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </select>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">Assignee</div>
            <select className="ko-input h-9 w-52" value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}>
              <option value="all">All assignees</option>
              <option value="none">Unassigned</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
            </select>
          </div>

          {activeFilterCount > 0 && (
            <button
              onClick={clearFilters}
              className="ko-btn-ghost h-9 px-3 text-xs inline-flex items-center gap-1.5 ml-auto"
            >
              <XCircle size={12} /> Clear all ({activeFilterCount})
            </button>
          )}
        </div>

        {/* Bottom row — date filter (collapsed unless period != all OR explicitly expanded) */}
        <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-end gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5 inline-flex items-center gap-1.5">
              <CalendarRange size={11} /> By
            </div>
            <select
              className="ko-input h-9 w-36"
              value={dateField}
              onChange={(e) => setDateField(e.target.value as typeof dateField)}
            >
              <option value="due">Due date</option>
              <option value="created">Created</option>
              <option value="updated">Updated</option>
            </select>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">Period</div>
            <div className="inline-flex bg-gray-100 rounded-md p-0.5 flex-wrap">
              {([
                ["all",     "All"],
                ["today",   "Today"],
                ["week",    "This week"],
                ["month",   "This month"],
                ["year",    "This year"],
                ["overdue", "Overdue"],
                ["custom",  "Specific day"],
              ] as const).map(([key, label]) => {
                const disabled = key === "overdue" && dateField !== "due";
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={disabled}
                    onClick={() => setPeriod(key)}
                    className={
                      "h-8 px-3 rounded text-[12px] font-medium transition " +
                      (period === key
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-500 hover:text-gray-800 disabled:opacity-40 disabled:cursor-not-allowed")
                    }
                    title={disabled ? "Overdue only applies when filtering by Due date" : undefined}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {period === "custom" && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">Day</div>
              <input
                type="date"
                value={customDay}
                onChange={(e) => setCustomDay(e.target.value)}
                className="ko-input h-9 w-44"
              />
            </div>
          )}

          <div className="ml-auto text-right">
            <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500">Showing</div>
            <div className="font-display text-lg text-gray-900 leading-tight">
              {filtered.length} <span className="text-gray-400 text-sm font-normal">of {tasks.length}</span>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="ko-card p-4 space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="ko-skel h-10 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="ko-card">
          <EmptyState
            icon={tasks.length === 0 ? <ListChecks size={20} /> : <Filter size={20} />}
            title={tasks.length === 0 ? "No tasks yet" : "No tasks match these filters"}
            description={
              tasks.length === 0
                ? "Create the first task to get the team moving."
                : "Try widening your filters or clearing them."
            }
            action={
              tasks.length === 0
                ? <button onClick={() => setCreating(true)} className="ko-btn-primary h-10 px-4 text-sm inline-flex items-center gap-1.5"><Plus size={16} /> New task</button>
                : activeFilterCount > 0
                  ? <button onClick={clearFilters} className="ko-btn-ghost h-10 px-4 text-sm inline-flex items-center gap-1.5"><XCircle size={14} /> Clear filters</button>
                  : undefined
            }
          />
        </div>
      ) : (
        <div className="ko-card overflow-hidden">
          <table className="ko-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Assignee</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Due</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td className="font-medium">{t.title}</td>
                  <td>{users.find((u) => u.id === t.assigneeId)?.name || users.find((u) => u.id === t.assigneeId)?.email || <span className="text-gray-400">—</span>}</td>
                  <td><span className={statusClass(t.status)}>{t.status.replace("_", " ")}</span></td>
                  <td><span className={priorityClass(t.priority)}>{t.priority}</span></td>
                  <td className="text-gray-500">{t.dueDate ? fmtDate(t.dueDate) : "—"}</td>
                  <td className="text-right space-x-1">
                    <button onClick={() => setEditing(t)} className="ko-btn-ghost h-8 px-2 text-xs inline-flex items-center gap-1"><Pencil size={12} /> Edit</button>
                    <button onClick={() => remove(t)} className="ko-btn-ghost h-8 px-2 text-xs inline-flex items-center gap-1 hover:!border-red-200 hover:!text-red-700"><Trash2 size={12} /> Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <TaskDialog
          task={editing}
          users={users.filter((u) => u.active)}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={(t, created) => {
            if (created) setTasks((ls) => [t, ...ls]);
            else setTasks((ls) => ls.map((x) => (x.id === t.id ? t : x)));
            setCreating(false); setEditing(null);
            ok(created ? "Task created." : "Task updated.");
          }}
        />
      )}
    </div>
  );
}

interface DialogProps {
  task: Task | null;
  users: User[];
  onClose: () => void;
  onSaved: (t: Task, created: boolean) => void;
}

function TaskDialog({ task, users, onClose, onSaved }: DialogProps) {
  const { err } = useToast();
  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId || "");
  const [status, setStatus] = useState<TaskStatus>(task?.status || "TODO");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority || "MEDIUM");
  const [dueDate, setDueDate] = useState(task?.dueDate || "");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body: any = {
        title: title.trim(),
        description: description.trim(),
        assigneeId: assigneeId || null,
        status,
        priority,
        dueDate: dueDate || null,
      };
      if (task) {
        const r = await api.patch<{ task: Task }>(`/api/tasks/${task.id}`, body);
        onSaved(r.task, false);
      } else {
        const r = await api.post<{ task: Task }>("/api/tasks", body);
        onSaved(r.task, true);
      }
    } catch (e: any) { err(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-40 bg-gray-900/50 backdrop-blur-md ko-fade-in flex items-center justify-center px-4">
      <form onSubmit={save} className="ko-card-glow p-6 w-full max-w-lg">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-display text-xl">{task ? "Edit task" : "New task"}</h2>
          <button type="button" className="ko-btn-ghost h-8 w-8 inline-flex items-center justify-center" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="space-y-3">
          <Row label="Title"><input required className="ko-input" value={title} onChange={(e) => setTitle(e.target.value)} /></Row>
          <Row label="Description"><textarea className="ko-input min-h-[100px]" value={description} onChange={(e) => setDescription(e.target.value)} /></Row>
          <div className="grid grid-cols-2 gap-3">
            <Row label="Assignee">
              <select className="ko-input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">Unassigned</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
              </select>
            </Row>
            <Row label="Due date"><input type="date" className="ko-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Row>
            <Row label="Status">
              <select className="ko-input" value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
            </Row>
            <Row label="Priority">
              <select className="ko-input" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Row>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button type="button" onClick={onClose} className="ko-btn-ghost h-10 px-4 text-sm">Cancel</button>
          <button type="submit" disabled={busy || !title.trim()} className="ko-btn-primary h-10 px-5 text-sm">{busy ? "…" : task ? "Save changes" : "Create task"}</button>
        </div>
      </form>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function statusClass(s: string) {
  const base = "text-[10px] uppercase tracking-[0.16em] px-2 py-0.5 rounded-full border";
  if (s === "DONE")        return base + " border-emerald-200 text-emerald-700 bg-emerald-50";
  if (s === "IN_PROGRESS") return base + " border-brand-400 text-brand-800 bg-brand-50";
  if (s === "BLOCKED")     return base + " border-red-200 text-red-700 bg-red-50";
  return base + " border-gray-300 text-gray-600";
}
function priorityClass(p: string) {
  const base = "text-[10px] uppercase tracking-[0.16em] px-2 py-0.5 rounded-full border";
  if (p === "URGENT") return base + " border-red-300 text-red-700 bg-red-50";
  if (p === "HIGH")   return base + " border-brand-400 text-brand-800 bg-brand-50";
  if (p === "LOW")    return base + " border-gray-200 text-gray-500";
  return base + " border-gray-300 text-gray-700";
}

/* ── Date math ─────────────────────────────────────────────── */
function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}
function startOfMonth(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(1);
  return x;
}
function startOfYear(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setMonth(0, 1);
  return x;
}
function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}
function addYears(d: Date, n: number): Date {
  const x = new Date(d);
  x.setFullYear(x.getFullYear() + n);
  return x;
}
