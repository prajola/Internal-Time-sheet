import { useEffect, useMemo, useState } from "react";
import { ClipboardList, CalendarDays, Layers } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { fmtDate } from "../lib/format";
import type { Task, TaskStatus } from "../types";

const STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"];
const FILTERS: Array<"all" | "active" | "done"> = ["all", "active", "done"];

export default function MyTasks() {
  const { ok, err } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "done">("active");

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

  const counts = useMemo(() => ({
    all: tasks.length,
    active: tasks.filter((t) => t.status !== "DONE").length,
    done: tasks.filter((t) => t.status === "DONE").length,
  }), [tasks]);

  const visible = useMemo(() => {
    if (filter === "active") return tasks.filter((t) => t.status !== "DONE");
    if (filter === "done")   return tasks.filter((t) => t.status === "DONE");
    return tasks;
  }, [tasks, filter]);

  return (
    <div>
      <PageHeader
        icon={<ClipboardList size={18} />}
        eyebrow="Workspace"
        title="My tasks"
        description="Tasks assigned to you. Update status here as your work progresses."
      />

      {/* Filter chips */}
      <div className="inline-flex bg-gray-100 rounded-lg p-1 mb-5">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={
              "h-8 px-3 rounded-md text-[12px] font-medium transition inline-flex items-center gap-1.5 " +
              (filter === f ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800")
            }
          >
            <span className="capitalize">{f}</span>
            <span className={"text-[10px] px-1.5 py-0.5 rounded " + (filter === f ? "bg-brand-50 text-brand-800" : "bg-gray-200 text-gray-600")}>
              {counts[f]}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid gap-2.5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="ko-card p-4">
              <div className="ko-skel h-4 w-1/2 mb-2" />
              <div className="ko-skel h-3 w-1/3" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="ko-card">
          <EmptyState
            icon={<ClipboardList size={20} />}
            title={filter === "done" ? "No completed tasks yet" : filter === "active" ? "All clear!" : "No tasks here"}
            description={
              filter === "active"
                ? "When new tasks come in, they'll show up here. In the meantime, why not clock in?"
                : "There's nothing in this view yet."
            }
            size="md"
          />
        </div>
      ) : (
        <div className="grid gap-2.5 ko-fade-in">
          {visible.map((t) => (
            <div
              key={t.id}
              className="ko-card p-4 flex flex-col md:flex-row md:items-center gap-4 hover:border-gray-300 transition"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={priorityDot(t.priority)} />
                  <span className="font-semibold text-gray-900">{t.title}</span>
                  <span className={priorityClass(t.priority)}>{t.priority}</span>
                  {t.dueDate && (
                    <span className="text-[11px] text-gray-500 inline-flex items-center gap-1">
                      <CalendarDays size={11} /> due {fmtDate(t.dueDate)}
                    </span>
                  )}
                </div>
                {t.description && (
                  <div className="text-sm text-gray-600 mt-1.5 whitespace-pre-wrap leading-relaxed">
                    {t.description}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Layers size={13} className="text-gray-400" />
                <select
                  value={t.status}
                  onChange={(e) => setStatus(t, e.target.value as TaskStatus)}
                  className="ko-input h-9 w-44"
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function priorityClass(p: string) {
  const base = "text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-full border font-medium";
  if (p === "URGENT") return base + " border-red-200 text-red-700 bg-red-50";
  if (p === "HIGH")   return base + " border-brand-200 text-brand-800 bg-brand-50";
  if (p === "LOW")    return base + " border-gray-200 text-gray-500 bg-gray-50";
  return base + " border-gray-200 text-gray-700 bg-gray-50";
}

function priorityDot(p: string) {
  if (p === "URGENT") return "w-1.5 h-1.5 rounded-full bg-red-500";
  if (p === "HIGH")   return "w-1.5 h-1.5 rounded-full bg-brand-500";
  if (p === "LOW")    return "w-1.5 h-1.5 rounded-full bg-gray-300";
  return "w-1.5 h-1.5 rounded-full bg-gray-400";
}
