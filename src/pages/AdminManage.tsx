import { useEffect, useMemo, useState } from "react";
import {
  Search, KeyRound, LogOut, UserCog, UserX, UserCheck, Trash2,
  Shield, ListChecks, Clock, AlertTriangle, Mail, Play,
  Activity, History, ShieldCheck, CalendarDays,
  ArrowUpRight, ArrowDownRight, CheckCircle2, CircleDot,
  Download, Printer, Lock, MailQuestion,
} from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { SetPasswordDialog } from "../components/SetPasswordDialog";
import { downloadCsv as csvDownload, dateStampedName } from "../lib/csv";
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
  const [showSetPassword, setShowSetPassword] = useState(false);

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

  function openSetPassword() {
    if (!selected) return;
    setShowSetPassword(true);
  }

  async function emailResetLink() {
    if (!selected) return;
    if (!confirm(`Email a password-reset link to ${selected.email}? Their current password will stop working immediately.`)) return;
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

  function downloadCsv() {
    if (!selected) return;
    try {
      const myTasks = tasks.filter((t) => t.assigneeId === selected.id);
      const myCreated = tasks.filter((t) => t.createdBy === selected.id);
      const csv = buildUserCsv(selected, entries, myTasks, myCreated, users);
      // buildUserCsv returns a CSV string with multiple sections (identity,
      // entries, tasks). It's not a flat rowsToCsv input, so handle it
      // here directly. Same BOM + deferred-cleanup pattern.
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safeName = (selected.name || selected.email).replace(/[^A-Za-z0-9_-]+/g, "_");
      a.href = url;
      a.download = `kubegraf-${safeName}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
      ok("CSV downloaded.");
    } catch (e: any) {
      err(e?.message || "Could not download CSV");
    }
  }

  /** Workspace-wide users CSV — one row per user. */
  function exportWorkspaceCsv() {
    if (users.length === 0) { err("No users to export"); return; }
    const rows: Array<Array<unknown>> = [
      ["ID", "Name", "Email", "Role", "Active", "Joined", "Password set", "Sessions revoked", "Invited by"],
      ...users.map((u) => [
        u.id,
        u.name || "",
        u.email,
        u.role,
        u.active ? "yes" : "no",
        u.createdAt,
        u.passwordSetAt || "",
        u.sessionsRevokedAt || "",
        u.invitedBy || "",
      ]),
    ];
    csvDownload(dateStampedName("kubegraf-users"), rows);
    ok("Users CSV downloaded.");
  }

  /**
   * Print/save-PDF via a hidden iframe — doesn't open a new window, so
   * pop-up blockers don't interfere. The browser's print dialog appears
   * over the current page; "Save as PDF" works the same as before.
   */
  function printReport() {
    if (!selected) return;
    try {
      const myTasks = tasks.filter((t) => t.assigneeId === selected.id);
      const myCreated = tasks.filter((t) => t.createdBy === selected.id);
      const html = buildUserReportHtml(selected, entries, myTasks, myCreated, users);

      // Drop any existing print iframe (previous click may have left one).
      const existing = document.getElementById("ko-print-frame") as HTMLIFrameElement | null;
      if (existing) existing.remove();

      const iframe = document.createElement("iframe");
      iframe.id = "ko-print-frame";
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.style.opacity = "0";
      iframe.setAttribute("aria-hidden", "true");
      document.body.appendChild(iframe);

      // Write content. Using srcdoc keeps the iframe same-origin which is
      // what window.contentWindow.print() needs.
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) { err("Browser blocked the print frame"); iframe.remove(); return; }
      doc.open();
      doc.write(html);
      doc.close();

      const trigger = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch (e) {
          err("Could not open the print dialog");
        }
        // Leave the iframe in place briefly so the browser's print dialog
        // can finish — then remove on next tick.
        setTimeout(() => iframe.remove(), 60_000);
      };

      // Wait for content to actually load before printing — images and
      // styles otherwise won't be ready.
      if (iframe.contentDocument?.readyState === "complete") {
        setTimeout(trigger, 100);
      } else {
        iframe.onload = () => setTimeout(trigger, 100);
        // Safety fallback in case onload doesn't fire (rare with data URIs).
        setTimeout(trigger, 1200);
      }
    } catch (e: any) {
      err(e?.message || "Could not open the print dialog");
    }
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
    <div>
      <PageHeader
        icon={<Shield size={18} />}
        eyebrow="Administration"
        title="Manage"
        description="Full administrative control over team members — passwords, sessions, roles, access, deletion."
        actions={
          <button
            onClick={exportWorkspaceCsv}
            disabled={users.length === 0}
            className="ko-btn-ghost h-10 px-4 text-sm inline-flex items-center gap-1.5"
            title="One row per user with their key fields"
          >
            <Download size={14} /> Export users CSV
          </button>
        }
      />

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
                        <CalendarDays size={11} className="text-gray-400" /> Joined {fmtDate(selected.createdAt)}
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
                    <Action onClick={downloadCsv} disabled={busy} icon={<Download size={13} />} label="Download CSV" hint="Time entries + tasks for this user" />
                    <Action onClick={printReport}  disabled={busy} icon={<Printer size={13} />} label="Print / Save PDF" hint="Print-friendly report — save as PDF from the browser" />
                    <Action onClick={openSetPassword} disabled={busy} icon={<Lock size={13} />} label="Set password" hint="Choose a new password here — applied immediately, no email" />
                    <Action onClick={emailResetLink}  disabled={busy} icon={<MailQuestion size={13} />} label="Email reset link" hint="Send the user a 24-hour reset link instead" />
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

                  {/* Activity timeline — grouped by day with daily totals */}
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
                      <ul>
                        {groupActivityByDay(activity, entries).slice(0, 7).map((day) => (
                          <li key={day.day} className="border-b border-gray-100 last:border-b-0">
                            {/* Day header with total time worked */}
                            <div className="px-4 py-2.5 bg-gray-50/60 flex items-center justify-between gap-3 border-b border-gray-100">
                              <div className="flex items-center gap-2">
                                <CalendarDays size={13} className="text-gray-500" />
                                <span className="text-sm font-semibold text-gray-900">{fmtDate(day.day + "T00:00:00")}</span>
                                <span className="text-[11px] text-gray-500">· {day.events.length} event{day.events.length === 1 ? "" : "s"}</span>
                              </div>
                              <div className="text-right">
                                <span className="text-[10px] uppercase tracking-[0.14em] text-gray-500 mr-1.5">Logged</span>
                                <span className="font-mono text-sm font-semibold text-brand-700">{fmtMinutes(day.totalMinutes)}</span>
                              </div>
                            </div>
                            {/* Events under that day */}
                            <ul className="divide-y divide-gray-100">
                              {day.events.map((a) => (
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

      {showSetPassword && selected && (
        <SetPasswordDialog
          user={selected}
          onClose={() => setShowSetPassword(false)}
          onSaved={() => { setShowSetPassword(false); loadAll(); }}
          onSuccessToast={ok}
          onErrorToast={err}
        />
      )}
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

interface DayGroup {
  day: string;            // YYYY-MM-DD
  events: ActivityEvent[];
  totalMinutes: number;   // sum of durations for entries whose startedAt is that day
}

/**
 * Group activity events by calendar day and compute "minutes logged that day"
 * from the time entries (only entries with a closed endedAt count toward the
 * total — in-progress entries are excluded so the figure stays stable).
 */
function groupActivityByDay(events: ActivityEvent[], entries: TimeEntry[]): DayGroup[] {
  const groupedEvents = new Map<string, ActivityEvent[]>();
  for (const ev of events) {
    const day = ev.at.slice(0, 10);
    const arr = groupedEvents.get(day) || [];
    arr.push(ev);
    groupedEvents.set(day, arr);
  }

  const minutesByDay = new Map<string, number>();
  for (const e of entries) {
    if (!e.endedAt) continue;
    const day = e.startedAt.slice(0, 10);
    minutesByDay.set(day, (minutesByDay.get(day) || 0) + (e.durationMinutes || 0));
  }

  const days = Array.from(groupedEvents.keys()).sort((a, b) => (a < b ? 1 : -1));
  return days.map((d) => ({
    day: d,
    events: groupedEvents.get(d)!.sort((a, b) => (a.at > b.at ? -1 : 1)),
    totalMinutes: minutesByDay.get(d) || 0,
  }));
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

/* ── Report exports ─────────────────────────────────────────── */

function escapeCsv(s: string | number | undefined | null): string {
  const v = s == null ? "" : String(s);
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function buildUserCsv(
  user: User,
  entries: TimeEntry[],
  tasksAssigned: Task[],
  tasksCreated: Task[],
  users: User[],
): string {
  const lines: string[][] = [];

  // ── Header block ──
  lines.push(["KubeGraf — Internal Time Sheet"]);
  lines.push(["User report"]);
  lines.push([`Generated ${new Date().toISOString()}`]);
  lines.push([]);

  // ── Identity ──
  lines.push(["IDENTITY"]);
  lines.push(["Name", user.name || ""]);
  lines.push(["Email", user.email]);
  lines.push(["Role", user.role]);
  lines.push(["Status", user.active ? "Active" : "Inactive"]);
  lines.push(["Joined", user.createdAt]);
  if (user.passwordSetAt) lines.push(["Password set", user.passwordSetAt]);
  lines.push([]);

  // ── Time entries ──
  const closed = entries.filter((e) => e.endedAt);
  const totalMin = closed.reduce((s, e) => s + (e.durationMinutes || 0), 0);
  lines.push([`TIME ENTRIES (${entries.length} total, ${minutesShort(totalMin)} logged)`]);
  lines.push(["Started", "Ended", "Duration (min)", "Task", "Description"]);
  const sorted = [...entries].sort((a, b) => (a.startedAt > b.startedAt ? -1 : 1));
  for (const e of sorted) {
    const task = tasksAssigned.find((t) => t.id === e.taskId)?.title || "";
    lines.push([
      e.startedAt,
      e.endedAt || "(in progress)",
      e.endedAt ? String(e.durationMinutes) : "",
      task,
      e.description || "",
    ]);
  }
  lines.push([]);

  // ── Daily totals ──
  const byDay = new Map<string, number>();
  for (const e of closed) {
    const d = e.startedAt.slice(0, 10);
    byDay.set(d, (byDay.get(d) || 0) + (e.durationMinutes || 0));
  }
  const days = Array.from(byDay.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  if (days.length > 0) {
    lines.push(["DAILY TOTALS"]);
    lines.push(["Date", "Minutes", "Formatted"]);
    for (const [day, min] of days) lines.push([day, String(min), minutesShort(min)]);
    lines.push([]);
  }

  // ── Tasks assigned ──
  lines.push([`TASKS ASSIGNED (${tasksAssigned.length})`]);
  lines.push(["Title", "Status", "Priority", "Due", "Created", "Created by"]);
  for (const t of tasksAssigned) {
    const creator = users.find((u) => u.id === t.createdBy);
    lines.push([
      t.title,
      t.status,
      t.priority,
      t.dueDate || "",
      t.createdAt,
      creator?.email || "",
    ]);
  }
  lines.push([]);

  // ── Tasks created by user ──
  lines.push([`TASKS CREATED BY USER (${tasksCreated.length})`]);
  lines.push(["Title", "Assignee", "Status", "Priority", "Due", "Created"]);
  for (const t of tasksCreated) {
    const a = users.find((u) => u.id === t.assigneeId);
    lines.push([
      t.title,
      a?.email || "",
      t.status,
      t.priority,
      t.dueDate || "",
      t.createdAt,
    ]);
  }

  return lines.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function escHtml(s: string | number | null | undefined): string {
  const v = s == null ? "" : String(s);
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildUserReportHtml(
  user: User,
  entries: TimeEntry[],
  tasksAssigned: Task[],
  tasksCreated: Task[],
  users: User[],
): string {
  const closed = entries.filter((e) => e.endedAt);
  const totalMin = closed.reduce((s, e) => s + (e.durationMinutes || 0), 0);
  const sortedEntries = [...entries].sort((a, b) => (a.startedAt > b.startedAt ? -1 : 1));

  const byDay = new Map<string, number>();
  for (const e of closed) {
    const d = e.startedAt.slice(0, 10);
    byDay.set(d, (byDay.get(d) || 0) + (e.durationMinutes || 0));
  }
  const days = Array.from(byDay.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));

  const reportTitle = `${user.name || user.email} — KubeGraf Time Sheet`;
  const generated = new Date().toLocaleString();

  // Inline styles + auto-print are key to a one-click PDF.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escHtml(reportTitle)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1f2937; line-height: 1.5;
    margin: 0; padding: 36px 40px 60px;
    background: #fff;
  }
  .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #ffa340; padding-bottom: 14px; margin-bottom: 28px; }
  .head h1 { margin: 0; font-size: 22px; font-weight: 600; color: #111; letter-spacing: -0.01em; }
  .head .brand { display: flex; align-items: center; gap: 10px; }
  .head .logo { width: 32px; height: 32px; border-radius: 8px; background: linear-gradient(135deg, #ffd486, #ffa340); display: flex; align-items: center; justify-content: center; color: #000; font-weight: 700; font-size: 15px; }
  .head .meta { font-size: 11px; color: #6b7280; }
  h2 { font-size: 13px; font-weight: 600; color: #111; text-transform: uppercase; letter-spacing: 0.12em; margin: 28px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #e5e7eb; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { text-align: left; padding: 7px 10px; font-size: 12px; vertical-align: top; }
  th { background: #f9fafb; color: #6b7280; font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: 0.08em; border-bottom: 1px solid #e5e7eb; }
  td { border-bottom: 1px solid #f3f4f6; color: #374151; }
  td.num { font-family: ui-monospace, monospace; color: #b85700; font-weight: 600; }
  .identity { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; font-size: 13px; }
  .identity .label { color: #6b7280; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
  .identity .value { color: #111; font-weight: 500; margin-bottom: 8px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; }
  .badge-admin { background: #fff5e8; color: #b85700; border: 1px solid #ffd486; }
  .badge-emp { background: #f3f4f6; color: #374151; border: 1px solid #e5e7eb; }
  .summary { display: flex; gap: 18px; flex-wrap: wrap; margin: 16px 0; }
  .summary .card { padding: 10px 14px; border: 1px solid #e5e7eb; border-radius: 8px; min-width: 120px; }
  .summary .card .lbl { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.1em; }
  .summary .card .val { font-size: 18px; font-weight: 600; color: #111; }
  .summary .card.brand .val { color: #b85700; }
  .empty { padding: 14px; text-align: center; color: #9ca3af; font-style: italic; font-size: 12px; }
  .foot { margin-top: 32px; font-size: 10px; color: #9ca3af; text-align: center; }
  @media print {
    body { padding: 18mm 14mm 18mm; }
    h2 { page-break-after: avoid; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; page-break-after: auto; }
  }
</style>
</head>
<body>
  <div class="head">
    <div>
      <h1>${escHtml(reportTitle)}</h1>
      <div class="meta">Generated ${escHtml(generated)}</div>
    </div>
    <div class="brand">
      <div class="logo">K</div>
      <div>
        <div style="font-weight:600;font-size:13px;color:#111;">KubeGraf</div>
        <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.12em;">Internal Time Sheet</div>
      </div>
    </div>
  </div>

  <h2>Identity</h2>
  <div class="identity">
    <div>
      <div class="label">Name</div>
      <div class="value">${escHtml(user.name || "—")}</div>
    </div>
    <div>
      <div class="label">Email</div>
      <div class="value">${escHtml(user.email)}</div>
    </div>
    <div>
      <div class="label">Role</div>
      <div class="value"><span class="badge ${user.role === "ADMIN" ? "badge-admin" : "badge-emp"}">${user.role}</span></div>
    </div>
    <div>
      <div class="label">Status</div>
      <div class="value">${user.active ? "Active" : "Inactive"}</div>
    </div>
    <div>
      <div class="label">Joined</div>
      <div class="value">${escHtml(new Date(user.createdAt).toLocaleString())}</div>
    </div>
    <div>
      <div class="label">Password set</div>
      <div class="value">${user.passwordSetAt ? escHtml(new Date(user.passwordSetAt).toLocaleString()) : "—"}</div>
    </div>
  </div>

  <h2>Summary</h2>
  <div class="summary">
    <div class="card brand"><div class="lbl">Total time logged</div><div class="val">${escHtml(minutesShort(totalMin))}</div></div>
    <div class="card"><div class="lbl">Days worked</div><div class="val">${days.length}</div></div>
    <div class="card"><div class="lbl">Time entries</div><div class="val">${entries.length}</div></div>
    <div class="card"><div class="lbl">Tasks assigned</div><div class="val">${tasksAssigned.length}</div></div>
    <div class="card"><div class="lbl">Tasks created</div><div class="val">${tasksCreated.length}</div></div>
  </div>

  <h2>Daily totals</h2>
  ${days.length === 0
    ? `<div class="empty">No completed time entries yet.</div>`
    : `<table>
        <thead><tr><th>Date</th><th>Hours</th><th>Formatted</th></tr></thead>
        <tbody>
        ${days
          .map(([d, min]) => `<tr><td>${escHtml(new Date(d + "T00:00:00").toDateString())}</td><td class="num">${(min / 60).toFixed(2)}</td><td class="num">${escHtml(minutesShort(min))}</td></tr>`)
          .join("")}
        </tbody>
      </table>`}

  <h2>Time entries (${entries.length})</h2>
  ${entries.length === 0
    ? `<div class="empty">No time entries yet.</div>`
    : `<table>
        <thead><tr>
          <th>Started</th>
          <th>Ended</th>
          <th>Duration</th>
          <th>Task</th>
          <th>Description</th>
        </tr></thead>
        <tbody>
        ${sortedEntries.map((e) => {
          const task = tasksAssigned.find((t) => t.id === e.taskId)?.title || "";
          return `<tr>
            <td>${escHtml(new Date(e.startedAt).toLocaleString())}</td>
            <td>${e.endedAt ? escHtml(new Date(e.endedAt).toLocaleString()) : "<em>in progress</em>"}</td>
            <td class="num">${e.endedAt ? escHtml(minutesShort(e.durationMinutes)) : "—"}</td>
            <td>${escHtml(task)}</td>
            <td>${escHtml(e.description || "")}</td>
          </tr>`;
        }).join("")}
        </tbody>
      </table>`}

  <h2>Tasks assigned (${tasksAssigned.length})</h2>
  ${tasksAssigned.length === 0
    ? `<div class="empty">No tasks assigned.</div>`
    : `<table>
        <thead><tr><th>Title</th><th>Status</th><th>Priority</th><th>Due</th><th>Created by</th></tr></thead>
        <tbody>
        ${tasksAssigned.map((t) => {
          const creator = users.find((u) => u.id === t.createdBy);
          return `<tr>
            <td><strong>${escHtml(t.title)}</strong>${t.description ? `<div style="color:#6b7280;font-size:11px;margin-top:2px;">${escHtml(t.description)}</div>` : ""}</td>
            <td>${escHtml(t.status.replace("_", " "))}</td>
            <td>${escHtml(t.priority)}</td>
            <td>${escHtml(t.dueDate || "—")}</td>
            <td>${escHtml(creator?.email || "—")}</td>
          </tr>`;
        }).join("")}
        </tbody>
      </table>`}

  <h2>Tasks created by ${escHtml(user.name || user.email)} (${tasksCreated.length})</h2>
  ${tasksCreated.length === 0
    ? `<div class="empty">No tasks created.</div>`
    : `<table>
        <thead><tr><th>Title</th><th>Assignee</th><th>Status</th><th>Priority</th><th>Due</th></tr></thead>
        <tbody>
        ${tasksCreated.map((t) => {
          const a = users.find((u) => u.id === t.assigneeId);
          return `<tr>
            <td><strong>${escHtml(t.title)}</strong></td>
            <td>${escHtml(a?.email || "—")}</td>
            <td>${escHtml(t.status.replace("_", " "))}</td>
            <td>${escHtml(t.priority)}</td>
            <td>${escHtml(t.dueDate || "—")}</td>
          </tr>`;
        }).join("")}
        </tbody>
      </table>`}

  <div class="foot">
    KubeGraf · Internal use only · Confidential
  </div>
</body>
</html>`;
}
