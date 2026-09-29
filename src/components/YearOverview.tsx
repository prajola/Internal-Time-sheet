/**
 * A year of attendance on one screen.
 *
 * Twelve cards, one per month, each showing days worked, hours logged
 * and approved leave, with a bar scaled against that month's available
 * working days — so a thin January next to a full March is legible at
 * a glance. Clicking a month drops into its calendar.
 */
import { CalendarCheck, CalendarDays, ChevronLeft, ChevronRight, CircleAlert, Clock } from "lucide-react";
import { MONTH_NAMES, workingDaysInMonth, formatDays } from "../lib/planner";
import { fmtMinutes } from "../lib/format";
import type { MonthSummary } from "../lib/planner";

interface Props {
  year: number;
  months: MonthSummary[];
  /** Highlight the month the calendar view is currently on. */
  selectedMonth: number;
  /** Team views count person-days across everyone rather than one person's days. */
  team?: boolean;
  loading?: boolean;
  onPrevYear: () => void;
  onNextYear: () => void;
  onSelectMonth: (month: number) => void;
}

export function YearOverview({
  year, months, selectedMonth, team, loading,
  onPrevYear, onNextYear, onSelectMonth,
}: Props) {
  const today = new Date();
  const totals = months.reduce(
    (a, m) => ({
      workedDays: a.workedDays + m.workedDays,
      minutes: a.minutes + m.minutes,
      holidayDays: a.holidayDays + m.holidayDays,
      absenceDays: a.absenceDays + m.absenceDays,
    }),
    { workedDays: 0, minutes: 0, holidayDays: 0, absenceDays: 0 },
  );
  const busiest = months.reduce((max, m) => Math.max(max, m.workedDays), 0);

  return (
    <div className="ko-card overflow-hidden">
      {/* ── Year header ─────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap p-4 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <button onClick={onPrevYear} className="ko-btn-ghost h-9 w-9 px-0 inline-flex items-center justify-center" aria-label="Previous year">
            <ChevronLeft size={16} />
          </button>
          <h2 className="font-display text-xl sm:text-2xl text-gray-900 tracking-tight tabular-nums min-w-[72px] text-center">
            {year}
          </h2>
          <button onClick={onNextYear} className="ko-btn-ghost h-9 w-9 px-0 inline-flex items-center justify-center" aria-label="Next year">
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] sm:text-[12px]">
          <Total icon={<CalendarDays size={13} />} label={team ? "person-days worked" : "days worked"} value={totals.workedDays} />
          <Total icon={<Clock size={13} />} label="logged" value={fmtMinutes(totals.minutes)} />
          <Total icon={<CalendarCheck size={13} />} label="holiday" value={formatDays(totals.holidayDays).replace(/ days?$/, "")} />
          <Total icon={<CircleAlert size={13} />} label="absence" value={formatDays(totals.absenceDays).replace(/ days?$/, "")} />
        </div>
      </div>

      {/* ── Month cards ─────────────────────────────────────── */}
      <div className="p-2.5 sm:p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-2.5">
        {months.map((m) => {
          const scale = workingDaysInMonth(year, m.month);
          // Bar is relative to available working days, but never lets the
          // busiest month overflow if someone logged weekend shifts.
          const pct = Math.min(100, Math.round((m.workedDays / Math.max(scale, busiest, 1)) * 100));
          const isSelected = m.month === selectedMonth;
          const isFuture =
            year > today.getFullYear() ||
            (year === today.getFullYear() && m.month > today.getMonth());
          const empty = m.workedDays === 0 && m.holidayDays === 0 && m.absenceDays === 0;

          return (
            <button
              key={m.month}
              onClick={() => onSelectMonth(m.month)}
              className={
                "text-left rounded-lg border p-3 transition " +
                (isSelected
                  ? "border-brand-300 bg-brand-50/60 ring-1 ring-brand-200"
                  : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50")
              }
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[13px] font-medium text-gray-900">{MONTH_NAMES[m.month]}</span>
                {m.hasOpen && <span className="w-2 h-2 rounded-full bg-emerald-500 ko-pulse-soft flex-shrink-0" title="Someone is clocked in" />}
              </div>

              {loading ? (
                <div className="ko-skel h-9 w-full rounded" />
              ) : empty ? (
                <div className="text-[12px] text-gray-400 h-9 flex items-center">
                  {isFuture ? "—" : "No shifts"}
                </div>
              ) : (
                <>
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-display text-2xl leading-none text-gray-900 tabular-nums">{m.workedDays}</span>
                    <span className="text-[11px] text-gray-500">
                      {team ? "person-days" : m.workedDays === 1 ? "day" : "days"}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                  </div>
                </>
              )}

              <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-gray-500">
                <span className="tabular-nums">
                  {m.minutes > 0 ? fmtMinutes(m.minutes) : ""}
                  {team && m.people > 0 && ` · ${m.people} ${m.people === 1 ? "person" : "people"}`}
                </span>
                <span className="flex items-center gap-1">
                  {m.holidayDays > 0 && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-800 border border-teal-200"
                          title={`${m.holidayDays} day(s) of approved holiday`}>
                      <CalendarCheck size={9} /> {formatDays(m.holidayDays).replace(/ days?$/, "")}
                    </span>
                  )}
                  {m.absenceDays > 0 && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200"
                          title={`${m.absenceDays} day(s) of approved absence`}>
                      <CircleAlert size={9} /> {formatDays(m.absenceDays).replace(/ days?$/, "")}
                    </span>
                  )}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Total({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-gray-600">
      <span className="text-gray-400">{icon}</span>
      <strong className="font-display text-[15px] text-gray-900 tabular-nums">{value}</strong>
      {label}
    </span>
  );
}
