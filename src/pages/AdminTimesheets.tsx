import { useEffect, useMemo, useState } from "react";
import {
  Download, CalendarRange, Clock, Search as SearchIcon, XCircle, Filter,
} from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { fmtDateTime, fmtMinutes, todayYmd } from "../lib/format";
import { downloadCsv as csvDownload, dateStampedName } from "../lib/csv";
import type { Task, TimeEntry, User } from "../types";

type Period = "all" | "today" | "week" | "month" | "year" | "custom";

export default function AdminTimesheets() {
  const { err } = useToast();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters — same pattern as AdminTasks / AdminUsers.
  const [search, setSearch] = useState<string>("");
  const [userId, setUserId] = useState<string>("all");
  const [taskId, setTaskId] = useState<string>("all");
  const [period, setPeriod] = useState<Period>("month");
  const [customDay, setCustomDay] = useState<string>("");

  async function load() {
    setLoading(true);
    try {
      const [e, u, t] = await Promise.all([
        api.get<{ entries: TimeEntry[] }>("/api/time-entries"),
        api.get<{ users: User[] }>("/api/users"),
        api.get<{ tasks: Task[] }>("/api/tasks"),
      ]);
      setEntries(e.entries);
      setUsers(u.users);
      setTasks(t.tasks);
    } catch (e: any) { err(e?.message || "Failed"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (userId !== "all" && e.userId !== userId) return false;
      if (taskId !== "all") {
        if (taskId === "none" ? Boolean(e.taskId) : e.taskId !== taskId) return false;
      }

      if (q) {
        const u = users.find((x) => x.id === e.userId);
        const t = tasks.find((x) => x.id === e.taskId);
        const hay = [u?.name, u?.email, t?.title, e.description].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }

      if (period !== "all") {
        const started = e.startedAt;
        if (!started) return false;
        const d = new Date(started);
        if (Number.isNaN(d.getTime())) return false;

        if (period === "today") {
          if (started.slice(0, 10) !== todayYmd()) return false;
        } else if (period === "week") {
          const start = startOfWeek(new Date()).getTime();
          const end = start + 7 * 24 * 3600 * 1000;
          if (d.getTime() < start || d.getTime() >= end) return false;
        } else if (period === "month") {
          const start = startOfMonth(new Date()).getTime();
          const end = startOfMonth(addMonths(new Date(), 1)).getTime();
          if (d.getTime() < start || d.getTime() >= end) return false;
        } else if (period === "year") {
          const start = startOfYear(new Date()).getTime();
          const end = startOfYear(addYears(new Date(), 1)).getTime();
          if (d.getTime() < start || d.getTime() >= end) return false;
        } else if (period === "custom") {
          if (!customDay) return true;
          if (started.slice(0, 10) !== customDay) return false;
        }
      }

      return true;
    });
  }, [entries, users, tasks, search, userId, taskId, period, customDay]);

  const total = useMemo(
    () => filtered.reduce((s, e) => s + (e.durationMinutes || 0), 0),
    [filtered]
  );

  const perUser = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of filtered) m.set(e.userId, (m.get(e.userId) || 0) + (e.durationMinutes || 0));
    return Array.from(m.entries())
      .map(([uid, min]) => ({ uid, min, user: users.find((u) => u.id === uid) }))
      .sort((a, b) => b.min - a.min);
  }, [filtered, users]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (search.trim())      n++;
    if (userId !== "all")   n++;
    if (taskId !== "all")   n++;
    if (period !== "all")   n++;
    return n;
  }, [search, userId, taskId, period]);

  function clearFilters() {
    setSearch("");
    setUserId("all");
    setTaskId("all");
    setPeriod("all");
    setCustomDay("");
  }

  function downloadCsv() {
    if (filtered.length === 0) { err("No entries to export"); return; }
    const rows: Array<Array<unknown>> = [
      ["User", "Email", "Task", "Started", "Ended", "Minutes", "Hours", "Description"],
      ...filtered.map((e) => {
        const u = users.find((x) => x.id === e.userId);
        const t = tasks.find((x) => x.id === e.taskId);
        const mins = e.durationMinutes ?? 0;
        return [
          u?.name || "",
          u?.email || "",
          t?.title || "",
          e.startedAt,
          e.endedAt || "",
          String(mins),
          (mins / 60).toFixed(2),
          (e.description || "").replace(/\n/g, " "),
        ];
      }),
    ];
    csvDownload(dateStampedName("kubegraf-timesheets"), rows);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<CalendarRange size={18} />}
        eyebrow="Administration"
        title="All timesheets"
        description="Every clock-in across every user, filterable by date, user and task."
        actions={
          <button onClick={downloadCsv} disabled={filtered.length === 0} className="ko-btn-ghost h-10 px-4 text-sm inline-flex items-center gap-1.5">
            <Download size={14} /> Export CSV
          </button>
        }
      />

      {/* ── Filter card ─────────────────────────────────────── */}
      {entries.length > 0 && (
        <div className="ko-card p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">Search</div>
              <div className="relative">
                <SearchIcon size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="User, email, task, description…"
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

            <div className="w-full sm:w-auto">
              <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">User</div>
              <select className="ko-input h-9 w-full sm:w-52" value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="all">All users</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
              </select>
            </div>

            <div className="w-full sm:w-auto">
              <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">Task</div>
              <select className="ko-input h-9 w-full sm:w-56" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                <option value="all">All tasks</option>
                <option value="none">No task (general work)</option>
                {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </div>

            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="ko-btn-ghost h-9 px-3 text-xs inline-flex items-center gap-1.5 w-full sm:w-auto sm:ml-auto justify-center">
                <XCircle size={12} /> Clear all ({activeFilterCount})
              </button>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-end gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5 inline-flex items-center gap-1.5">
                <CalendarRange size={11} /> Period
              </div>
              <div className="inline-flex bg-gray-100 rounded-md p-0.5 flex-wrap">
                {([
                  ["all",    "All time"],
                  ["today",  "Today"],
                  ["week",   "This week"],
                  ["month",  "This month"],
                  ["year",   "This year"],
                  ["custom", "Specific day"],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPeriod(key)}
                    className={
                      "h-8 px-3 rounded text-[12px] font-medium transition " +
                      (period === key
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-500 hover:text-gray-800")
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {period === "custom" && (
              <div className="w-full sm:w-auto">
                <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">Day</div>
                <input
                  type="date"
                  value={customDay}
                  onChange={(e) => setCustomDay(e.target.value)}
                  className="ko-input h-9 w-full sm:w-44"
                />
              </div>
            )}

            <div className="w-full sm:w-auto sm:ml-auto flex items-end gap-6">
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500">Showing</div>
                <div className="font-display text-lg text-gray-900 leading-tight">
                  {filtered.length} <span className="text-gray-400 text-sm font-normal">of {entries.length}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500">Total</div>
                <div className="font-display text-lg text-brand-800 leading-tight">{fmtMinutes(total)}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Per-user summary cards (top 8) */}
      {perUser.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {perUser.slice(0, 8).map((p) => (
            <div key={p.uid} className="ko-card p-4">
              <div className="text-[11px] text-gray-500 truncate">{p.user?.name || p.user?.email || p.uid}</div>
              <div className="font-display text-xl text-brand-800">{fmtMinutes(p.min)}</div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="ko-card p-4 space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="ko-skel h-10 w-full" />)}
        </div>
      ) : entries.length === 0 ? (
        <div className="ko-card">
          <EmptyState
            icon={<Clock size={20} />}
            title="No time entries yet"
            description="When someone clocks in, their entries appear here."
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="ko-card">
          <EmptyState
            icon={<Filter size={20} />}
            title="No entries match these filters"
            description="Try widening the date range, or clearing your filters."
            action={
              activeFilterCount > 0
                ? <button onClick={clearFilters} className="ko-btn-ghost h-10 px-4 text-sm inline-flex items-center gap-1.5"><XCircle size={14} /> Clear filters</button>
                : undefined
            }
          />
        </div>
      ) : (
        <div className="ko-card overflow-hidden">
          <div className="ko-table-scroll"><table className="ko-table"><thead>
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
              {filtered.map((e) => {
                const u = users.find((x) => x.id === e.userId);
                const t = tasks.find((x) => x.id === e.taskId);
                return (
                  <tr key={e.id}>
                    <td>{u?.name || u?.email || <span className="text-gray-400">unknown</span>}</td>
                    <td className="text-gray-600">{t?.title || "—"}</td>
                    <td>{fmtDateTime(e.startedAt)}</td>
                    <td>{e.endedAt ? fmtDateTime(e.endedAt) : <span className="text-brand-700">in progress</span>}</td>
                    <td className="font-mono">{e.endedAt ? fmtMinutes(e.durationMinutes) : "—"}</td>
                    <td className="text-gray-600">{e.description || "—"}</td>
                  </tr>
                );
              })}
            </tbody></table></div>
        </div>
      )}
    </div>
  );
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
