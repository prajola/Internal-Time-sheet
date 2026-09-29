/**
 * Month calendar for the planner pages.
 *
 * Renders a Monday-first grid of whole weeks and stacks a chip on every
 * day that has something on it — a worked shift (green, from the user's
 * time entries) or a holiday (teal when approved, amber while pending).
 *
 * Presentation only: it owns no data and no month state. Both planner
 * pages pass the month they're showing plus the records to plot, so the
 * employee and admin views stay pixel-identical.
 */
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown, ChevronLeft, ChevronRight, Plus, RefreshCw,
} from "lucide-react";
import { MonthYearPicker } from "./MonthYearPicker";
import {
  WEEKDAYS, MONTH_NAMES, monthGrid, holidaysByDay, shiftsByDay,
  STATUS_CHIP, chipLabel, entryMinutes, type TimeOffCategory,
} from "../lib/planner";
import { fmtMinutes, fmtTime } from "../lib/format";
import type { Holiday, TimeEntry } from "../types";

/** Chips beyond this collapse into a "+N more" line so rows stay even. */
const MAX_CHIPS = 3;

interface Props {
  year: number;
  month: number;                     // 0-indexed
  holidays: Holiday[];
  entries: TimeEntry[];
  loading?: boolean;
  refreshing?: boolean;
  /** Label holiday chips with the person's name (admin's all-team view). */
  showOwner?: boolean;
  /** The plotted shifts belong to the viewer — label them "Worked Shift". */
  ownShifts?: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onRefresh: () => void;
  /** Jump straight to a month/year from the picker. */
  onJump: (year: number, month: number) => void;
  /** Rendered next to Refresh — the pages pass the Month/Year switch. */
  viewSwitch?: ReactNode;
  /**
   * Enables the day menu. Clicking a day asks holiday-or-absence first,
   * then hands both the day and the choice back to the page.
   */
  onRequestTimeOff?: (ymd: string, category: TimeOffCategory) => void;
  onSelectHoliday?: (h: Holiday) => void;
}

