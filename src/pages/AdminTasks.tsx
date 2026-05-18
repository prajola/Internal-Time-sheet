import { useEffect, useMemo, useState } from "react";
import { Plus, X, Pencil, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { fmtDate } from "../lib/format";
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
    return tasks.filter((t) =>
      (filterStatus === "all" || t.status === filterStatus) &&
      (filterAssignee === "all" || t.assigneeId === filterAssignee || (filterAssignee === "none" && !t.assigneeId))
    );
  }, [tasks, filterStatus, filterAssignee]);

  async function remove(t: Task) {
    if (!confirm(`Delete task "${t.title}"?`)) return;
    try {
      await api.del(`/api/tasks/${t.id}`);
      setTasks((ls) => ls.filter((x) => x.id !== t.id));
      ok("Task deleted.");
    } catch (e: any) { err(e?.message || "Failed"); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Tasks</h1>
          <p className="text-sm text-white/55 mt-1">Create, assign and follow tasks across the team.</p>
        </div>
        <button onClick={() => setCreating(true)} className="ko-btn-primary h-10 px-4 text-sm inline-flex items-center gap-1.5">
          <Plus size={16} /> New task
        </button>
      </div>

      <div className="ko-card p-3 flex gap-3 flex-wrap">
        <select className="ko-input h-9 w-44" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="all">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
        <select className="ko-input h-9 w-56" value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}>
          <option value="all">All assignees</option>
          <option value="none">Unassigned</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-sm text-white/50">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="ko-card p-6 text-sm text-white/55">No tasks match this view.</div>
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
                  <td>{users.find((u) => u.id === t.assigneeId)?.name || users.find((u) => u.id === t.assigneeId)?.email || <span className="text-white/40">—</span>}</td>
                  <td><span className={statusClass(t.status)}>{t.status.replace("_", " ")}</span></td>
                  <td><span className={priorityClass(t.priority)}>{t.priority}</span></td>
                  <td className="text-white/60">{t.dueDate ? fmtDate(t.dueDate) : "—"}</td>
                  <td className="text-right space-x-1">
                    <button onClick={() => setEditing(t)} className="ko-btn-ghost h-8 px-2 text-xs inline-flex items-center gap-1"><Pencil size={12} /> Edit</button>
                    <button onClick={() => remove(t)} className="ko-btn-ghost h-8 px-2 text-xs inline-flex items-center gap-1 hover:!border-red-400/40 hover:!text-red-200"><Trash2 size={12} /> Delete</button>
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
    <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur flex items-center justify-center px-4">
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
      <div className="text-[10px] uppercase tracking-[0.16em] text-white/45 mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function statusClass(s: string) {
  const base = "text-[10px] uppercase tracking-[0.16em] px-2 py-0.5 rounded-full border";
  if (s === "DONE")        return base + " border-emerald-400/40 text-emerald-200 bg-emerald-500/10";
  if (s === "IN_PROGRESS") return base + " border-brand-400/60 text-brand-100 bg-brand-500/10";
  if (s === "BLOCKED")     return base + " border-red-400/40 text-red-200 bg-red-500/10";
  return base + " border-white/20 text-white/65";
}
function priorityClass(p: string) {
  const base = "text-[10px] uppercase tracking-[0.16em] px-2 py-0.5 rounded-full border";
  if (p === "URGENT") return base + " border-red-400/50 text-red-200 bg-red-500/10";
  if (p === "HIGH")   return base + " border-brand-400/60 text-brand-100 bg-brand-500/10";
  if (p === "LOW")    return base + " border-white/15 text-white/60";
  return base + " border-white/20 text-white/75";
}
