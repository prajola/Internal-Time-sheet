import { useEffect, useMemo, useState } from "react";
import {
  Search, KeyRound, LogOut, UserCog, UserX, UserCheck, Trash2,
  Shield, Calendar, ListChecks, Clock, AlertTriangle, Mail, Play,
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
  useEffect(() => { if (selectedId) loadEntriesFor(selectedId); }, [selectedId]);

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

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Open tasks" value={selectedTasks.filter((t) => t.status !== "DONE").length} />
                <Stat label="Tracked time (all)" value={fmtMinutes(totalMinutesThisUser)} />
                <Stat label="Total entries" value={entries.length} />
              </div>

              {/* Tasks section */}
              <div className="ko-card overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ListChecks size={14} className="text-gray-500" />
                    <h3 className="text-sm font-semibold text-gray-900">Tasks assigned ({selectedTasks.length})</h3>
                  </div>
                  <Link href="/tasks" className="text-[12px] text-brand-700 hover:underline">Manage tasks →</Link>
                </div>
                {selectedTasks.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-gray-500 text-center">No tasks assigned to this user.</div>
                ) : (
                  <table className="ko-table">
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>Status</th>
                        <th>Priority</th>
                        <th>Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedTasks.map((t) => (
                        <tr key={t.id}>
                          <td className="font-medium">{t.title}</td>
                          <td>{t.status.replace("_", " ")}</td>
                          <td>{t.priority}</td>
                          <td className="text-gray-500">{t.dueDate ? fmtDate(t.dueDate) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Timesheet preview */}
              <div className="ko-card overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="text-gray-500" />
                    <h3 className="text-sm font-semibold text-gray-900">Recent timesheet ({entries.length})</h3>
                  </div>
                  <Link href="/timesheets" className="text-[12px] text-brand-700 hover:underline">Full timesheet →</Link>
                </div>
                {entries.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-gray-500 text-center">No time entries logged yet.</div>
                ) : (
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
                      {entries.slice(0, 8).map((e) => (
                        <tr key={e.id}>
                          <td>{fmtDateTime(e.startedAt)}</td>
                          <td>{e.endedAt ? fmtDateTime(e.endedAt) : <span className="text-brand-700">in progress</span>}</td>
                          <td className="font-mono">{e.endedAt ? fmtMinutes(e.durationMinutes) : "—"}</td>
                          <td className="text-gray-600">{e.description || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
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
