import { useEffect, useMemo, useState } from "react";
import { Pencil, Trash2, Plus, X, Clock } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useToast } from "../components/Toast";
import { Filters, FilterValue, buildQuery } from "../components/Filters";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { fmtDateTime, fmtMinutes, fromLocalInputValue, toLocalInputValue, todayYmd } from "../lib/format";
import type { Task, TimeEntry } from "../types";

export default function MyTimesheet() {
  const { user } = useAuth();
  const { ok, err } = useToast();
  const [filter, setFilter] = useState<FilterValue>({ mode: "month", month: todayYmd().slice(0, 7) });
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<TimeEntry | null>(null);

  async function load() {
    const q = buildQuery(filter);
    try {
      const [e, t] = await Promise.all([
        api.get<{ entries: TimeEntry[] }>(`/api/time-entries${q ? `?${q}` : ""}`),
        api.get<{ tasks: Task[] }>("/api/tasks"),
      ]);
      setEntries(e.entries);
      setTasks(t.tasks);
    } catch (e: any) { err(e?.message || "Failed"); }
  }
  useEffect(() => { load(); }, [filter]);

  const total = useMemo(
    () => entries.reduce((s, e) => s + (e.durationMinutes || 0), 0),
    [entries]
  );

  async function remove(e: TimeEntry) {
    if (!confirm("Delete this time entry?")) return;
    try {
      await api.del(`/api/time-entries/${e.id}`);
      setEntries((ls) => ls.filter((x) => x.id !== e.id));
      ok("Entry deleted.");
    } catch (e: any) { err(e?.message || "Failed"); }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Clock size={18} />}
        eyebrow="Workspace"
        title="My timesheet"
        description="Your tracked time, filterable by day, week, month or year."
        actions={
          <button onClick={() => setShowAdd(true)} className="ko-btn-primary h-10 px-4 text-sm inline-flex items-center gap-1.5">
            <Plus size={16} /> Add entry
          </button>
        }
      />

      <Filters
        value={filter}
        onChange={setFilter}
        extra={
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500">Total</div>
            <div className="font-display text-2xl text-brand-800 leading-none">{fmtMinutes(total)}</div>
          </div>
        }
      />

      {entries.length === 0 ? (
        <div className="ko-card">
          <EmptyState
            icon={<Clock size={20} />}
            title="No entries in this view"
            description="Try a wider date range, or clock in from the dashboard."
          />
        </div>
      ) : (
        <div className="ko-card overflow-hidden">
          <div className="ko-table-scroll"><table className="ko-table"><thead>
              <tr>
                <th>Started</th>
                <th>Ended</th>
                <th>Duration</th>
                <th>Task</th>
                <th>Description</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{fmtDateTime(e.startedAt)}</td>
                  <td>{e.endedAt ? fmtDateTime(e.endedAt) : <span className="text-brand-700">in progress</span>}</td>
                  <td className="font-mono">{e.endedAt ? fmtMinutes(e.durationMinutes) : "—"}</td>
                  <td className="text-gray-600">{tasks.find((t) => t.id === e.taskId)?.title || "—"}</td>
                  <td className="text-gray-600">{e.description || "—"}</td>
                  <td className="text-right space-x-1">
                    <button className="ko-btn-ghost h-8 px-2 text-xs inline-flex items-center gap-1" onClick={() => setEditing(e)}>
                      <Pencil size={12} /> Edit
                    </button>
                    <button className="ko-btn-ghost h-8 px-2 text-xs inline-flex items-center gap-1 hover:!border-red-200 hover:!text-red-700" onClick={() => remove(e)}>
                      <Trash2 size={12} /> Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody></table></div>
        </div>
      )}

      {(showAdd || editing) && (
        <EntryDialog
          entry={editing}
          tasks={user!.role === "EMPLOYEE" ? tasks : []}
          onClose={() => { setShowAdd(false); setEditing(null); }}
          onSaved={(saved, created) => {
            if (created) setEntries((ls) => [saved, ...ls]);
            else setEntries((ls) => ls.map((x) => (x.id === saved.id ? saved : x)));
            setShowAdd(false); setEditing(null);
            ok(created ? "Entry created." : "Entry updated.");
          }}
        />
      )}
    </div>
  );
}

interface DialogProps {
  entry: TimeEntry | null;
  tasks: Task[];
  onClose: () => void;
  onSaved: (e: TimeEntry, created: boolean) => void;
}

function EntryDialog({ entry, tasks, onClose, onSaved }: DialogProps) {
  const { err } = useToast();
  const [taskId, setTaskId] = useState(entry?.taskId || "");
  const [description, setDescription] = useState(entry?.description || "");
  const [startedAt, setStartedAt] = useState(toLocalInputValue(entry?.startedAt) || toLocalInputValue(new Date().toISOString()));
  const [endedAt, setEndedAt] = useState(toLocalInputValue(entry?.endedAt));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const body: any = {
        taskId: taskId || null,
        description,
        startedAt: fromLocalInputValue(startedAt),
        endedAt: endedAt ? fromLocalInputValue(endedAt) : null,
      };
      if (entry) {
        const r = await api.patch<{ entry: TimeEntry }>(`/api/time-entries/${entry.id}`, body);
        onSaved(r.entry, false);
      } else {
        const r = await api.post<{ entry: TimeEntry }>(`/api/time-entries`, body);
        onSaved(r.entry, true);
      }
    } catch (e: any) { err(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-40 bg-gray-900/50 backdrop-blur-md ko-fade-in flex items-center justify-center px-4">
      <div className="ko-card-glow p-6 w-full max-w-lg ko-modal-body">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-display text-xl">{entry ? "Edit time entry" : "New time entry"}</h2>
          <button className="ko-btn-ghost h-8 w-8 inline-flex items-center justify-center" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="space-y-3">
          {tasks.length > 0 && (
            <Field label="Task">
              <select className="ko-input" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                <option value="">No task (general)</option>
                {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </Field>
          )}
          <Field label="Description">
            <textarea className="ko-input min-h-[80px]" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Started"><input type="datetime-local" className="ko-input" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} /></Field>
            <Field label="Ended (leave blank = in progress)"><input type="datetime-local" className="ko-input" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} /></Field>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="ko-btn-ghost h-10 px-4 text-sm">Cancel</button>
          <button onClick={save} disabled={busy} className="ko-btn-primary h-10 px-5 text-sm">{busy ? "…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">{label}</div>
      {children}
    </div>
  );
}
