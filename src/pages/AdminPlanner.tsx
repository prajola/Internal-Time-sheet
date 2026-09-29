/**
 * Planner (admin) — the whole team's time off on one calendar, plus the
 * approval queue.
 *
 * Shifts are only plotted when a single user is selected: across the
 * whole team every working day would carry a shift chip for everyone,
 * which buries the holidays this page exists to show.
 */
import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays, CalendarClock, CalendarCheck, Check, X, XCircle,
  Search as SearchIcon, Filter, Ban, BriefcaseBusiness, Radio, Plus,
} from "lucide-react";
import { api, holidaysUrl, holidaysBody, HOLIDAYS_POST_URL } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useToast } from "../components/Toast";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { PlannerCalendar } from "../components/PlannerCalendar";
import { RequestTimeOffDialog } from "../components/RequestTimeOffDialog";
import {
  CATEGORY_LABEL, MONTH_NAMES, STATUS_BADGE, holidayCategory, kindDetail, statusWord, formatDays, formatRange,
  type TimeOffCategory,
  todayYmd, holidayDates, workedStatsByUser, entryMinutes, entriesInMonth,
  yearSummary,
} from "../lib/planner";
import { YearOverview } from "../components/YearOverview";
import { ViewSwitch, type PlannerView } from "../components/ViewSwitch";
import { fmtDate, fmtMinutes, fmtTime } from "../lib/format";
import type { Holiday, HolidayStatus, TimeEntry, User } from "../types";

const STATUSES: HolidayStatus[] = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"];

