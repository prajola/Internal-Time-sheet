import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Play, Square, RefreshCw, Clock as ClockIcon, ListChecks, CalendarCheck,
  ArrowRight, Sparkles, Hourglass,
} from "lucide-react";
import { useAuth } from "../lib/auth-context";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { EmptyState } from "../components/EmptyState";
import { NotificationFeed } from "../components/NotificationFeed";
import { fmtDateTime, fmtMinutes, fmtTime, todayYmd } from "../lib/format";
import type { Task, TimeEntry } from "../types";

export default function Dashboard() {
  const { user } = useAuth();
  const { ok, err } = useToast();
  const [open, setOpen] = useState<TimeEntry | null>(null);
  const [recent, setRecent] = useState<TimeEntry[]>([]);
  const [myTasks, setMyTasks] = useState<Task[]>([]);
  const [taskId, setTaskId] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  async function load() {
    try {
      const [c, e, t] = await Promise.all([
        api.get<{ open: TimeEntry | null }>("/api/time-entries?open=1"),
        api.get<{ entries: TimeEntry[] }>(`/api/time-entries?userId=${user!.id}`),
        api.get<{ tasks: Task[] }>("/api/tasks"),
      ]);
      setOpen(c.open);
      setRecent((e.entries || []).slice(0, 8));
      // Admins see all tasks via /api/tasks; for the dashboard "my tasks"
      // selector we only want ones assigned to the current user.
      const mine = (t.tasks || []).filter(
        (x) => x.assigneeId === user!.id && x.status !== "DONE"
      );
      setMyTasks(mine);
    } catch (e: any) {
      err(e?.message || "Failed to load");
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [open]);

  const elapsedSec = useMemo(() => {
    if (!open) return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(open.startedAt).getTime()) / 1000));
  }, [open, tick]);

  async function clockIn() {
    setBusy(true);
    try {
      const r = await api.post<{ entry: TimeEntry }>("/api/time-entries", {
        action: "clock-in", taskId: taskId || null, description: note,
      });
      setOpen(r.entry);
      setNote("");
      ok("Clocked in.");
    } catch (e: any) {
      err(e?.message || "Could not clock in");
    } finally { setBusy(false); }
  }

  async function clockOut() {
    setBusy(true);
    try {
      const r = await api.post<{ entry: TimeEntry }>("/api/time-entries", { action: "clock-out" });
      setOpen(null);
      setRecent((rs) => [r.entry, ...rs].slice(0, 8));
      ok(`Clocked out · ${fmtMinutes(r.entry.durationMinutes)}`);
    } catch (e: any) {
      err(e?.message || "Could not clock out");
    } finally { setBusy(false); }
  }

  const todayMinutes = useMemo(() => {
    const d = todayYmd();
    return recent
      .filter((e) => e.startedAt.slice(0, 10) === d && e.endedAt)
      .reduce((sum, e) => sum + e.durationMinutes, 0)
      + (open && open.startedAt.slice(0,10) === todayYmd() ? Math.floor(elapsedSec / 60) : 0);
  }, [recent, open, elapsedSec]);

  const weekMinutes = useMemo(() => {
    const monday = startOfWeek(new Date());
    let m = recent
      .filter((e) => new Date(e.startedAt) >= monday && e.endedAt)
      .reduce((s, e) => s + e.durationMinutes, 0);
    if (open && new Date(open.startedAt) >= monday) m += Math.floor(elapsedSec / 60);
    return m;
  }, [recent, open, elapsedSec]);

  const greeting = useMemo(() => greetingFor(new Date().getHours()), []);
  const firstName = user?.name?.split(" ")[0] || user?.email.split("@")[0] || "there";

  return (
    <div className="space-y-7 ko-fade-in-up">
      {/* ── Welcome hero ─────────────────────────────────────── */}
      <section
        className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-6 md:p-8"
        style={{
          background:
            "linear-gradient(135deg, #fff 0%, #fff 60%, rgba(255,160,80,0.06) 100%)",
          boxShadow: "var(--ko-shadow-md)",
        }}
      >
        <div
          aria-hidden
          className="absolute -top-12 -right-12 w-56 h-56 rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, rgba(255,160,80,0.18), transparent)",
          }}
        />
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="ko-eyebrow mb-2 inline-flex items-center gap-1.5">
              <Sparkles size={11} /> {greeting}
            </div>
            <h1 className="ko-h1">
              Hello, <span className="text-brand-700">{firstName}</span>
              <span className="text-gray-400">.</span>
            </h1>
            <p className="text-sm text-gray-500 mt-2 max-w-md">
              {open
                ? "You're currently clocked in. Don't forget to clock out when you wrap."
                : "Ready to start your day? Track time, complete tasks, all in one place."}
            </p>
          </div>
          <button
            onClick={load}
            className="ko-btn-ghost h-9 px-3 text-xs inline-flex items-center gap-1.5"
          >
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </section>

      {/* ── Clock card ───────────────────────────────────────── */}
      <section
        className={
          "rounded-2xl p-6 md:p-7 transition-all " +
          (open
            ? "border-2 border-emerald-300 bg-emerald-50/40"
            : "border border-gray-200 bg-white shadow-[var(--ko-shadow-md)]")
        }
      >
        <div className="flex flex-col lg:flex-row gap-6 lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="ko-eyebrow mb-2 inline-flex items-center gap-1.5">
              {open ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 ko-pulse-soft" />
                  <span className="text-emerald-800">Clocked in</span>
                </>
              ) : (
                <><ClockIcon size={11} /> Today</>
              )}
            </div>
            {open ? (
              <>
                <div className="font-mono text-5xl md:text-6xl font-semibold tabular-nums text-emerald-800 leading-none">
                  {formatSec(elapsedSec)}
                </div>
                <div className="text-sm text-gray-600 mt-2">
                  Started <span className="text-gray-900">{fmtTime(open.startedAt)}</span>
                  {open.description ? <> · {open.description}</> : null}
                </div>
              </>
            ) : (
              <>
                <div className="font-display text-4xl md:text-5xl text-gray-900 leading-none">
                  {fmtMinutes(todayMinutes)}
                  <span className="text-gray-400 text-lg ml-2 font-normal">tracked today</span>
                </div>
                <div className="text-sm text-gray-500 mt-2">Ready when you are.</div>
              </>
            )}
          </div>

          {open ? (
            <button
              onClick={clockOut}
              disabled={busy}
              className="ko-btn-danger h-12 px-6 inline-flex items-center gap-2 text-sm font-semibold"
            >
              <Square size={15} /> {busy ? "…" : "Clock out"}
            </button>
          ) : (
            <div className="flex flex-col gap-3 w-full lg:w-auto lg:min-w-[400px]">
              {user?.role === "EMPLOYEE" && (
                <select
                  value={taskId}
                  onChange={(e) => setTaskId(e.target.value)}
                  className="ko-input h-11"
                >
                  <option value="">No task (general work)</option>
                  {myTasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}{t.priority !== "MEDIUM" ? ` · ${t.priority}` : ""}
                    </option>
                  ))}
                </select>
              )}
              <input
                placeholder="What are you working on? (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="ko-input h-11"
              />
              <button
                onClick={clockIn}
                disabled={busy}
                className="ko-btn-primary h-12 px-6 inline-flex items-center justify-center gap-2 text-sm font-semibold"
              >
                <Play size={15} /> {busy ? "…" : "Clock in"}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ── Stats row ─────────────────────────────────────────── */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<ClockIcon size={14} />} label="Today"     value={fmtMinutes(todayMinutes)} tone="brand" />
        <StatCard icon={<Hourglass size={14} />} label="This week" value={fmtMinutes(weekMinutes)}  />
        <StatCard icon={<ListChecks size={14} />} label="Open tasks" value={myTasks.length} link={user?.role === "EMPLOYEE" ? "/my-tasks" : undefined} />
        <StatCard icon={<CalendarCheck size={14} />} label="Entries" value={recent.length} link={user?.role === "EMPLOYEE" ? "/my-timesheet" : undefined} />
      </section>

      {/* ── Notifications inline (same data as the header bell) ─ */}
      <NotificationFeed />


      {/* ── My tasks preview ─────────────────────────────────── */}
      {user?.role === "EMPLOYEE" && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="ko-h2">My tasks</h2>
            <Link href="/my-tasks" className="text-[12px] text-brand-700 hover:underline inline-flex items-center gap-1">
              See all <ArrowRight size={12} />
            </Link>
          </div>
          {myTasks.length === 0 ? (
            <div className="ko-card">
              <EmptyState
                icon={<ListChecks size={20} />}
                title="No active tasks"
                description="When an admin assigns you something, it'll show up here."
                size="sm"
              />
            </div>
          ) : (
            <div className="grid gap-2.5">
              {myTasks.slice(0, 4).map((t) => (
                <Link
                  key={t.id}
                  href="/my-tasks"
                  className="ko-card-interactive p-4 flex items-center justify-between gap-3 group"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 truncate">{t.title}</span>
                      <span className={priorityClass(t.priority)}>{t.priority}</span>
                      <span className={statusClass(t.status)}>{t.status.replace("_", " ")}</span>
                    </div>
                    {t.dueDate && (
                      <div className="text-[12px] text-gray-500 mt-1">Due {t.dueDate}</div>
                    )}
                  </div>
                  <ArrowRight size={14} className="text-gray-400 group-hover:text-brand-700 transition" />
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Recent entries ──────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="ko-h2">Recent entries</h2>
          {user?.role === "EMPLOYEE" && (
            <Link href="/my-timesheet" className="text-[12px] text-brand-700 hover:underline inline-flex items-center gap-1">
              See all <ArrowRight size={12} />
            </Link>
          )}
        </div>
        {recent.length === 0 ? (
          <div className="ko-card">
            <EmptyState
              icon={<ClockIcon size={20} />}
              title="No entries yet"
              description="Clock in above to start tracking your time."
            />
          </div>
        ) : (
          <div className="ko-card overflow-hidden">
            <table className="ko-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Ended</th>
                  <th>Duration</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((e) => (
                  <tr key={e.id}>
                    <td>{fmtDateTime(e.startedAt)}</td>
                    <td>{e.endedAt ? fmtDateTime(e.endedAt) : <span className="text-emerald-700 font-medium">in progress</span>}</td>
                    <td className="font-mono">{e.endedAt ? fmtMinutes(e.durationMinutes) : "—"}</td>
                    <td className="text-gray-600">{e.description || <span className="text-gray-400">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ icon, label, value, link, tone }: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  link?: string;
  tone?: "brand";
}) {
  const inner = (
    <div className="ko-card p-4 h-full">
      <div className="flex items-center gap-2 text-gray-500">
        <span className={tone === "brand" ? "text-brand-700" : "text-gray-400"}>{icon}</span>
        <span className="text-[10px] uppercase tracking-[0.16em] font-medium">{label}</span>
      </div>
      <div className={"font-display text-2xl mt-2 " + (tone === "brand" ? "text-brand-800" : "text-gray-900")}>
        {value}
      </div>
    </div>
  );
  return link ? (
    <Link href={link} className="block hover:[&_.ko-card]:shadow-[var(--ko-shadow-md)] hover:[&_.ko-card]:border-gray-300 transition">
      {inner}
    </Link>
  ) : inner;
}

function priorityClass(p: string): string {
  const base = "text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-full border font-medium";
  if (p === "URGENT") return base + " border-red-200 text-red-700 bg-red-50";
  if (p === "HIGH")   return base + " border-brand-200 text-brand-800 bg-brand-50";
  if (p === "LOW")    return base + " border-gray-200 text-gray-500 bg-gray-50";
  return base + " border-gray-200 text-gray-700 bg-gray-50";
}

function statusClass(s: string): string {
  const base = "text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-full border font-medium";
  if (s === "DONE")        return base + " border-emerald-200 text-emerald-700 bg-emerald-50";
  if (s === "IN_PROGRESS") return base + " border-brand-200 text-brand-800 bg-brand-50";
  if (s === "BLOCKED")     return base + " border-red-200 text-red-700 bg-red-50";
  return base + " border-gray-200 text-gray-700 bg-gray-50";
}

function formatSec(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function greetingFor(hour: number): string {
  if (hour < 5)  return "Burning the midnight oil";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Late tonight";
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}