export function PlannerCalendar({
  year, month, holidays, entries, loading, refreshing, showOwner, ownShifts,
  onPrev, onNext, onToday, onRefresh, onJump, viewSwitch,
  onRequestTimeOff, onSelectHoliday,
}: Props) {
  const [menuDay, setMenuDay] = useState<string | null>(null);
  const days = useMemo(() => monthGrid(year, month), [year, month]);
  const hByDay = useMemo(() => holidaysByDay(holidays), [holidays]);
  const sByDay = useMemo(() => shiftsByDay(entries), [entries]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftYear, setDraftYear] = useState(year);

  function openPicker() {
    setDraftYear(year);   // always reopen on the month we're actually showing
    setPickerOpen((v) => !v);
  }

  return (
    <div className="ko-card overflow-hidden">
      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap p-4 border-b border-gray-200">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <button
              onClick={openPicker}
              aria-expanded={pickerOpen}
              aria-haspopup="dialog"
              className="group flex items-center gap-1.5 rounded-lg px-2 -mx-2 py-1 hover:bg-gray-50 transition"
              title="Jump to another month or year"
            >
              <h2 className="font-display text-xl sm:text-2xl text-gray-900 tracking-tight">
                {MONTH_NAMES[month]} {year}
              </h2>
              <ChevronDown size={16} className={"text-gray-400 group-hover:text-gray-700 transition " + (pickerOpen ? "rotate-180" : "")} />
            </button>
            {pickerOpen && (
              <MonthYearPicker
                year={year}
                month={month}
                draftYear={draftYear}
                onDraftYear={setDraftYear}
                onPick={(y, m) => { onJump(y, m); setPickerOpen(false); }}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {/* px-0 is load-bearing: .ko-btn applies px-4, which on a w-9
                button squeezes the icon down to a few pixels. */}
            <button onClick={onPrev} className="ko-btn-ghost h-9 w-9 px-0 inline-flex items-center justify-center" aria-label="Previous month">
              <ChevronLeft size={16} />
            </button>
            <button onClick={onNext} className="ko-btn-ghost h-9 w-9 px-0 inline-flex items-center justify-center" aria-label="Next month">
              <ChevronRight size={16} />
            </button>
            <button onClick={onToday} className="ko-btn-ghost h-9 px-3 text-[13px]">
              Today
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Legend />
          {viewSwitch}
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="ko-btn-ghost h-9 px-3 text-[13px] inline-flex items-center gap-1.5"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Grid ────────────────────────────────────────────── */}
      <div className="ko-table-scroll overflow-x-auto">
        <div className="min-w-0 sm:min-w-[680px]">
          <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50/70">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-1 py-2 text-center text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.08em] sm:tracking-[0.14em] text-gray-500">
                <span className="sm:hidden">{d[0]}</span>
                <span className="hidden sm:inline">{d}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {days.map((day, i) => {
              const dayHolidays = hByDay.get(day.ymd) ?? [];
              const dayShifts = sByDay.get(day.ymd) ?? [];
              const chipCount = dayHolidays.length + dayShifts.length;
              const shown = { holidays: dayHolidays, shifts: dayShifts };
              const overflow = Math.max(0, chipCount - MAX_CHIPS);

              // Trim to MAX_CHIPS, holidays first — they're the thing the
              // page is about; shifts are supporting context.
              const holidayChips = shown.holidays.slice(0, MAX_CHIPS);
              const shiftChips = shown.shifts.slice(0, Math.max(0, MAX_CHIPS - holidayChips.length));

              const clickable = !!onRequestTimeOff && day.inMonth;
              // The grid sits in an overflow container, so a menu opened
              // from a late row would be clipped — flip those upward.
              const openUp = Math.floor(i / 7) >= 4;

              return (
                <div
                  key={day.ymd}
                  onClick={clickable ? () => setMenuDay(day.ymd) : undefined}
                  className={
                    "group relative min-h-[70px] sm:min-h-[104px] border-b border-r border-gray-200 p-1 sm:p-1.5 flex flex-col gap-0.5 sm:gap-1 transition " +
                    (day.inMonth ? "bg-white" : "bg-gray-50/60 ") +
                    (day.isWeekend && day.inMonth ? "bg-gray-50/40 " : "") +
                    (clickable ? "cursor-pointer hover:bg-brand-50/50 " : "") +
                    (menuDay === day.ymd ? "bg-brand-50/70 z-20 " : "")
                  }
                  title={clickable ? "Book a holiday or report an absence on this day" : undefined}
                >
                  {menuDay === day.ymd && onRequestTimeOff && (
                    <DayMenu
                      ymd={day.ymd}
                      openUp={openUp}
                      onPick={(c) => { setMenuDay(null); onRequestTimeOff(day.ymd, c); }}
                      onClose={() => setMenuDay(null)}
                    />
                  )}

                  <div className="flex items-center justify-between">
                    {/* Hover affordance — the whole cell is clickable, but
                        nothing said so until you tried it. */}
                    {clickable ? (
                      <span className="hidden sm:inline-flex opacity-0 group-hover:opacity-100 transition text-brand-700 items-center gap-0.5 text-[10px] font-medium">
                        <Plus size={11} /> Time off
                      </span>
                    ) : <span />}
                    <span
                      className={
                        "text-[12px] leading-none px-1.5 py-1 rounded " +
                        (day.isToday
                          ? "bg-brand-500 text-black font-semibold"
                          : day.inMonth
                            ? "text-gray-700"
                            : "text-gray-300")
                      }
                    >
                      <span className="sm:hidden">{day.dayOfMonth}</span>
                      <span className="hidden sm:inline">{day.isToday ? "Today" : day.dayOfMonth}</span>
                    </span>
                  </div>

                  {loading ? (
                    day.inMonth && day.dayOfMonth % 4 === 0 ? <div className="ko-skel h-5 w-full rounded" /> : null
                  ) : (
                    <>
                      {holidayChips.map((h) => (
                        <button
                          key={h.id}
                          type="button"
                          onClick={onSelectHoliday ? (e) => { e.stopPropagation(); onSelectHoliday(h); } : undefined}
                          title={`${chipLabel(h)} — ${h.userName || h.userEmail}${h.reason ? `: ${h.reason}` : ""}`}
                          className={
                            "w-full text-left rounded h-1.5 sm:h-auto sm:text-[11px] sm:leading-tight sm:px-1.5 sm:py-1 sm:truncate " +
                            STATUS_CHIP[h.status] +
                            (onSelectHoliday ? " hover:opacity-85" : "")
                          }
                        >
                          <span className="hidden sm:inline">{showOwner
                            ? `${(h.userName || h.userEmail).split(" ")[0]} · ${chipLabel(h).replace(" Approved", "")}`
                            : chipLabel(h)}</span>
                        </button>
                      ))}

                      {shiftChips.map((e) => {
                        const live = !e.endedAt;
                        return (
                          <div
                            key={e.id}
                            title={
                              `${fmtTime(e.startedAt)}–${live ? "now" : fmtTime(e.endedAt)} · ${fmtMinutes(entryMinutes(e))}` +
                              (e.description ? ` · ${e.description}` : "")
                            }
                            className={
                              "rounded text-white flex items-center gap-1 h-1.5 sm:h-auto sm:text-[11px] sm:leading-tight sm:px-1.5 sm:py-1 " +
                              // Only the dot pulses. Fading the whole chip
                              // (what ko-pulse-soft does to opacity) washed
                              // the green out and read as disabled.
                              (live ? "bg-emerald-500 ring-1 ring-emerald-300" : "bg-emerald-600")
                            }
                          >
                            {live && <span className="hidden sm:block w-1.5 h-1.5 rounded-full bg-white ko-pulse-soft flex-shrink-0" />}
                            <span className="hidden sm:block truncate">
                              {live ? "Clocked in" : ownShifts ? "Worked Shift" : "Shift"}
                            </span>
                          </div>
                        );
                      })}

                      {overflow > 0 && (
                        <div className="hidden sm:block text-[10px] text-gray-500 px-1">+{overflow} more</div>
                      )}

                      {/* Total time on the day, so a cell with several
                          clock-in/out pairs still reads at a glance. */}
                      {dayShifts.length > 0 && (
                        <div className="hidden sm:block text-[10px] text-gray-500 px-1 mt-auto">
                          {fmtMinutes(dayShifts.reduce((sum, e) => sum + entryMinutes(e), 0))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The popover a day cell opens on click: name the day, then offer the
 * two things you can book on it. Asking holiday-or-absence here means
 * the request form opens already on the right tab.
 */
function DayMenu({ ymd, openUp, onPick, onClose }: {
  ymd: string;
  /** Open above the cell instead of below, for rows near the grid's end. */
  openUp?: boolean;
  onPick: (category: TimeOffCategory) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    // Deferred so the click that opened the menu doesn't immediately close it.
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const label = new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "long",
  });

  const options: Array<{ c: TimeOffCategory; title: string; hint: string }> = [
    { c: "HOLIDAY", title: "Request holiday", hint: "Planned time off" },
    { c: "ABSENCE", title: "Request absence", hint: "Sick, emergency, unplanned" },
  ];

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      className={
        // On a phone this is a bottom sheet: the grid sits in a scroll
        // container that would clip an absolutely-positioned popover,
        // and a 210px card doesn't fit beside a 50px day cell anyway.
        "z-50 rounded-xl border border-gray-200 bg-white p-2 shadow-lg ko-fade-in " +
        "fixed inset-x-3 bottom-3 " +
        "sm:absolute sm:z-30 sm:inset-x-auto sm:bottom-auto sm:w-[210px] sm:left-1/2 sm:-translate-x-1/2 " +
        (openUp ? "sm:bottom-8 sm:top-auto" : "sm:top-8")
      }
      role="menu"
    >
      <div className="px-3 sm:px-1.5 pb-2 sm:pb-1.5 mb-1 border-b border-gray-100 text-[12px] sm:text-[11px] font-medium text-gray-500">
        {label}
      </div>
      {options.map((o) => (
        <button
          key={o.c}
          role="menuitem"
          onClick={() => onPick(o.c)}
          className="w-full text-left px-3 py-3 sm:px-2 sm:py-2 rounded-lg hover:bg-brand-50 active:bg-brand-50 transition"
        >
          <span className="block text-[14px] sm:text-[13px] font-medium text-gray-900">{o.title}</span>
          <span className="block text-[11px] text-gray-500">{o.hint}</span>
        </button>
      ))}
    </div>
  );
}

function Legend() {
  const items = [
    { cls: "bg-emerald-600", label: "Worked shift", live: false },
    { cls: "bg-emerald-500 ring-1 ring-emerald-300", label: "Clocked in", live: true },
    { cls: "bg-teal-600", label: "Approved", live: false },
    { cls: "bg-amber-500", label: "Pending", live: false },
  ];
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5 text-[11px] text-gray-600">
          <span className={"w-2.5 h-2.5 rounded-sm flex items-center justify-center " + i.cls}>
            {i.live && <span className="w-1 h-1 rounded-full bg-white ko-pulse-soft" />}
          </span>
          {i.label}
        </span>
      ))}
    </div>
  );
}