export default function AdminPlanner() {
  const { ok, err } = useToast();
  const { user: me } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [staff, setStaff] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState("");
  const [filterUser, setFilterUser] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<"all" | HolidayStatus>("all");
  const [view, setView] = useState<PlannerView>("month");
  /** Admins book their own time off from this calendar too. */
  const [requesting, setRequesting] = useState<{ date: string; category: TimeOffCategory } | null>(null);

  /**
   * A year of the whole team's entries in one request, sliced locally.
   * The calendar only plots shifts when one person is selected, but the
   * worked-days table and the year view need everyone regardless.
   */
  async function load(opts: { quiet?: boolean } = {}) {
    if (opts.quiet) setRefreshing(true); else setLoading(true);
    try {
      const [h, e, u] = await Promise.all([
        api.get<{ holidays: Holiday[] }>(holidaysUrl()),
        api.get<{ entries: TimeEntry[] }>(`/api/time-entries?year=${year}`),
        api.get<{ users: User[] }>("/api/users"),
      ]);
      setHolidays(h.holidays);
      setEntries(e.entries);
      setStaff(u.users);
    } catch (e: any) {
      err(e?.message || "Failed to load the planner");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, [year]);

  /**
   * The running month stays live so a clock-in shows up here without a
   * reload — same heartbeat as the employee's planner. `tick` re-renders
   * so open shifts keep accruing time between fetches.
   */
  const isCurrentYear = year === now.getFullYear();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!isCurrentYear) return;
    const refetch = setInterval(() => load({ quiet: true }), 60_000);
    const retick = setInterval(() => setTick((t) => t + 1), 30_000);
    const onFocus = () => load({ quiet: true });
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(refetch);
      clearInterval(retick);
      window.removeEventListener("focus", onFocus);
    };
  }, [isCurrentYear, year]);

  // The visible month's slice of the year we fetched.
  const monthEntries = useMemo(() => entriesInMonth(entries, year, month), [entries, year, month]);

  const users = useMemo(() => {
    const set = new Map<string, string>();
    for (const u of staff) if (u.active) set.set(u.id, u.name || u.email);
    // Anyone with holiday history but no longer in the active list still
    // needs a filter entry, or their requests become unreachable.
    for (const h of holidays) if (!set.has(h.userId)) set.set(h.userId, h.userName || h.userEmail);
    return [...set.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [staff, holidays]);

  // `tick` is a deliberate dependency — it advances the live timers.
  const workedByUser = useMemo(() => workedStatsByUser(monthEntries), [monthEntries, tick]);

  // Year view respects the person filter, so an admin can pull up one
  // employee's twelve months of attendance.
  const yearHolidays = useMemo(
    () => (filterUser === "all" ? holidays : holidays.filter((h) => h.userId === filterUser)),
    [holidays, filterUser],
  );
  const yearEntries = useMemo(
    () => (filterUser === "all" ? entries : entries.filter((e) => e.userId === filterUser)),
    [entries, filterUser],
  );
  const months = useMemo(
    () => yearSummary(year, yearEntries, yearHolidays),
    [year, yearEntries, yearHolidays, tick],
  );

  const teamWorked = useMemo(() => {
    return users
      .map((u) => ({ ...u, stats: workedByUser.get(u.id) }))
      .filter((r) => r.stats && r.stats.days > 0)
      .sort((a, b) => (b.stats!.days - a.stats!.days) || a.name.localeCompare(b.name));
  }, [users, workedByUser]);

  const clockedInNow = useMemo(() => monthEntries.filter((e) => !e.endedAt), [monthEntries]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return holidays.filter((h) => {
      if (filterUser !== "all" && h.userId !== filterUser) return false;
      if (filterStatus !== "all" && h.status !== filterStatus) return false;
      if (term && !(
        (h.userName || "").toLowerCase().includes(term) ||
        h.userEmail.toLowerCase().includes(term) ||
        h.reason.toLowerCase().includes(term)
      )) return false;
      return true;
    });
  }, [holidays, search, filterUser, filterStatus]);

  // The calendar ignores the status filter — hiding approved holidays
  // from the grid would make it lie about who's actually away.
  const calendarHolidays = useMemo(
    () => holidays.filter((h) => h.status !== "REJECTED" && h.status !== "CANCELLED")
      .filter((h) => filterUser === "all" || h.userId === filterUser),
    [holidays, filterUser],
  );

  /**
   * Across the whole team every weekday would carry a shift chip for
   * everyone, burying the holidays — so shifts plot for one person at a
   * time. With nobody selected that person is the admin themselves, so
   * their own clock-in shows up on their own planner rather than being
   * invisible until they filter to their own name.
   */
  const shiftOwner = filterUser === "all" ? me?.id : filterUser;
  const calendarEntries = useMemo(
    () => (shiftOwner ? monthEntries.filter((e) => e.userId === shiftOwner) : []),
    [monthEntries, shiftOwner],
  );
  const viewingOwnShifts = shiftOwner === me?.id;

  /** The admin's own running shift, for the live banner. */
  const myOpenShift = useMemo(
    () => monthEntries.find((e) => !e.endedAt && e.userId === me?.id) ?? null,
    [monthEntries, me?.id, tick],
  );

  const pending = useMemo(
    () => holidays.filter((h) => h.status === "PENDING")
      .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [holidays],
  );

  const offToday = useMemo(() => {
    const t = todayYmd();
    return holidays.filter((h) => h.status === "APPROVED" && holidayDates(h).includes(t)).length;
  }, [holidays]);

  const activeFilterCount =
    (search ? 1 : 0) + (filterUser !== "all" ? 1 : 0) + (filterStatus !== "all" ? 1 : 0);

  function clearFilters() {
    setSearch(""); setFilterUser("all"); setFilterStatus("all");
  }

  function patch(next: Holiday) {
    setHolidays((ls) => ls.map((x) => (x.id === next.id ? next : x)));
  }

  function goPrev() {
    if (month === 0) { setMonth(11); setYear((y) => y - 1); } else setMonth((m) => m - 1);
  }
  function goNext() {
    if (month === 11) { setMonth(0); setYear((y) => y + 1); } else setMonth((m) => m + 1);
  }
  function goToday() {
    const d = new Date();
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }
  function jump(y: number, m: number) {
    setYear(y);
    setMonth(m);
  }

  const switcher = <ViewSwitch view={view} onChange={setView} />;
  const selectedName = users.find((u) => u.id === filterUser)?.name;

  return (
    <div>
      <PageHeader
        icon={<CalendarDays size={18} />}
        eyebrow="Administration"
        title="Planner"
        description="Everyone's time off in one view. Approve or decline requests here — the employee gets a bell notification and an email either way. Click any day to book your own."
        actions={
          <button
            onClick={() => setRequesting({ date: todayYmd(), category: "HOLIDAY" })}
            className="ko-btn-primary h-10 px-4 text-sm inline-flex items-center gap-1.5"
          >
            <Plus size={15} /> Request time off
          </button>
        }
      />

      {myOpenShift && (
        <div className="ko-card p-3 mb-4 border-emerald-200 bg-emerald-50/60 flex items-center gap-2.5 flex-wrap">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 ko-pulse-soft flex-shrink-0" />
          <span className="text-[13px] text-emerald-900">
            You're clocked in since <strong>{fmtTime(myOpenShift.startedAt)}</strong> —{" "}
            <strong>{fmtMinutes(entryMinutes(myOpenShift))}</strong> so far. Today counts as a worked day on your calendar below.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3 mb-5">
        <StatCard tone="amber"   icon={<CalendarClock size={14} />}     label={<Label short="Awaiting" full="Awaiting approval" />} value={pending.length} />
        <StatCard tone="teal"    icon={<CalendarCheck size={14} />}     label="Off today"         value={offToday} />
        <StatCard tone="green"   icon={<Radio size={14} />}             label={<Label short="Clocked in" full="Clocked in now" />} value={clockedInNow.length} live={clockedInNow.length > 0} />
        <StatCard tone="emerald" icon={<BriefcaseBusiness size={14} />} label={<Label short="Worked" full={`Worked in ${MONTH_NAMES[month]}`} />} value={teamWorked.length} />
      </div>

      {/* ── Approval queue ─────────────────────────────────── */}
      {pending.length > 0 && (
        <div className="mb-6">
          <h2 className="ko-h2 mb-3">Awaiting your decision</h2>
          <div className="grid gap-3">
            {pending.map((h) => <AdminHolidayCard key={h.id} h={h} onChanged={patch} onDeleted={(id) => setHolidays((ls) => ls.filter((x) => x.id !== id))} highlight />)}
          </div>
        </div>
      )}

      {view === "month" ? (
        <>
          <PlannerCalendar
            year={year}
            month={month}
            holidays={calendarHolidays}
            entries={calendarEntries}
            loading={loading}
            refreshing={refreshing}
            showOwner
            ownShifts={viewingOwnShifts}
            viewSwitch={switcher}
            onPrev={goPrev}
            onNext={goNext}
            onToday={goToday}
            onJump={jump}
            onRefresh={() => load({ quiet: true })}
            onRequestTimeOff={(date, category) => setRequesting({ date, category })}
          />
          {filterUser === "all" && (
            <p className="text-[12px] text-gray-500 mt-2">
              Click any day to book a holiday or report an absence. Green chips are your own shifts — pick a single person below to plot theirs instead.
            </p>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <p className="text-[12px] text-gray-500">
              {selectedName
                ? `${selectedName}'s attendance across ${year}.`
                : `Whole-team attendance across ${year} — filter to one person below to see just theirs.`}
            </p>
            {switcher}
          </div>
          <YearOverview
            year={year}
            months={months}
            selectedMonth={month}
            team={filterUser === "all"}
            loading={loading}
            onPrevYear={() => setYear((y) => y - 1)}
            onNextYear={() => setYear((y) => y + 1)}
            onSelectMonth={(m) => { setMonth(m); setView("month"); }}
          />
        </>
      )}

      {/* ── Days worked, per person ────────────────────────── */}
      <h2 className="ko-h2 mt-8 mb-3">Days worked in {MONTH_NAMES[month]} {year}</h2>
      {loading ? (
        <div className="ko-skel h-40 w-full" />
      ) : teamWorked.length === 0 ? (
        <div className="ko-card">
          <EmptyState
            icon={<BriefcaseBusiness size={20} />}
            title="No shifts logged this month"
            description="As soon as someone clocks in, their days worked appear here and on the calendar."
          />
        </div>
      ) : (
        <div className="ko-card overflow-hidden">
          <div className="ko-table-scroll overflow-x-auto">
            <table className="ko-table min-w-[560px]">
              <thead>
                <tr>
                  <th className="text-left">Person</th>
                  <th className="text-right">Days worked</th>
                  <th className="text-right">Hours logged</th>
                  <th className="text-left">Status</th>
                  <th className="text-right">—</th>
                </tr>
              </thead>
              <tbody>
                {teamWorked.map((row) => {
                  const s = row.stats!;
                  return (
                    <tr key={row.id}>
                      <td className="font-medium text-gray-900">{row.name}</td>
                      <td className="text-right font-display text-[15px]">{s.days}</td>
                      <td className="text-right text-gray-700">{fmtMinutes(s.minutes)}</td>
                      <td>
                        {s.open ? (
                          <span className="inline-flex items-center gap-1.5 text-[12px] text-emerald-800">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 ko-pulse-soft" />
                            Clocked in since {fmtTime(s.open.startedAt)} · {fmtMinutes(entryMinutes(s.open))}
                          </span>
                        ) : (
                          <span className="text-[12px] text-gray-400">Clocked out</span>
                        )}
                      </td>
                      <td className="text-right">
                        <button
                          onClick={() => setFilterUser(row.id)}
                          className="ko-btn-ghost h-8 px-2.5 text-[12px]"
                        >
                          View on calendar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── All requests ───────────────────────────────────── */}
      <h2 className="ko-h2 mt-8 mb-3">All requests</h2>

      {holidays.length > 0 && (
        <div className="ko-card p-4 mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">Search</div>
              <div className="relative">
                <SearchIcon size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, email, reason…"
                  className="ko-input h-9 pl-8 pr-8 text-sm"
                />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
                    <XCircle size={13} />
                  </button>
                )}
              </div>
            </div>

            <div className="w-full sm:w-auto">
              <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">Person</div>
              <select className="ko-input h-9 w-full sm:w-48" value={filterUser} onChange={(e) => setFilterUser(e.target.value)}>
                <option value="all">Everyone</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>

            <div className="w-full sm:w-auto">
              <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">Status</div>
              <select className="ko-input h-9 w-full sm:w-40" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as any)}>
                <option value="all">All statuses</option>
                {STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
              </select>
            </div>

            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="ko-btn-ghost h-9 px-3 text-xs inline-flex items-center gap-1.5 w-full sm:w-auto sm:ml-auto justify-center">
                <XCircle size={12} /> Clear all ({activeFilterCount})
              </button>
            )}
          </div>
        </div>
      )}

      {requesting && (
        <RequestTimeOffDialog
          prefillDate={requesting.date}
          initialCategory={requesting.category}
          onClose={() => setRequesting(null)}
          onCreated={(h) => {
            setHolidays((ls) => [h, ...ls]);
            setRequesting(null);
            ok("Request submitted — it's in the approval queue above.");
          }}
        />
      )}

      {loading ? (
        <div className="grid gap-3">{[1, 2, 3].map((i) => <div key={i} className="ko-skel h-24 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="ko-card">
          <EmptyState
            icon={holidays.length === 0 ? <CalendarDays size={20} /> : <Filter size={20} />}
            title={holidays.length === 0 ? "No holiday requests yet" : "Nothing matches these filters"}
            description={holidays.length === 0
              ? "When someone requests time off from their planner, it'll land here for approval."
              : "Try clearing one or more filters."}
            action={holidays.length > 0 && activeFilterCount > 0 && (
              <button onClick={clearFilters} className="ko-btn-ghost h-10 px-4 text-sm inline-flex items-center gap-1.5">
                <XCircle size={14} /> Clear filters
              </button>
            )}
          />
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((h) => (
            <AdminHolidayCard
              key={h.id}
              h={h}
              onChanged={patch}
              onDeleted={(id) => setHolidays((ls) => ls.filter((x) => x.id !== id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AdminHolidayCard({ h, onChanged, onDeleted, highlight }: {
  h: Holiday;
  onChanged: (h: Holiday) => void;
  onDeleted: (id: string) => void;
  highlight?: boolean;
}) {
  const { ok, err } = useToast();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");

  async function decide(action: "approve" | "reject") {
    if (action === "reject" && !note.trim()) {
      err("Give a reason so they know why.");
      return;
    }
    setBusy(true);
    try {
      const r = await api.post<{ holiday: Holiday }>(HOLIDAYS_POST_URL, holidaysBody({
        action, id: h.id, note: note.trim(),
      }));
      onChanged(r.holiday);
      setRejecting(false);
      setNote("");
      ok(action === "approve" ? "Holiday approved." : "Request declined.");
    } catch (e: any) { err(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  async function cancel() {
    if (!confirm(`Cancel ${h.userName || h.userEmail}'s approved holiday?`)) return;
    setBusy(true);
    try {
      const r = await api.post<{ holiday: Holiday }>(HOLIDAYS_POST_URL, holidaysBody({
        action: "cancel", id: h.id, note: note.trim(),
      }));
      onChanged(r.holiday);
      ok("Holiday cancelled.");
    } catch (e: any) { err(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm("Delete this request permanently?")) return;
    setBusy(true);
    try {
      await api.post(HOLIDAYS_POST_URL, holidaysBody({ action: "delete", id: h.id }));
      onDeleted(h.id);
      ok("Deleted.");
    } catch (e: any) { err(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className={"ko-card p-4 " + (highlight ? "border-amber-200 bg-amber-50/30" : "")}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className={"inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-full border " + STATUS_BADGE[h.status]}>
              {statusWord(h.status)}
            </span>
            <span className="text-[11px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200">
              {CATEGORY_LABEL[holidayCategory(h.kind)]}{kindDetail(h.kind) && ` · ${kindDetail(h.kind)}`}
            </span>
            <span className="text-[11px] text-gray-500">requested {fmtDate(h.createdAt)}</span>
          </div>

          <div className="text-[15px] font-medium text-gray-900">
            {h.userName || h.userEmail}
            <span className="text-gray-400 font-normal"> · {formatRange(h)} · {formatDays(h.days)}</span>
          </div>
          <div className="text-[12px] text-gray-500">{h.userEmail}</div>
          {h.reason && <p className="text-[13px] text-gray-700 mt-1.5 whitespace-pre-wrap">{h.reason}</p>}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {h.status === "PENDING" && (
            <>
              <button onClick={() => decide("approve")} disabled={busy} className="ko-btn-primary h-9 px-3.5 text-[13px] inline-flex items-center gap-1.5">
                <Check size={14} /> Approve
              </button>
              <button onClick={() => setRejecting((v) => !v)} disabled={busy} className="ko-btn-ghost h-9 px-3 text-[13px] inline-flex items-center gap-1.5 text-gray-600 hover:text-red-700">
                <X size={14} /> Decline
              </button>
            </>
          )}
          {h.status === "APPROVED" && (
            <button onClick={cancel} disabled={busy} className="ko-btn-ghost h-9 px-3 text-[13px] inline-flex items-center gap-1.5 text-gray-600 hover:text-red-700">
              <Ban size={13} /> Cancel
            </button>
          )}
          {(h.status === "REJECTED" || h.status === "CANCELLED") && (
            <button onClick={remove} disabled={busy} className="ko-btn-ghost h-9 px-2.5 text-[12px] inline-flex items-center gap-1 text-gray-500 hover:text-red-700">
              <XCircle size={13} /> Delete
            </button>
          )}
        </div>
      </div>

      {rejecting && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50/50 p-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-red-800 mb-1.5">Why are you declining?</div>
          <textarea
            className="ko-input min-h-[70px] text-[13px]"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Two people are already off that week — could you shift it a few days?"
            autoFocus
          />
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => { setRejecting(false); setNote(""); }} className="ko-btn-ghost h-9 px-3 text-[12px]">Cancel</button>
            <button onClick={() => decide("reject")} disabled={busy} className="ko-btn-danger h-9 px-4 text-[12px] inline-flex items-center gap-1.5">
              {busy ? "Sending…" : <><X size={12} /> Decline request</>}
            </button>
          </div>
        </div>
      )}

      {h.decidedAt && !rejecting && (
        <div className={
          "mt-3 rounded-md border p-3 " +
          (h.status === "APPROVED" ? "bg-teal-50 border-teal-200" : "bg-gray-50 border-gray-200")
        }>
          <div className="text-[11px] uppercase tracking-[0.14em] font-semibold mb-1 text-gray-600">
            {h.status === "APPROVED" ? "Approved" : h.status === "REJECTED" ? "Declined" : "Cancelled"} by {h.decidedByName} · {fmtDate(h.decidedAt)}
          </div>
          {h.decisionNote && <p className="text-[13px] text-gray-800 whitespace-pre-wrap">{h.decisionNote}</p>}
        </div>
      )}
    </div>
  );
}

/** Full label from sm up; a shorter one on phones, where the tile is half-width. */
function Label({ short, full }: { short: string; full: string }) {
  return (
    <>
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{full}</span>
    </>
  );
}

function StatCard({ icon, label, value, tone, live }: {
  icon: React.ReactNode; label: React.ReactNode; value: number | string;
  tone: "amber" | "teal" | "emerald" | "green"; live?: boolean;
}) {
  const tones = {
    amber:   "bg-amber-50 text-amber-800 border-amber-200",
    teal:    "bg-teal-50 text-teal-800 border-teal-200",
    emerald: "bg-emerald-50 text-emerald-800 border-emerald-200",
    green:   "bg-green-50 text-green-800 border-green-200",
  };
  return (
    <div className={"ko-card p-3 border " + tones[tone]}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] font-semibold mb-1">
        <span className={live ? "ko-pulse-soft" : ""}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="font-display text-2xl leading-none">{value}</div>
    </div>
  );
}
