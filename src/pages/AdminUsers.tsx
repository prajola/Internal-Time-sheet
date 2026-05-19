import { useEffect, useMemo, useState } from "react";
import {
  Plus, X, UserCog, UserX, UserCheck, Lock, Users as UsersIcon, Download,
  Search as SearchIcon, XCircle, CalendarRange, Filter, Copy, Check, Mail, AlertCircle,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useToast } from "../components/Toast";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { SetPasswordDialog } from "../components/SetPasswordDialog";
import { fmtDate, todayYmd } from "../lib/format";
import { downloadCsv, dateStampedName } from "../lib/csv";
import type { Role, User } from "../types";

export default function AdminUsers() {
  const { user: me } = useAuth();
  const { ok, err } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [setPwTarget, setSetPwTarget] = useState<User | null>(null);

  // Filters — mirror the AdminTasks pattern.
  const [search, setSearch] = useState<string>("");
  const [filterRole, setFilterRole] = useState<"all" | "ADMIN" | "EMPLOYEE">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">("all");
  const [period, setPeriod] = useState<"all" | "today" | "week" | "month" | "year" | "custom">("all");
  const [customDay, setCustomDay] = useState<string>("");

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<{ users: User[] }>("/api/users");
      r.users.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
      setUsers(r.users);
    } catch (e: any) { err(e?.message || "Failed"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function toggleRole(u: User) {
    const role: Role = u.role === "ADMIN" ? "EMPLOYEE" : "ADMIN";
    if (!confirm(`Set ${u.email} to ${role}?`)) return;
    try {
      const r = await api.patch<{ user: User }>(`/api/users/${u.id}`, { role });
      setUsers((ls) => ls.map((x) => (x.id === r.user.id ? r.user : x)));
      ok("Role updated.");
    } catch (e: any) { err(e?.message || "Failed"); }
  }

  async function toggleActive(u: User) {
    const next = !u.active;
    if (!confirm(`${next ? "Re-activate" : "Deactivate"} ${u.email}?`)) return;
    try {
      const r = await api.patch<{ user: User }>(`/api/users/${u.id}`, { active: next });
      setUsers((ls) => ls.map((x) => (x.id === r.user.id ? r.user : x)));
      ok(next ? "User re-activated." : "User deactivated.");
    } catch (e: any) { err(e?.message || "Failed"); }
  }

  function openSetPassword(u: User) {
    setSetPwTarget(u);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (filterRole !== "all" && u.role !== filterRole) return false;
      if (filterStatus === "active"   && !u.active) return false;
      if (filterStatus === "inactive" &&  u.active) return false;

      if (q) {
        const hay = `${u.name || ""} ${u.email}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      if (period !== "all") {
        const joined = u.createdAt;
        if (!joined) return false;
        const d = new Date(joined);
        if (Number.isNaN(d.getTime())) return false;

        if (period === "today") {
          if (joined.slice(0, 10) !== todayYmd()) return false;
        } else if (period === "week") {
          const start = startOfWeek(new Date()).getTime();
          const end   = start + 7 * 24 * 3600 * 1000;
          if (d.getTime() < start || d.getTime() >= end) return false;
        } else if (period === "month") {
          const start = startOfMonth(new Date()).getTime();
          const end   = startOfMonth(addMonths(new Date(), 1)).getTime();
          if (d.getTime() < start || d.getTime() >= end) return false;
        } else if (period === "year") {
          const start = startOfYear(new Date()).getTime();
          const end   = startOfYear(addYears(new Date(), 1)).getTime();
          if (d.getTime() < start || d.getTime() >= end) return false;
        } else if (period === "custom") {
          if (!customDay) return true;
          if (joined.slice(0, 10) !== customDay) return false;
        }
      }

      return true;
    });
  }, [users, search, filterRole, filterStatus, period, customDay]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (search.trim())            n++;
    if (filterRole !== "all")     n++;
    if (filterStatus !== "all")   n++;
    if (period !== "all")         n++;
    return n;
  }, [search, filterRole, filterStatus, period]);

  function clearFilters() {
    setSearch("");
    setFilterRole("all");
    setFilterStatus("all");
    setPeriod("all");
    setCustomDay("");
  }

  function exportCsv() {
    if (filtered.length === 0) { err("No users to export"); return; }
    const rows: Array<Array<unknown>> = [
      ["ID", "Name", "Email", "Role", "Active", "Joined", "Password set", "Sessions revoked", "Invited by"],
      ...filtered.map((u) => [
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
    downloadCsv(dateStampedName("kubegraf-users"), rows);
    ok(`Users CSV downloaded (${filtered.length} row${filtered.length === 1 ? "" : "s"}).`);
  }

  return (
    <div>
      <PageHeader
        icon={<UsersIcon size={18} />}
        eyebrow="Administration"
        title="Users"
        description="Invite teammates, promote admins, manage access."
        actions={
          <>
            <button onClick={exportCsv} disabled={filtered.length === 0} className="ko-btn-ghost h-10 px-4 text-sm inline-flex items-center gap-1.5">
              <Download size={14} /> Export CSV
            </button>
            <button onClick={() => setShowInvite(true)} className="ko-btn-primary h-10 px-4 text-sm inline-flex items-center gap-1.5">
              <Plus size={16} /> Invite user
            </button>
          </>
        }
      />

      {/* ── Filter card ─────────────────────────────────────── */}
      {users.length > 0 && (
        <div className="ko-card p-4 mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">Search</div>
              <div className="relative">
                <SearchIcon size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name or email…"
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
              <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">Role</div>
              <select className="ko-input h-9 w-full sm:w-36" value={filterRole} onChange={(e) => setFilterRole(e.target.value as typeof filterRole)}>
                <option value="all">All roles</option>
                <option value="ADMIN">Admin</option>
                <option value="EMPLOYEE">Employee</option>
              </select>
            </div>

            <div className="w-full sm:w-auto">
              <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">Status</div>
              <select className="ko-input h-9 w-full sm:w-36" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}>
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
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
                <CalendarRange size={11} /> Joined
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

            <div className="w-full sm:w-auto sm:ml-auto text-left sm:text-right">
              <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500">Showing</div>
              <div className="font-display text-lg text-gray-900 leading-tight">
                {filtered.length} <span className="text-gray-400 text-sm font-normal">of {users.length}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="ko-card p-4 space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="ko-skel h-10 w-full" />)}
        </div>
      ) : users.length === 0 ? (
        <div className="ko-card">
          <EmptyState
            icon={<UsersIcon size={20} />}
            title="No users yet"
            description="Invite teammates to start tracking their time and tasks."
            action={
              <button onClick={() => setShowInvite(true)} className="ko-btn-primary h-10 px-4 text-sm inline-flex items-center gap-1.5">
                <Plus size={16} /> Invite user
              </button>
            }
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="ko-card">
          <EmptyState
            icon={<Filter size={20} />}
            title="No users match these filters"
            description="Try widening your filters or clearing them."
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
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium">{u.name || "—"}{u.id === me?.id && <span className="text-[10px] uppercase tracking-[0.16em] text-brand-800 ml-2">you</span>}</td>
                  <td>{u.email}</td>
                  <td><span className={u.role === "ADMIN" ? "ko-pill-admin" : "ko-pill-employee"}>{u.role}</span></td>
                  <td>{u.active ? <span className="text-emerald-700 text-xs">Active</span> : <span className="text-gray-400 text-xs">Inactive</span>}</td>
                  <td className="text-gray-500">{fmtDate(u.createdAt)}</td>
                  <td className="text-right space-x-1">
                    <button onClick={() => openSetPassword(u)} className="ko-btn-ghost h-8 px-2 text-xs inline-flex items-center gap-1" title="Set a new password directly — applied immediately, no email">
                      <Lock size={12} /> Set password
                    </button>
                    {u.id !== me?.id && (
                      <>
                        <button onClick={() => toggleRole(u)} className="ko-btn-ghost h-8 px-2 text-xs inline-flex items-center gap-1">
                          <UserCog size={12} /> {u.role === "ADMIN" ? "Demote" : "Promote"}
                        </button>
                        <button onClick={() => toggleActive(u)} className={"ko-btn-ghost h-8 px-2 text-xs inline-flex items-center gap-1 " + (u.active ? "hover:!border-red-200 hover:!text-red-700" : "")}>
                          {u.active ? <><UserX size={12} /> Deactivate</> : <><UserCheck size={12} /> Activate</>}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody></table></div>
        </div>
      )}

      {showInvite && <InviteDialog onClose={() => setShowInvite(false)} onSent={() => { setShowInvite(false); load(); }} />}
      {setPwTarget && (
        <SetPasswordDialog
          user={setPwTarget}
          onClose={() => setSetPwTarget(null)}
          onSaved={() => { setSetPwTarget(null); load(); }}
          onSuccessToast={ok}
          onErrorToast={err}
        />
      )}
    </div>
  );
}

interface InviteResult {
  invitation: { id: string; email: string; role: Role };
  setupLink: string;
  emailSent: boolean;
}

function InviteDialog({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const { err } = useToast();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("EMPLOYEE");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<InviteResult>("/api/users", { email: email.trim(), name: name.trim(), role });
      setResult(r);
    } catch (e: any) { err(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  async function copyLink() {
    if (!result?.setupLink) return;
    try {
      await navigator.clipboard.writeText(result.setupLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API blocked (insecure context); fall back to selecting.
      const el = document.getElementById("invite-setup-link") as HTMLInputElement | null;
      el?.select();
    }
  }

  function closeAndRefresh() {
    if (result) onSent();
    else onClose();
  }

  return (
    <div className="fixed inset-0 z-40 bg-gray-900/50 backdrop-blur-md ko-fade-in flex items-center justify-center px-4">
      {result ? (
        /* ── Success state — show the copy-able link ───────────────── */
        <div className="ko-card-glow p-6 w-full max-w-md ko-modal-body">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-display text-xl inline-flex items-center gap-2">
              <Check size={18} className="text-emerald-600" /> Invite created
            </h2>
            <button type="button" className="ko-btn-ghost h-8 w-8 inline-flex items-center justify-center" onClick={closeAndRefresh}><X size={14} /></button>
          </div>

          <p className="text-[13px] text-gray-700 mb-1">
            Send this link to <span className="text-gray-900 font-medium">{result.invitation.email}</span> so they can set their password and sign in.
          </p>
          <p className="text-[12px] text-gray-500 mb-3">Link expires in 24 hours · invitation valid for 7 days.</p>

          <div className="flex gap-2 items-stretch">
            <input
              id="invite-setup-link"
              readOnly
              value={result.setupLink}
              onClick={(e) => (e.target as HTMLInputElement).select()}
              className="ko-input h-10 text-[12px] font-mono flex-1 min-w-0"
            />
            <button
              type="button"
              onClick={copyLink}
              className={
                "h-10 px-3 text-[13px] font-medium rounded-md inline-flex items-center gap-1.5 transition border " +
                (copied
                  ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                  : "bg-brand-500 border-brand-500 text-black hover:brightness-105")
              }
            >
              {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
            </button>
          </div>

          <div className={
            "mt-4 rounded-md border p-3 text-[12px] inline-flex items-start gap-2 " +
            (result.emailSent
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-amber-50 border-amber-200 text-amber-900")
          }>
            {result.emailSent ? <Mail size={13} className="mt-0.5 flex-shrink-0" /> : <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />}
            {result.emailSent
              ? <span>Also emailed to <span className="font-medium">{result.invitation.email}</span> in case they check their inbox.</span>
              : <span>Email delivery isn't configured on this deployment — paste the link above into Slack/WhatsApp/SMS and send it to them yourself.</span>}
          </div>

          <div className="flex justify-end mt-5">
            <button type="button" onClick={closeAndRefresh} className="ko-btn-primary h-10 px-5 text-sm">Done</button>
          </div>
        </div>
      ) : (
        /* ── Form state ────────────────────────────────────────────── */
        <form onSubmit={submit} className="ko-card-glow p-6 w-full max-w-md ko-modal-body">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-display text-xl">Invite user</h2>
            <button type="button" className="ko-btn-ghost h-8 w-8 inline-flex items-center justify-center" onClick={onClose}><X size={14} /></button>
          </div>
          <div className="space-y-3">
            <FieldRow label="Email">
              <input type="email" required className="ko-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@kubegraf.io" />
            </FieldRow>
            <FieldRow label="Name (optional)">
              <input className="ko-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
            </FieldRow>
            <FieldRow label="Role">
              <select className="ko-input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="EMPLOYEE">Employee</option>
                <option value="ADMIN">Admin</option>
              </select>
            </FieldRow>
          </div>
          <p className="text-[11px] text-gray-500 mt-4">
            You'll get a setup link to share with them. It expires in 24 hours; the invitation itself stays valid for 7 days. If email is configured on this deployment, they'll also receive the link by email.
          </p>
          <div className="flex justify-end gap-2 mt-5">
            <button type="button" onClick={onClose} className="ko-btn-ghost h-10 px-4 text-sm">Cancel</button>
            <button type="submit" disabled={busy || !email} className="ko-btn-primary h-10 px-5 text-sm">{busy ? "Creating…" : "Create invite"}</button>
          </div>
        </form>
      )}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">{label}</div>
      {children}
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
