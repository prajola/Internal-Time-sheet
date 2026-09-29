/**
 * The planner's month/year jump control.
 *
 * Clicking the "September 2026" heading opens this: a year stepper over
 * a 12-month grid, plus shortcuts for the periods people actually ask
 * for. Reaching last October should be two clicks, not twelve presses
 * of the back arrow.
 */
import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { MONTH_NAMES } from "../lib/planner";

const SHORT_MONTHS = MONTH_NAMES.map((m) => m.slice(0, 3));

interface Props {
  year: number;
  month: number;
  /** Year currently shown in the grid — may differ from the selected one. */
  draftYear: number;
  onDraftYear: (y: number) => void;
  onPick: (year: number, month: number) => void;
  onClose: () => void;
}

export function MonthYearPicker({ year, month, draftYear, onDraftYear, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const today = new Date();

  // Dismiss on outside click or Escape, the way a menu should behave.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const shortcuts: Array<{ label: string; year: number; month: number }> = [
    { label: "This month", year: today.getFullYear(), month: today.getMonth() },
    {
      label: "Last month",
      year: today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear(),
      month: today.getMonth() === 0 ? 11 : today.getMonth() - 1,
    },
    { label: "Same month last year", year: today.getFullYear() - 1, month: today.getMonth() },
    { label: "January this year", year: today.getFullYear(), month: 0 },
  ];

  return (
    <div
      ref={ref}
      className="absolute z-30 mt-2 w-[290px] rounded-xl border border-gray-200 bg-white p-3 shadow-lg ko-fade-in"
      role="dialog"
      aria-label="Jump to month"
    >
      {/* Year stepper */}
      <div className="flex items-center justify-between mb-2.5">
        <button
          onClick={() => onDraftYear(draftYear - 1)}
          className="ko-btn-ghost h-8 w-8 px-0 inline-flex items-center justify-center"
          aria-label="Previous year"
        >
          <ChevronLeft size={15} />
        </button>
        <div className="font-display text-[17px] tracking-tight tabular-nums">{draftYear}</div>
        <button
          onClick={() => onDraftYear(draftYear + 1)}
          className="ko-btn-ghost h-8 w-8 px-0 inline-flex items-center justify-center"
          aria-label="Next year"
        >
          <ChevronRight size={15} />
        </button>
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-3 gap-1.5">
        {SHORT_MONTHS.map((m, i) => {
          const selected = draftYear === year && i === month;
          const isThisMonth = draftYear === today.getFullYear() && i === today.getMonth();
          return (
            <button
              key={m}
              onClick={() => onPick(draftYear, i)}
              className={
                "h-9 rounded-md text-[13px] font-medium transition border " +
                (selected
                  ? "bg-brand-400 text-black border-brand-400"
                  : isThisMonth
                    ? "bg-brand-50 text-brand-800 border-brand-200"
                    : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50")
              }
            >
              {m}
            </button>
          );
        })}
      </div>

      {/* Shortcuts */}
      <div className="mt-3 pt-2.5 border-t border-gray-100 grid gap-0.5">
        {shortcuts.map((s) => {
          const active = s.year === year && s.month === month;
          return (
            <button
              key={s.label}
              onClick={() => onPick(s.year, s.month)}
              className="flex items-center justify-between gap-2 px-2 h-8 rounded-md text-[12.5px] text-gray-700 hover:bg-gray-50 text-left"
            >
              <span>{s.label}</span>
              <span className="text-gray-400 tabular-nums">
                {active ? <Check size={12} className="text-brand-700" /> : `${SHORT_MONTHS[s.month]} ${s.year}`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
