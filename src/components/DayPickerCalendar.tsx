/**
 * Month calendar for picking a single day on the timesheets page.
 *
 * Unlike the bare `<input type="date">` it replaces, this shows where
 * the data actually is: every day carries the number of entries and the
 * total time logged across the currently-filtered employees, so an
 * admin can see at a glance which days have activity before clicking
 * one. Days with no entries are visibly inert.
 *
 * Grid construction (Monday-first, 6 fixed rows) is shared with the
 * planner via `monthGrid` so both calendars lay out identically.
 */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { MonthYearPicker } from "./MonthYearPicker";
import { MONTH_NAMES, WEEKDAYS, monthGrid, todayYmd } from "../lib/planner";
import { fmtMinutes } from "../lib/format";

/** Per-day rollup, keyed by YYYY-MM-DD. */
export interface DayActivity {
  count: number;
  minutes: number;
}

interface Props {
  /** Selected day, YYYY-MM-DD. Empty string means nothing picked yet. */
  value: string;
  onChange: (ymd: string) => void;
  /** Entry counts/minutes per day, already narrowed by the other filters. */
  activity: Map<string, DayActivity>;
}

export function DayPickerCalendar({ value, onChange, activity }: Props) {
  // Open on the selected day's month, or the current month when nothing
  // is selected yet.
  const initial = value || todayYmd();
  const [year, setYear] = useState(() => Number(initial.slice(0, 4)));
  const [month, setMonth] = useState(() => Number(initial.slice(5, 7)) - 1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftYear, setDraftYear] = useState(year);

  const days = useMemo(() => monthGrid(year, month), [year, month]);
  const today = todayYmd();

  function step(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  function jumpToToday() {
    const d = new Date();
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    onChange(todayYmd());
  }

  /** Total across the visible month — context for the numbers below. */
  const monthTotal = useMemo(() => {
    let count = 0;
    let minutes = 0;
    for (const day of days) {
      if (!day.inMonth) continue;
      const a = activity.get(day.ymd);
      if (a) { count += a.count; minutes += a.minutes; }
    }
    return { count, minutes };
  }, [days, activity]);

  return (
    <div className="ko-card p-3 w-full sm:w-[22rem]">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => { setDraftYear(year); setPickerOpen((o) => !o); }}
            aria-expanded={pickerOpen}
            aria-haspopup="dialog"
            className="group flex items-center gap-1.5 rounded-lg px-2 -mx-2 py-1 hover:bg-gray-50 transition"
            title="Jump to another month or year"
          >
            <span className="font-display text-base text-gray-900 tracking-tight">
              {MONTH_NAMES[month]} {year}
            </span>
            <ChevronDown
              size={14}
              className={"text-gray-400 group-hover:text-gray-700 transition " + (pickerOpen ? "rotate-180" : "")}
            />
          </button>
          {pickerOpen && (
            <MonthYearPicker
              year={year}
              month={month}
              draftYear={draftYear}
              onDraftYear={setDraftYear}
              onPick={(y, m) => { setYear(y); setMonth(m); setPickerOpen(false); }}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* px-0 is load-bearing — .ko-btn's px-4 would crush the icon. */}
          <button type="button" onClick={() => step(-1)} className="ko-btn-ghost h-8 w-8 px-0 inline-flex items-center justify-center" aria-label="Previous month">
            <ChevronLeft size={15} />
          </button>
          <button type="button" onClick={() => step(1)} className="ko-btn-ghost h-8 w-8 px-0 inline-flex items-center justify-center" aria-label="Next month">
            <ChevronRight size={15} />
          </button>
          <button type="button" onClick={jumpToToday} className="ko-btn-ghost h-8 px-2.5 text-[12px]">
            Today
          </button>
        </div>
      </div>

      {/* ── Weekday header ──────────────────────────────────── */}
      <div className="grid grid-cols-7">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1 text-center text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400">
            {d[0]}
          </div>
        ))}
      </div>

      {/* ── Day grid ────────────────────────────────────────── */}
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((day) => {
          const act = activity.get(day.ymd);
          const selected = day.ymd === value;
          const isToday = day.ymd === today;

          return (
            <button
              key={day.ymd}
              type="button"
              onClick={() => {
                onChange(day.ymd);
                // Clicking a spill-over day pulls that month into view.
                if (!day.inMonth) {
                  const d = new Date(`${day.ymd}T00:00:00`);
                  setYear(d.getFullYear());
                  setMonth(d.getMonth());
                }
              }}
              aria-pressed={selected}
              aria-label={
                `${day.ymd}${act ? ` — ${act.count} ${act.count === 1 ? "entry" : "entries"}, ${fmtMinutes(act.minutes)}` : " — no entries"}`
              }
              title={act ? `${act.count} ${act.count === 1 ? "entry" : "entries"} · ${fmtMinutes(act.minutes)}` : "No entries"}
              className={
                "relative h-11 rounded-md flex flex-col items-center justify-center transition text-[12px] " +
                (selected
                  ? "bg-brand-600 text-white shadow-sm "
                  : day.inMonth
                    ? "hover:bg-gray-100 text-gray-800 "
                    : "text-gray-300 hover:bg-gray-50 ") +
                (isToday && !selected ? "ring-1 ring-inset ring-brand-400 " : "")
              }
            >
              <span className={selected ? "font-semibold" : day.inMonth ? "" : "font-normal"}>
                {day.dayOfMonth}
              </span>
              {act ? (
                <span className={"text-[9px] leading-none mt-0.5 " + (selected ? "text-white/85" : "text-brand-700")}>
                  {fmtMinutes(act.minutes)}
                </span>
              ) : (
                <span className="h-[9px] mt-0.5" />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Footer ──────────────────────────────────────────── */}
      <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-500">
        <span>
          {monthTotal.count > 0
            ? `${monthTotal.count} ${monthTotal.count === 1 ? "entry" : "entries"} this month`
            : "No entries this month"}
        </span>
        {monthTotal.count > 0 && (
          <span className="text-brand-800 font-medium">{fmtMinutes(monthTotal.minutes)}</span>
        )}
      </div>
    </div>
  );
}
