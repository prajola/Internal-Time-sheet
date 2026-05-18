import { useEffect, useMemo, useState } from "react";
import {
  Search, KeyRound, LogOut, UserCog, UserX, UserCheck, Trash2,
  Shield, Calendar, ListChecks, Clock, AlertTriangle, Mail, Play,
  Activity, FileText, History, ShieldCheck, CalendarDays, Hourglass,
  ArrowUpRight, ArrowDownRight, CheckCircle2, CircleDot,
} from "lucide-react";
import { Link } from "wouter";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useToast } from "../components/Toast";
import { fmtDate, fmtDateTime, fmtMinutes } from "../lib/format";
import type { Role, Task, TimeEntry, User } from "../types";

export default function AdminManage() {
  const { user: me } = useAuth();
  const { ok, err } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [openEntries, setOpenEntries] = useState<Record<string, TimeEntry>>({}); // userId → open entry
  const [tickNow, setTickNow] = useState(Date.now());
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"overview" | "timesheet" | "tasks" | "account">("overview");
  const [tsRange, setTsRange] = useState<"all" | "week" | "month" | "year">("all");

  async function loadAll() {
    try {
      const [u, t] = await Promise.all([
        api.get<{ users: User[] }>("/api/users"),
        api.get<{ tasks: Task[] }>("/api/tasks"),
      ]);
      u.users.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
      setUsers(u.users);
      setTasks(t.tasks);
      if (!selectedId && u.users.length) setSelectedId(u.users[0].id);
    } catch (e: any) { err(e?.message || "Failed to load"); }
  }
  useEffect(() => { loadAll(); }, []);

  // Currently-clocked-in map. Polls every 15s so the badge in the left
  // rail + the live timer in the detail card update without a refresh.
  async function loadOpenEntries() {
    try {
      const r = await api.get<{ items: Array<{ entry: TimeEntry; user: User }> }>(
        "/api/time-entries?openAll=1",
      );
      const map: Record<string, TimeEntry> = {};
      for (const it of r.items || []) map[it.entry.userId] = it.entry;
      setOpenEntries(map);
    } catch { /* silent — admin still has stale data */ }
  }
  useEffect(() => {
    loadOpenEntries();
    const id = setInterval(loadOpenEntries, 15_000);
    return () => clearInterval(id);
  }, []);

  // Drives the live timer on the selected-user detail card.
  useEffect(() => {
    const id = setInterval(() => setTickNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  async function loadEntriesFor(userId: string) {
    try {
      const r = await api.get<{ entries: TimeEntry[] }>(`/api/time-entries?userId=${userId}`);
      setEntries(r.entries);
    } catch (e: any) { err(e?.message || "Failed to load entries"); }
  }
  useEffect(() => {
    if (selectedId) {
      loadEntriesFor(selectedId);
      setTab("overview");
      setTsRange("all");
    }
  }, [selectedId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      u.email.toLowerCase().includes(q) ||
      (u.name || "").toLowerCase().includes(q)
    );
  }, [users, query]);

  const selected = useMemo(
    () => users.find((u) => u.id === selectedId) || null,
    [users, selectedId]
  );

  const selectedTasks = useMemo(
    () => tasks.filter((t) => t.assigneeId === selectedId),
    [tasks, selectedId]
  );

  async function resetPassword() {
    if (!selected) return;
    if (!confirm(`Send a password-reset link to ${selected.email}? Their current password will stop working immediately.`)) return;
    setBusy(true);
    try {
      await api.patch(`/api/users/${selected.id}`, { resetPassword: true });
      ok(`Reset link sent to ${selected.email}.`);
      await loadAll();
    } catch (e: any) { err(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  async function forceSignOut() {
    if (!selected) return;
    if (!confirm(`Force ${selected.email} to sign out of all their sessions?`)) return;
    setBusy(true);
    try {
      const r = await api.patch<{ user: User }>(`/api/users/${selected.id}`, { forceSignOut: true });
      setUsers((ls) => ls.map((x) => (x.id === r.user.id ? r.user : x)));
      ok("All sessions revoked.");
    } catch (e: any) { err(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  async function toggleRole() {
    if (!selected) return;
    const role: Role = selected.role === "ADMIN" ? "EMPLOYEE" : "ADMIN";
    if (!confirm(`Change ${selected.email} to ${role}?`)) return;
    setBusy(true);
    try {
      const r = await api.patch<{ user: User }>(`/api/users/${selected.id}`, { role });
      setUsers((ls) => ls.map((x) => (x.id === r.user.id ? r.user : x)));
      ok(`Now ${role}.`);
    } catch (e: any) { err(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  async function toggleActive() {
    if (!selected) return;
    const next = !selected.active;
    if (!confirm(`${next ? "Re-activate login for" : "Block login for"} ${selected.email}?`)) return;
    setBusy(true);
    try {
      const r = await api.patch<{ user: User }>(`/api/users/${selected.id}`, { active: next });
      setUsers((ls) => ls.map((x) => (x.id === r.user.id ? r.user : x)));
      ok(next ? "Login enabled." : "Login disabled.");
    } catch (e: any) { err(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  async function softDelete() {
    if (!selected) return;
    if (!confirm(`Deactivate ${selected.email}? They keep all history but lose login access. (Reversible.)`)) return;
    setBusy(true);
    try {
      const r = await api.del<{ user: User }>(`/api/users/${selected.id}`);
      setUsers((ls) => ls.map((x) => (x.id === r.user.id ? r.user : x)));
      ok("User deactivated.");
    } catch (e: any) { err(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  async function hardDelete() {
    if (!selected) return;
    const confirm1 = confirm(
      `PERMANENTLY DELETE ${selected.email}?\n\n` +
      `This removes:\n• their user record\n• their time entries\n\n` +
      `This cannot be undone. Tasks they own/are assigned to are left in place — reassign or delete them first.`
    );
    if (!confirm1) return;
    const typed = prompt(`Type the user's email to confirm: ${selected.email}`);
    if (typed?.trim().toLowerCase() !== selected.email.toLowerCase()) {
      err("Email didn't match. Cancelled.");
      return;
    }
    setBusy(true);
    try {
      await api.del(`/api/users/${selected.id}?hard=1`);
      setUsers((ls) => ls.filter((x) => x.id !== selected.id));
      setEntries([]);
      const remaining = users.filter((x) => x.id !== selected.id);
      setSelectedId(remaining.length > 0 ? remaining[0].id : null);
      ok("User permanently deleted.");
    } catch (e: any) { err(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  const totalMinutesThisUser = useMemo(
    () => entries.reduce((s, e) => s + (e.durationMinutes || 0), 0),
    [entries]
  );

  // Tasks this user created (admin tasks they own).
  const tasksCreated = useMemo(
    () => tasks.filter((t) => t.createdBy === selectedId),
    [tasks, selectedId]
  );

  // Time-period buckets for stat cards.
  const minutesThisWeek = useMemo(() => sumMinutesSince(entries, startOfWeek(new Date())), [entries]);
  const minutesThisMonth = useMemo(() => sumMinutesSince(entries, startOfMonth(new Date())), [entries]);
  const minutesThisYear = useMemo(() => sumMinutesSince(entries, startOfYear(new Date())), [entries]);
  const uniqueWorkDays = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) set.add(e.startedAt.slice(0, 10));
    return set.size;
  }, [entries]);

  // Entries filtered by the chosen Time Sheet range.
  const filteredEntries = useMemo(() => {
    if (tsRange === "all") return entries;
    const now = new Date();
    const cutoff =
      tsRange === "week"  ? startOfWeek(now)  :
      tsRange === "month" ? startOfMonth(now) :
                            startOfYear(now);
    return entries.filter((e) => new Date(e.startedAt) >= cutoff);
  }, [entries, tsRange]);

  // Per-day grouping for the Time Sheet tab.
  const entriesByDay = useMemo(() => {
    const grouped = new Map<string, TimeEntry[]>();
    for (const e of filteredEntries) {
      const d = e.startedAt.slice(0, 10);
      const arr = grouped.get(d) || [];
      arr.push(e);
      grouped.set(d, arr);
    }
    return Array.from(grouped.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, items]) => ({
        day,
        items: items.sort((a, b) => (a.startedAt > b.startedAt ? -1 : 1)),
        total: items.reduce((s, e) => s + (e.durationMinutes || 0), 0),
      }));
  }, [filteredEntries]);

  // Combined activity timeline for the Overview tab.
  const activity = useMemo(() => buildActivity(selectedId, entries, selectedTasks, tasksCreated, users), [selectedId, entries, selectedTasks, tasksCreated, users]);

  const isSelf = selected?.id === me?.id;
  const isLastAdmin =
    selected?.role === "ADMIN" &&
    users.filter((u) => u.role === "ADMIN" && u.active && u.id !== selected.id).length === 0;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Shield size={18} className="text-brand-600" />
          <h1 className="font-display text-3xl tracking-tight">Manage</h1>
        </div>
        <p className="text-sm text-gray-500">
          Full administrative control over team members — passwords, sessions, roles, access, deletion.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
        {/* ── Left: user search + list ────────────────────── */}
        <aside className="ko-card overflow-hidden self-start">
          <div className="p-3 border-b border-gray-200">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                placeholder="Search by name or email…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="ko-input h-9 pl-9 text-sm"
              />
            </div>
          </div>
          <div className="max-h-[640px] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-6 text-sm text-gray-500 text-center">No users match.</div>
            ) : (
              filtered.map((u) => {
                const isClockedIn = Boolean(openEntries[u.id]);
                return (
                  <button
                    key={u.id}
                    onClick={() => setSelectedId(u.id)}
                    className={
                      "w-full text-left px-3 py-2.5 border-b border-gray-100 last:border-b-0 transition " +
                      (u.id === selectedId ? "bg-brand-50" : "hover:bg-gray-50")
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {isClockedIn && (
                            <span className="inline-flex items-center" title="Currently clocked in">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            </span>
                          )}
                          <span className="text-sm font-medium text-gray-900 truncate">
                            {u.name || u.email}
                          </span>
                          {u.id === me?.id && (
                            <span className="text-[9px] uppercase tracking-[0.16em] text-brand-800">you</span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-500 truncate">
                          {isClockedIn
                            ? <span className="text-emerald-700">Clocked in · {elapsed(openEntries[u.id]!.startedAt, tickNow)}</span>
                            : u.email}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className={u.role === "ADMIN" ? "ko-pill-admin" : "ko-pill-employee"} style={{ fontSize: 9, padding: "2px 6px" }}>{u.role}</span>
                        {!u.active && <span className="text-[9px] uppercase tracking-[0.14em] text-gray-400">inactive</span>}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ── Right: selected-user detail ─────────────────── */}
        <section className="space-y-5">
          {!selected ? (
            <div className="ko-card p-12 text-sm text-gray-500 text-center">
              Select a user from the list to manage them.
            </div>
          ) : (
            <>
              {/* User header card */}
              <div className="ko-card p-5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-200 to-brand-400 flex items-center justify-center text-black font-display font-semibold text-lg">
                      {(selected.name || selected.email)[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="font-display text-xl text-gray-900 truncate">{selected.name || "—"}</h2>
                        <span className={selected.role === "ADMIN" ? "ko-pill-admin" : "ko-pill-employee"}>{selected.role}</span>
                        {!selected.active && (
                          <span className="text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                            Login disabled
                          </span>
                        )}
                        {isSelf && (
                          <span className="text-[10px] uppercase tracking-[0.14em] text-brand-800">You</span>
                        )}
                      </div>
                      <div className="text-sm text-gray-600 mt-0.5 flex items-center gap-1.5">
                        <Mail size={12} className="text-gray-400" /> {selected.email}
                      </div>
                      <div className="text-[12px] text-gray-500 mt-0.5 flex items-center gap-1.5">
                        <Calendar size={11} className="text-gray-400" /> Joined {fmtDate(selected.createdAt)}
                        {selected.passwordSetAt && <> · Password set {fmtDate(selected.passwordSetAt)}</>}
                        {selected.sessionsRevokedAt && <> · Sessions revoked {fmtDate(selected.sessionsRevokedAt)}</>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Quick actions */}
                <div className="mt-5 pt-5 border-t border-gray-200">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-gray-500 mb-3">Quick actions</div>
                  <div className="flex flex-wrap gap-2">
                    <Action onClick={resetPassword} disabled={busy} icon={<KeyRound size={13} />} label="Reset password" hint="Email a 24-hour reset link" />
                    <Action onClick={forceSignOut} disabled={busy} icon={<LogOut size={13} />} label="Force sign out" hint="Revoke all active sessions" />
                    {!isSelf && (
                      <Action onClick={toggleRole} disabled={busy || (isLastAdmin && selected.role === "ADMIN")}
                        icon={<UserCog size={13} />}
                        label={selected.role === "ADMIN" ? "Demote to Employee" : "Promote to Admin"}
                        hint={isLastAdmin && selected.role === "ADMIN" ? "Last admin — can't demote" : undefined} />
                    )}
                    {!isSelf && (
                      <Action onClick={toggleActive} disabled={busy}
                        icon={selected.active ? <UserX size={13} /> : <UserCheck size={13} />}
                        label={selected.active ? "Disable login" : "Enable login"}
                        hint={selected.active ? "Block them from signing in" : "Restore login access"}
                        tone={selected.active ? "danger" : undefined} />
                    )}
                    {!isSelf && (
                      <Action onClick={softDelete} disabled={busy || !selected.active}
                        icon={<UserX size={13} />}
                        label="Soft delete"
                        hint="Deactivate, keep history"
                        tone="danger" />
                    )}
                    {!isSelf && (
                      <Action onClick={hardDelete} disabled={busy}
                        icon={<Trash2 size={13} />}
                        label="Permanently delete"
                        hint="Remove user + time entries"
                        tone="danger" />
                    )}
                  </div>
                  {isLastAdmin && selected.role === "ADMIN" && (
                    <div className="mt-3 text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 inline-flex items-center gap-1.5">
                      <AlertTriangle size={12} /> This is the last active admin. Demote / delete is blocked to prevent lockout.
                    </div>
                  )}
                </div>
              </div>

              {/* Currently clocked in — only shown when this user has an open entry */}
              {selected && openEntries[selected.id] && (
                <div className="ko-card p-4 border-emerald-300 bg-emerald-50/40">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center">
                        <Play size={14} className="text-emerald-700" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-800 font-semibold inline-flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Currently clocked in
                        </div>
                        <div className="text-sm text-gray-800 mt-0.5">
                          Started {fmtDateTime(openEntries[selected.id].startedAt)}
                          {openEntries[selected.id].description ? ` · ${openEntries[selected.id].description}` : ""}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-emerald-800">Elapsed</div>
                      <div className="font-mono text-2xl font-semibold tabular-nums text-emerald-700">
                        {elapsed(openEntries[selected.id].startedAt, tickNow)}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab bar */}
              <div className="ko-card p-1 inline-flex gap-0.5 self-start">
                <TabBtn active={tab === "overview"}  onClick={() => setTab("overview")}  icon={<Activity size={13} />} label="Overview" />
                <TabBtn active={tab === "timesheet"} onClick={() => setTab("timesheet")} icon={<Clock size={13} />}    label="Time Sheet" />
                <TabBtn active={tab === "tasks"}     onClick={() => setTab("tasks")}     icon={<ListChecks size={13} />} label={`Tasks (${selectedTasks.length + tasksCreated.length})`} />
                <TabBtn active={tab === "account"}   onClick={() => setTab("account")}   icon={<ShieldCheck size={13} />} label="Account" />
              </div>

              {tab === "overview" && (
                <>
                  {/* Summary stat cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Stat label="This week"      value={fmtMinutes(minutesThisWeek)} />
                    <Stat label="This month"     value={fmtMinutes(minutesThisMonth)} />
                    <Stat label="All time"       value={fmtMinutes(totalMinutesThisUser)} />
                    <Stat label="Days worked"    value={uniqueWorkDays} />
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Stat label="Open tasks"        value={selectedTasks.filter((t) => t.status !== "DONE").length} />
                    <Stat label="Done tasks"        value={selectedTasks.filter((t) => t.status === "DONE").length} />
                    <Stat label="Created by user"   value={tasksCreated.length} />
                    <Stat label="Time entries"      value={entries.length} />
                  </div>

                  {/* Activity timeline */}
                  <div className="ko-card overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <History size={14} className="text-gray-500" />
                        <h3 className="text-sm font-semibold text-gray-900">Activity timeline</h3>
                      </div>
                      <span className="text-[11px] text-gray-500">{activity.length} event{activity.length === 1 ? "" : "s"}</span>
                    </div>
                    {activity.length === 0 ? (
                      <div className="px-4 py-8 text-sm text-gray-500 text-center">
                        No activity yet for this user.
                      </div>
                    ) : (
                      <ul className="divide-y divide-gray-100">
                        {activity.slice(0, 20).map((a) => (
                          <li key={a.id} className="px-4 py-3 flex items-start gap-3">
                            <div className={"flex-shrink-0 w-7 h-7 rounded-full inline-flex items-center justify-center " + activityIconBg(a.kind)}>
                              {activityIcon(a.kind)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm text-gray-900">{a.title}</div>
                              {a.body && <div className="text-[12px] text-gray-500 mt-0.5">{a.body}</div>}
                              <div className="text-[10px] uppercase tracking-[0.14em] text-gray-400 mt-1">
                                {fmtDateTime(a.at)} · {timeAgo(a.at, tickNow)}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}

              {tab === "timesheet" && (
                <>
                  <div className="ko-card p-3 flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-gray-500 mr-2">Range</span>
                    {(["all", "week", "month", "year"] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setTsRange(r)}
                        className={
                          "h-8 px-3 rounded-md text-[12px] font-medium transition border " +
                          (tsRange === r
                            ? "bg-brand-50 border-brand-300 text-brand-800"
                            : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")
                        }
                      >
                        {r === "all" ? "All time" : r === "week" ? "This week" : r === "month" ? "This month" : "This year"}
                      </button>
                    ))}
                    <div className="ml-auto text-right">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500">Total</div>
                      <div className="font-display text-lg text-gray-900 leading-tight">
                        {fmtMinutes(filteredEntries.reduce((s, e) => s + (e.durationMinutes || 0), 0))}
                      </div>
                    </div>
                  </div>

                  {entriesByDay.length === 0 ? (
                    <div className="ko-card p-8 text-sm text-gray-500 text-center">No entries in this range.</div>
                  ) : (
                    entriesByDay.map((group) => (
                      <div key={group.day} className="ko-card overflow-hidden">
                        <div className="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between bg-gray-50/50">
                          <div className="flex items-center gap-2">
                            <CalendarDays size={13} className="text-gray-500" />
                            <span className="text-sm font-semibold text-gray-900">{fmtDate(group.day + "T00:00:00")}</span>
                            <span className="text-[11px] text-gray-500">· {group.items.length} entr{group.items.length === 1 ? "y" : "ies"}</span>
                          </div>
                          <span className="font-mono text-sm font-semibold text-brand-700">{fmtMinutes(group.total)}</span>
                        </div>
                        <table className="ko-table">
                          <thead>
                            <tr>
                              <th>Clock in</th>
                              <th>Clock out</th>
                              <th>Duration</th>
                              <th>Description</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.items.map((e) => (
                              <tr key={e.id}>
                                <td className="font-mono">{new Date(e.startedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</td>
                                <td className="font-mono">{e.endedAt
                                  ? new Date(e.endedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
                                  : <span className="text-brand-700">in progress</span>}
                                </td>
                                <td className="font-mono">{e.endedAt ? fmtMinutes(e.durationMinutes) : "—"}</td>
                                <td className="text-gray-600">{e.description || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))
                  )}
                </>
              )}

              {tab === "tasks" && (
                <>
                  {/* Status breakdown */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Stat label="To do"        value={selectedTasks.filter((t) => t.status === "TODO").length} />
                    <Stat label="In progress"  value={selectedTasks.filter((t) => t.status === "IN_PROGRESS").length} />
                    <Stat label="Blocked"      value={selectedTasks.filter((t) => t.status === "BLOCKED").length} />
                    <Stat label="Done"         value={selectedTasks.filter((t) => t.status === "DONE").length} />
                  </div>

                  <TasksTable
                    title={`Assigned to ${selected.name || selected.email} (${selectedTasks.length})`}
                    tasks={selectedTasks}
                  />

                  <TasksTable
                    title={`Created by ${selected.name || selected.email} (${tasksCreated.length})`}
                    tasks={tasksCreated}
                    users={users}
                    showAssignee
                  />
                </>
              )}

              {tab === "account" && (
                <>
                  <div className="ko-card overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
                      <ShieldCheck size={14} className="text-gray-500" />
                      <h3 className="text-sm font-semibold text-gray-900">Account details</h3>
                    </div>
                    <dl className="divide-y divide-gray-100">
                      <AccountRow label="User ID" value={<span className="font-mono text-[12px] text-gray-600 break-all">{selected.id}</span>} />
                      <AccountRow label="Email" value={selected.email} />
                      <AccountRow label="Display name" value={selected.name || <span className="text-gray-400">—</span>} />
                      <AccountRow label="Role" value={<span className={selected.role === "ADMIN" ? "ko-pill-admin" : "ko-pill-employee"}>{selected.role}</span>} />
                      <AccountRow label="Status" value={selected.active
                        ? <span className="text-emerald-700">Active</span>
                        : <span className="text-gray-500">Login disabled</span>} />
                      <AccountRow label="Account created" value={fmtDateTime(selected.createdAt)} />
                      <AccountRow label="Password set" value={selected.passwordSetAt ? fmtDateTime(selected.passwordSetAt) : <span className="text-gray-400">Not set</span>} />
                      <AccountRow label="Sessions revoked" value={selected.sessionsRevokedAt ? fmtDateTime(selected.sessionsRevokedAt) : <span className="text-gray-400">Never</span>} />
                      <AccountRow label="Invited by" value={
                        selected.invitedBy
                          ? (users.find((u) => u.id === selected.invitedBy)?.email || <span className="text-gray-400">unknown</span>)
                          : <span className="text-gray-400">Self-signup</span>
                      } />
                    </dl>
                  </div>

                  {/* Account audit log — derived from known timestamps */}
                  <div className="ko-card overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
                      <History size={14} className="text-gray-500" />
                      <h3 className="text-sm font-semibold text-gray-900">Account audit log</h3>
                    </div>
                    <ul className="divide-y divide-gray-100">
                      <AuditRow icon={<ShieldCheck size={12} />} when={selected.createdAt} text="Account created" />
                      {selected.passwordSetAt && (
                        <AuditRow icon={<KeyRound size={12} />} when={selected.passwordSetAt} text="Password set" />
                      )}
                      {selected.sessionsRevokedAt && (
                        <AuditRow icon={<LogOut size={12} />} when={selected.sessionsRevokedAt} text="All sessions revoked by admin" />
                      )}
                      {!selected.active && (
                        <AuditRow icon={<UserX size={12} />} when={selected.createdAt /* best-effort, not tracked */} text="Account currently disabled" />
                      )}
                    </ul>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Action({ onClick, disabled, icon, label, hint, tone }: {
  onClick: () => void; disabled?: boolean; icon: React.ReactNode; label: string; hint?: string;
  tone?: "danger";
}) {
  const cls = tone === "danger"
    ? "ko-btn-ghost h-9 px-3 text-xs gap-1.5 hover:!border-red-300 hover:!text-red-700 hover:!bg-red-50"
    : "ko-btn-ghost h-9 px-3 text-xs gap-1.5";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={cls + " inline-flex items-center disabled:opacity-40 disabled:pointer-events-none"}
    >
      {icon} {label}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="ko-card p-4">
      <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500">{label}</div>
      <div className="font-display text-xl text-gray-900 mt-1">{value}</div>
    </div>
  );
}

/** HH:MM:SS since startedAt up to nowMs. Recomputed every second. */
function elapsed(startedAtIso: string, nowMs: number): string {
  const start = new Date(startedAtIso).getTime();
  const total = Math.max(0, Math.floor((nowMs - start) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/* ── Tab bar ───────────────────────────────────────────────── */

function TabBtn(props: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={
        "inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-[12px] font-medium transition " +
        (props.active
          ? "bg-brand-50 text-brand-800 border border-brand-200"
          : "text-gray-600 hover:text-gray-900 hover:bg-gray-50 border border-transparent")
      }
    >
      {props.icon} {props.label}
    </button>
  );
}

/* ── Tasks table (used in Tasks tab) ───────────────────────── */

function TasksTable(props: {
  title: string;
  tasks: Task[];
  users?: User[];
  showAssignee?: boolean;
}) {
  return (
    <div className="ko-card overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListChecks size={14} className="text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-900">{props.title}</h3>
        </div>
        <Link href="/tasks" className="text-[12px] text-brand-700 hover:underline">Manage tasks →</Link>
      </div>
      {props.tasks.length === 0 ? (
        <div className="px-4 py-6 text-sm text-gray-500 text-center">Nothing here.</div>
      ) : (
        <table className="ko-table">
          <thead>
            <tr>
              <th>Title</th>
              {props.showAssignee && <th>Assignee</th>}
              <th>Status</th>
              <th>Priority</th>
              <th>Due</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {props.tasks.map((t) => (
              <tr key={t.id}>
                <td className="font-medium">{t.title}</td>
                {props.showAssignee && (
                  <td>{
                    props.users?.find((u) => u.id === t.assigneeId)?.name ||
                    props.users?.find((u) => u.id === t.assigneeId)?.email ||
                    <span className="text-gray-400">—</span>
                  }</td>
                )}
                <td>{t.status.replace("_", " ")}</td>
                <td>{t.priority}</td>
                <td className="text-gray-500">{t.dueDate ? fmtDate(t.dueDate) : "—"}</td>
                <td className="text-gray-500">{fmtDate(t.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ── Account tab atoms ─────────────────────────────────────── */

function AccountRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-4 py-2.5 flex items-center gap-4">
      <dt className="text-[11px] uppercase tracking-[0.14em] text-gray-500 w-40 flex-shrink-0">{label}</dt>
      <dd className="text-sm text-gray-900 min-w-0">{value}</dd>
    </div>
  );
}

function AuditRow({ icon, when, text }: { icon: React.ReactNode; when: string; text: string }) {
  return (
    <li className="px-4 py-3 flex items-start gap-3">
      <div className="w-7 h-7 rounded-full bg-gray-100 inline-flex items-center justify-center text-gray-600 flex-shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-sm text-gray-900">{text}</div>
        <div className="text-[11px] text-gray-500 mt-0.5">{fmtDateTime(when)}</div>
      </div>
    </li>
  );
}

/* ── Activity timeline construction ────────────────────────── */

type ActivityKind =
  | "clock-in"
  | "clock-out"
  | "task-assigned"
  | "task-created";

interface ActivityEvent {
  id: string;
  at: string;
  kind: ActivityKind;
  title: string;
  body?: string;
}

function buildActivity(
  userId: string | null,
  entries: TimeEntry[],
  tasksAssigned: Task[],
  tasksCreated: Task[],
  users: User[],
): ActivityEvent[] {
  if (!userId) return [];
  const out: ActivityEvent[] = [];

  for (const e of entries) {
    out.push({
      id: `${e.id}:in`,
      at: e.startedAt,
      kind: "clock-in",
      title: e.endedAt ? "Clocked in" : "Clocked in (in progress)",
      body: e.description || undefined,
    });
    if (e.endedAt) {
      out.push({
        id: `${e.id}:out`,
        at: e.endedAt,
        kind: "clock-out",
        title: `Clocked out · ${minutesShort(e.durationMinutes)}`,
        body: e.description || undefined,
      });
    }
  }

  for (const t of tasksAssigned) {
    const assigner = users.find((u) => u.id === t.createdBy);
    out.push({
      id: `${t.id}:assigned`,
      at: t.createdAt,
      kind: "task-assigned",
      title: `Assigned task: ${t.title}`,
      body: assigner ? `By ${assigner.name || assigner.email}` : undefined,
    });
  }

  for (const t of tasksCreated) {
    out.push({
      id: `${t.id}:created`,
      at: t.createdAt,
      kind: "task-created",
      title: `Created task: ${t.title}`,
      body: t.assigneeId
        ? `Assigned to ${users.find((u) => u.id === t.assigneeId)?.email || "someone"}`
        : "Unassigned",
    });
  }

  return out.sort((a, b) => (a.at > b.at ? -1 : 1));
}

function activityIconBg(kind: ActivityKind): string {
  if (kind === "clock-in")    return "bg-emerald-100 text-emerald-700";
  if (kind === "clock-out")   return "bg-blue-100 text-blue-700";
  if (kind === "task-assigned") return "bg-brand-50 text-brand-700";
  return "bg-gray-100 text-gray-600";
}

function activityIcon(kind: ActivityKind): React.ReactNode {
  if (kind === "clock-in")    return <ArrowUpRight size={13} />;
  if (kind === "clock-out")   return <ArrowDownRight size={13} />;
  if (kind === "task-assigned") return <CircleDot size={13} />;
  return <CheckCircle2 size={13} />;
}

/* ── Date math ─────────────────────────────────────────────── */

function startOfWeek(d: Date): Date {
  // Monday-start; consistent with how most teams plan a work week.
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
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

function sumMinutesSince(entries: TimeEntry[], cutoff: Date): number {
  let total = 0;
  for (const e of entries) {
    if (new Date(e.startedAt) >= cutoff) total += e.durationMinutes || 0;
  }
  return total;
}

/* ── Tiny helpers ──────────────────────────────────────────── */

function minutesShort(m: number): string {
  if (!m || m < 0) return "0m";
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h <= 0) return `${mm}m`;
  if (mm <= 0) return `${h}h`;
  return `${h}h ${mm}m`;
}

function timeAgo(iso: string, nowMs: number): string {
  const ms = nowMs - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "just now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
