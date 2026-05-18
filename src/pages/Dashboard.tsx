import { useEffect, useMemo, useState } from "react";
import { Play, Square, RefreshCw } from "lucide-react";
import { useAuth } from "../lib/auth-context";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { fmtDateTime, fmtMinutes, fmtTime, fmtDate, todayYmd } from "../lib/format";
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
        user!.role === "EMPLOYEE"
          ? api.get<{ tasks: Task[] }>("/api/tasks")
          : Promise.resolve({ tasks: [] as Task[] }),
      ]);
      setOpen(c.open);
      setRecent((e.entries || []).slice(0, 10));
      setMyTasks(t.tasks.filter((x) => x.status !== "DONE"));
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
      setRecent((rs) => [r.entry, ...rs].slice(0, 10));
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

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl tracking-tight">
            Hello, <span className="text-brand-100">{user?.name?.split(" ")[0] || "there"}</span>.
          </h1>
          <p className="text-sm text-white/55 mt-1">{fmtDate(new Date().toISOString())}</p>
        </div>
        <button onClick={load} className="ko-btn-ghost h-9 px-3 text-xs inline-flex items-center gap-1.5">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <section className="ko-card-glow p-6">
        <div className="flex flex-col lg:flex-row gap-6 lg:items-center lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-white/45 mb-2">
              {open ? "Clocked in" : "Clock"}
            </div>
            {open ? (
              <>
                <div className="font-mono text-5xl font-semibold tabular-nums text-brand-100">
                  {formatSec(elapsedSec)}
                </div>
                <div className="text-sm text-white/55 mt-1">
                  Started {fmtTime(open.startedAt)}{open.description ? ` · ${open.description}` : ""}
                </div>
              </>
            ) : (
              <>
                <div className="font-display text-3xl">{fmtMinutes(todayMinutes)} <span className="text-white/40 text-base font-normal">today</span></div>
                <div className="text-sm text-white/55 mt-1">Ready when you are.</div>
              </>
            )}
          </div>

          {open ? (
            <button onClick={clockOut} disabled={busy} className="ko-btn-danger h-12 px-6 inline-flex items-center gap-2">
              <Square size={16} /> {busy ? "…" : "Clock out"}
            </button>
          ) : (
            <div className="flex flex-col gap-3 w-full lg:w-auto lg:min-w-[380px]">
              {user?.role === "EMPLOYEE" && (
                <select
                  value={taskId}
                  onChange={(e) => setTaskId(e.target.value)}
                  className="ko-input"
                >
                  <option value="">No task (general)</option>
                  {myTasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title} {t.priority !== "MEDIUM" ? `· ${t.priority}` : ""}
                    </option>
                  ))}
                </select>
              )}
              <input
                placeholder="What are you working on? (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="ko-input"
              />
              <button onClick={clockIn} disabled={busy} className="ko-btn-primary h-12 px-6 inline-flex items-center justify-center gap-2">
                <Play size={16} /> {busy ? "…" : "Clock in"}
              </button>
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="font-display text-xl mb-3">Recent entries</h2>
        {recent.length === 0 ? (
          <div className="ko-card p-6 text-sm text-white/55">No time entries yet. Clock in to start tracking.</div>
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
                    <td>{e.endedAt ? fmtDateTime(e.endedAt) : <span className="text-brand-200">in progress</span>}</td>
                    <td className="font-mono">{e.endedAt ? fmtMinutes(e.durationMinutes) : "—"}</td>
                    <td className="text-white/70">{e.description || "—"}</td>
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

function formatSec(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
