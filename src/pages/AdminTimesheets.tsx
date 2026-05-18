import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { Filters, FilterValue, buildQuery } from "../components/Filters";
import { fmtDateTime, fmtMinutes, todayYmd } from "../lib/format";
import type { Task, TimeEntry, User } from "../types";

export default function AdminTimesheets() {
  const { err } = useToast();
  const [filter, setFilter] = useState<FilterValue>({ mode: "month", month: todayYmd().slice(0, 7) });
  const [userId, setUserId] = useState<string>("all");
  const [taskId, setTaskId] = useState<string>("all");
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const q = new URLSearchParams(buildQuery(filter));
      if (userId !== "all") q.set("userId", userId);
      if (taskId !== "all") q.set("taskId", taskId);
      const [e, u, t] = await Promise.all([
        api.get<{ entries: TimeEntry[] }>(`/api/time-entries${q.toString() ? `?${q.toString()}` : ""}`),
        api.get<{ users: User[] }>("/api/users"),
        api.get<{ tasks: Task[] }>("/api/tasks"),
      ]);
      setEntries(e.entries);
      setUsers(u.users);
      setTasks(t.tasks);
    } catch (e: any) { err(e?.message || "Failed"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [filter, userId, taskId]);

  const total = useMemo(() => entries.reduce((s, e) => s + (e.durationMinutes || 0), 0), [entries]);

  const perUser = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.userId, (m.get(e.userId) || 0) + (e.durationMinutes || 0));
    return Array.from(m.entries())
      .map(([uid, min]) => ({ uid, min, user: users.find((u) => u.id === uid) }))
      .sort((a, b) => b.min - a.min);
  }, [entries, users]);

  function downloadCsv() {
    const rows = [
      ["User", "Email", "Task", "Started", "Ended", "Minutes", "Description"],
      ...entries.map((e) => {
        const u = users.find((x) => x.id === e.userId);
        const t = tasks.find((x) => x.id === e.taskId);
        return [
          u?.name || "",
          u?.email || "",
          t?.title || "",
          e.startedAt,
          e.endedAt || "",
          String(e.durationMinutes ?? 0),
          (e.description || "").replace(/\n/g, " "),
        ];
      }),
    ];
    const csv = rows.map((r) => r.map(escapeCsv).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timesheet-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl tracking-tight">All timesheets</h1>
          <p className="text-sm text-white/55 mt-1">Every clock-in across every user, filterable by date, user and task.</p>
        </div>
        <button onClick={downloadCsv} className="ko-btn-ghost h-10 px-4 text-sm inline-flex items-center gap-1.5">
          <Download size={14} /> Export CSV
        </button>
      </div>

      <Filters
        value={filter}
        onChange={setFilter}
        extra={
          <>
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-white/45 mb-1">User</div>
              <select className="ko-input h-9 w-52" value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="all">All users</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
              </select>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-white/45 mb-1">Task</div>
              <select className="ko-input h-9 w-56" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                <option value="all">All tasks</option>
                {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.16em] text-white/45">Total</div>
              <div className="font-display text-2xl text-brand-100 leading-none">{fmtMinutes(total)}</div>
            </div>
          </>
        }
      />

      {perUser.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {perUser.slice(0, 8).map((p) => (
            <div key={p.uid} className="ko-card p-4">
              <div className="text-[11px] text-white/55 truncate">{p.user?.name || p.user?.email || p.uid}</div>
              <div className="font-display text-xl text-brand-100">{fmtMinutes(p.min)}</div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-white/50">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="ko-card p-6 text-sm text-white/55">No entries match this view.</div>
      ) : (
        <div className="ko-card overflow-hidden">
          <table className="ko-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Task</th>
                <th>Started</th>
                <th>Ended</th>
                <th>Duration</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const u = users.find((x) => x.id === e.userId);
                const t = tasks.find((x) => x.id === e.taskId);
                return (
                  <tr key={e.id}>
                    <td>{u?.name || u?.email || <span className="text-white/40">unknown</span>}</td>
                    <td className="text-white/70">{t?.title || "—"}</td>
                    <td>{fmtDateTime(e.startedAt)}</td>
                    <td>{e.endedAt ? fmtDateTime(e.endedAt) : <span className="text-brand-200">in progress</span>}</td>
                    <td className="font-mono">{e.endedAt ? fmtMinutes(e.durationMinutes) : "—"}</td>
                    <td className="text-white/70">{e.description || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function escapeCsv(s: string): string {
  if (s == null) return "";
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
