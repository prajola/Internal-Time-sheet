/**
 * My Planner — the employee's month view.
 *
 * Shows their own worked shifts and holidays on one calendar, and is
 * where they book time off. Clicking any day in the current month opens
 * the request form pre-filled with that date.
 */
import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays, Plus, X, ArrowRight, CalendarClock, Ban,
  BriefcaseBusiness, Timer, CalendarCheck, CircleAlert,
} from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { PlannerCalendar } from "../components/PlannerCalendar";
import { RequestTimeOffDialog } from "../components/RequestTimeOffDialog";
import {
  CATEGORY_LABEL, MONTH_NAMES, STATUS_BADGE, entriesInMonth, entryMinutes,
  formatDays, formatRange, holidayCategory, kindDetail, statusWord, todayYmd,
  workedStats, yearSummary, type TimeOffCategory,
} from "../lib/planner";
import { YearOverview } from "../components/YearOverview";
import { ViewSwitch, type PlannerView } from "../components/ViewSwitch";
import { fmtDate, fmtMinutes, fmtTime } from "../lib/format";
import type { Holiday, HolidayKind, TimeEntry } from "../types";

export default function MyPlanner() {
  const { ok, err } = useToast();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /** Open request form: which day, and which tab the day menu chose. */
  const [requesting, setRequesting] = useState<{ date: string; category: TimeOffCategory } | null>(null);
  const [view, setView] = useState<PlannerView>("month");

  /**
   * Shifts are fetched a whole year at a time and sliced locally. That
   * makes paging between months instant and gives the year view its
   * data for free — only crossing a year boundary costs a request.
   */
  async function load(opts: { quiet?: boolean } = {}) {
    if (opts.quiet) setRefreshing(true); else setLoading(true);
    try {
      // Holidays unfiltered — the request list below shows every one,
      // and each view filters to the period it's showing.
      const [h, e] = await Promise.all([
        api.get<{ holidays: Holiday[] }>("/api/holidays"),
        api.get<{ entries: TimeEntry[] }>(`/api/time-entries?year=${year}`),
      ]);
      setHolidays(h.holidays);
      setEntries(e.entries);
    } catch (e: any) {
      err(e?.message || "Failed to load your planner");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, [year]);

  /**
   * Keep the current month live: a clock-in should land on the calendar
   * without the user reloading. Only the month that's actually running
   * polls — paging back to March doesn't need a heartbeat. `tick` also
   * re-renders so an open shift's elapsed time keeps climbing between
   * fetches.
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

  // `tick` is a deliberate dependency — it's what advances the live timer.
  const worked = useMemo(() => workedStats(monthEntries), [monthEntries, tick]);
  const months = useMemo(() => yearSummary(year, entries, holidays), [year, entries, holidays, tick]);

  const counts = useMemo(() => {
    const approvedThisYear = holidays.filter(
      (h) => h.status === "APPROVED" && h.startDate.slice(0, 4) === String(year),
    );
    const sum = (c: TimeOffCategory) => approvedThisYear
      .filter((h) => holidayCategory(h.kind) === c)
      .reduce((t, h) => t + h.days, 0);
    return {
      pending: holidays.filter((h) => h.status === "PENDING").length,
      holidayDays: sum("HOLIDAY"),
      absenceDays: sum("ABSENCE"),
    };
  }, [holidays, year]);

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

  return (
    <div>
      <PageHeader
        icon={<CalendarDays size={18} />}
        eyebrow="My space"
        title="My Planner"
        description="Your worked shifts and time off on one calendar. Click any day to book a holiday or report an absence — an admin reviews it and you'll get a notification either way."
        actions={
          <button
            onClick={() => setRequesting({ date: todayYmd(), category: "HOLIDAY" })}
            className="ko-btn-primary h-10 px-4 text-sm inline-flex items-center gap-1.5"
          >
            <Plus size={15} /> Request time off
          </button>
        }
      />

      {worked.open && (
        <div className="ko-card p-3 mb-4 border-emerald-200 bg-emerald-50/60 flex items-center gap-2.5 flex-wrap">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 ko-pulse-soft flex-shrink-0" />
          <span className="text-[13px] text-emerald-900">
            You're clocked in since <strong>{fmtTime(worked.open.startedAt)}</strong> —{" "}
            <strong>{fmtMinutes(entryMinutes(worked.open))}</strong> so far. Today already counts as a worked day.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3 mb-5">
        <StatCard tone="emerald" icon={<BriefcaseBusiness size={14} />}
          label={<Label short="Days worked" full={`Days worked in ${MONTH_NAMES[month]}`} />} value={worked.days} />
        <StatCard tone="blue" icon={<Timer size={14} />}
          label={counts.pending > 0
            ? <Label short="Awaiting" full="Awaiting approval" />
            : <Label short="Hours" full={`Hours in ${MONTH_NAMES[month]}`} />}
          value={counts.pending > 0 ? counts.pending : fmtMinutes(worked.minutes)} />
        <StatCard tone="teal" icon={<CalendarCheck size={14} />}
          label={<Label short="Holiday days" full={`Holiday days in ${year}`} />} value={counts.holidayDays} />
        <StatCard tone="amber" icon={<CircleAlert size={14} />}
          label={<Label short="Absence days" full={`Absence days in ${year}`} />} value={counts.absenceDays} />
      </div>

      {view === "month" ? (
        <PlannerCalendar
          year={year}
          month={month}
          ownShifts
          holidays={holidays}
          entries={monthEntries}
          loading={loading}
          refreshing={refreshing}
          viewSwitch={switcher}
          onPrev={goPrev}
          onNext={goNext}
          onToday={goToday}
          onJump={jump}
          onRefresh={() => load({ quiet: true })}
          onRequestTimeOff={(date, category) => setRequesting({ date, category })}
        />
      ) : (
        <>
          <div className="flex justify-end mb-2">{switcher}</div>
          <YearOverview
            year={year}
            months={months}
            selectedMonth={month}
            loading={loading}
            onPrevYear={() => setYear((y) => y - 1)}
            onNextYear={() => setYear((y) => y + 1)}
            onSelectMonth={(m) => { setMonth(m); setView("month"); }}
          />
        </>
      )}

      <h2 className="ko-h2 mt-8 mb-3">My requests</h2>
      {loading ? (
        <div className="grid gap-3">{[1, 2].map((i) => <div key={i} className="ko-skel h-20 w-full" />)}</div>
      ) : holidays.length === 0 ? (
        <div className="ko-card">
          <EmptyState
            icon={<CalendarDays size={20} />}
            title="No time off booked yet"
            description="Request time off and it'll appear here with its approval status."
            action={
              <button onClick={() => setRequesting({ date: todayYmd(), category: "HOLIDAY" })} className="ko-btn-primary h-10 px-4 text-sm inline-flex items-center gap-1.5">
                <Plus size={15} /> Request time off
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid gap-3">
          {holidays.map((h) => (
            <RequestCard
              key={h.id}
              h={h}
              onChanged={(next) => setHolidays((ls) => ls.map((x) => (x.id === next.id ? next : x)))}
              onDeleted={(id) => setHolidays((ls) => ls.filter((x) => x.id !== id))}
            />
          ))}
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
            ok("Holiday requested. An admin will review it.");
          }}
        />
      )}
    </div>
  );
}

function RequestCard({ h, onChanged, onDeleted }: {
  h: Holiday;
  onChanged: (h: Holiday) => void;
  onDeleted: (id: string) => void;
}) {
  const { ok, err } = useToast();
  const [busy, setBusy] = useState(false);

  // Can still be withdrawn while it's pending, or approved but not started.
  const canCancel =
    (h.status === "PENDING" || h.status === "APPROVED") && h.startDate >= todayYmd();

  async function cancel() {
    if (!confirm("Withdraw this holiday request?")) return;
    setBusy(true);
    try {
      const r = await api.post<{ holiday: Holiday }>("/api/holidays", { action: "cancel", id: h.id });
      onChanged(r.holiday);
      ok("Request withdrawn.");
    } catch (e: any) { err(e?.message || "Failed to cancel"); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm("Delete this request from your history?")) return;
    setBusy(true);
    try {
      await api.post("/api/holidays", { action: "delete", id: h.id });
      onDeleted(h.id);
      ok("Deleted.");
    } catch (e: any) { err(e?.message || "Failed to delete"); }
    finally { setBusy(false); }
  }

  return (
    <div className="ko-card p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <StatusBadge h={h} />
            <span className="text-[11px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200">
              {CATEGORY_LABEL[holidayCategory(h.kind)]}{kindDetail(h.kind) && ` · ${kindDetail(h.kind)}`}
            </span>
          </div>
          <div className="text-[15px] font-medium text-gray-900">
            {formatRange(h)} <span className="text-gray-400 font-normal">· {formatDays(h.days)}</span>
          </div>
          {h.reason && <p className="text-[13px] text-gray-600 mt-1 whitespace-pre-wrap">{h.reason}</p>}
        </div>

        <div className="flex items-center gap-2">
          {canCancel && (
            <button onClick={cancel} disabled={busy} className="ko-btn-ghost h-8 px-2.5 text-[12px] inline-flex items-center gap-1 text-gray-500 hover:text-red-700">
              <Ban size={12} /> Withdraw
            </button>
          )}
          {(h.status === "REJECTED" || h.status === "CANCELLED") && (
            <button onClick={remove} disabled={busy} className="ko-btn-ghost h-8 px-2.5 text-[12px] inline-flex items-center gap-1 text-gray-500 hover:text-red-700">
              <X size={12} /> Delete
            </button>
          )}
        </div>
      </div>

      {h.decidedAt && (
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

function StatusBadge({ h }: { h: Holiday }) {
  return (
    <span className={"inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-full border " + STATUS_BADGE[h.status]}>
      {statusWord(h.status)}
    </span>
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

function StatCard({ icon, label, value, tone }: {
  icon: React.ReactNode; label: React.ReactNode; value: number | string;
  tone: "amber" | "teal" | "emerald" | "blue";
}) {
  const tones = {
    amber:   "bg-amber-50 text-amber-800 border-amber-200",
    teal:    "bg-teal-50 text-teal-800 border-teal-200",
    emerald: "bg-emerald-50 text-emerald-800 border-emerald-200",
    blue:    "bg-blue-50 text-blue-800 border-blue-200",
  };
  return (
    <div className={"ko-card p-3 border " + tones[tone]}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] font-semibold mb-1">
        {icon} <span className="truncate">{label}</span>
      </div>
      <div className="font-display text-2xl leading-none">{value}</div>
    </div>
  );
}
