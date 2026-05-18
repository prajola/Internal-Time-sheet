import { useEffect, useState } from "react";
import { Plus, X, UserCog, UserX, UserCheck, KeyRound, Users as UsersIcon } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useToast } from "../components/Toast";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { fmtDate } from "../lib/format";
import type { Role, User } from "../types";

export default function AdminUsers() {
  const { user: me } = useAuth();
  const { ok, err } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);

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

  async function resetPassword(u: User) {
    if (!confirm(`Send a password-reset link to ${u.email}? Their current password will stop working immediately.`)) return;
    try {
      await api.patch(`/api/users/${u.id}`, { resetPassword: true });
      ok(`Reset link sent to ${u.email}.`);
    } catch (e: any) { err(e?.message || "Failed"); }
  }

  return (
    <div>
      <PageHeader
        icon={<UsersIcon size={18} />}
        eyebrow="Administration"
        title="Users"
        description="Invite teammates, promote admins, manage access."
        actions={
          <button onClick={() => setShowInvite(true)} className="ko-btn-primary h-10 px-4 text-sm inline-flex items-center gap-1.5">
            <Plus size={16} /> Invite user
          </button>
        }
      />

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
      ) : (
        <div className="ko-card overflow-hidden">
          <table className="ko-table">
            <thead>
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
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium">{u.name || "—"}{u.id === me?.id && <span className="text-[10px] uppercase tracking-[0.16em] text-brand-800 ml-2">you</span>}</td>
                  <td>{u.email}</td>
                  <td><span className={u.role === "ADMIN" ? "ko-pill-admin" : "ko-pill-employee"}>{u.role}</span></td>
                  <td>{u.active ? <span className="text-emerald-700 text-xs">Active</span> : <span className="text-gray-400 text-xs">Inactive</span>}</td>
                  <td className="text-gray-500">{fmtDate(u.createdAt)}</td>
                  <td className="text-right space-x-1">
                    <button onClick={() => resetPassword(u)} className="ko-btn-ghost h-8 px-2 text-xs inline-flex items-center gap-1" title="Email a password-reset link">
                      <KeyRound size={12} /> Reset password
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
            </tbody>
          </table>
        </div>
      )}

      {showInvite && <InviteDialog onClose={() => setShowInvite(false)} onSent={() => { setShowInvite(false); load(); }} />}
    </div>
  );
}

function InviteDialog({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const { ok, err } = useToast();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("EMPLOYEE");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/api/users", { email: email.trim(), name: name.trim(), role });
      ok(`Invitation sent to ${email}.`);
      onSent();
    } catch (e: any) { err(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-40 bg-gray-900/50 backdrop-blur-md ko-fade-in flex items-center justify-center px-4">
      <form onSubmit={submit} className="ko-card-glow p-6 w-full max-w-md">
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
        <p className="text-[11px] text-gray-500 mt-4">A magic sign-in link will be emailed. It expires in 10 minutes; the invitation itself stays valid for 7 days.</p>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="ko-btn-ghost h-10 px-4 text-sm">Cancel</button>
          <button type="submit" disabled={busy || !email} className="ko-btn-primary h-10 px-5 text-sm">{busy ? "Sending…" : "Send invite"}</button>
        </div>
      </form>
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
