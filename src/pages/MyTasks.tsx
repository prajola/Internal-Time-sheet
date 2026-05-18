import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { fmtDate } from "../lib/format";
import type { Task, TaskStatus } from "../types";

const STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"];

export default function MyTasks() {
  const { ok, err } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<{ tasks: Task[] }>("/api/tasks");
      r.tasks.sort((a, b) => (a.dueDate || "9999") < (b.dueDate || "9999") ? -1 : 1);
      setTasks(r.tasks);
    } catch (e: any) { err(e?.message || "Failed to load"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function setStatus(t: Task, status: TaskStatus) {
    try {
      const r = await api.patch<{ task: Task }>(`/api/tasks/${t.id}`, { status });
      setTasks((ls) => ls.map((x) => (x.id === r.task.id ? r.task : x)));
      ok("Status updated.");
    } catch (e: any) { err(e?.message || "Failed"); }
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl tracking-tight">My tasks</h1>
      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : tasks.length === 0 ? (
        <div className="ko-card p-6 text-sm text-gray-500">No tasks assigned to you.</div>
      ) : (
        <div className="grid gap-3">
          {tasks.map((t) => (
            <div key={t.id} className="ko-card p-4 flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{t.title}</span>
                  <span className={priorityClass(t.priority)}>{t.priority}</span>
                  {t.dueDate && <span className="text-xs text-gray-500">due {fmtDate(t.dueDate)}</span>}
                </div>
                {t.description && <div className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{t.description}</div>}
              </div>
              <select
                value={t.status}
                onChange={(e) => setStatus(t, e.target.value as TaskStatus)}
                className="ko-input h-9 w-44"
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function priorityClass(p: string) {
  const base = "text-[10px] uppercase tracking-[0.16em] px-2 py-0.5 rounded-full border";
  if (p === "URGENT") return base + " border-red-300 text-red-700 bg-red-50";
  if (p === "HIGH")   return base + " border-brand-400 text-brand-800 bg-brand-50";
  if (p === "LOW")    return base + " border-gray-200 text-gray-500";
  return base + " border-gray-300 text-gray-700";
}
