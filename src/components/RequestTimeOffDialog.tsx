/**
 * The "Request time off" modal, shared by both planner pages.
 *
 * Opens on a chosen day with a category already selected, because the
 * calendar's day menu asks "holiday or absence?" before this appears —
 * so arriving here the decision is made and only the details are left.
 */
import { useState } from "react";
import { X, ArrowRight } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "./Toast";
import {
  CATEGORY_LABEL, DEFAULT_KIND, countWorkingDays, formatDays,
  type TimeOffCategory,
} from "../lib/planner";
import type { Holiday } from "../types";

export function RequestTimeOffDialog({ prefillDate, initialCategory = "HOLIDAY", onClose, onCreated }: {
  prefillDate: string;
  /** Preselected by the calendar's day menu. */
  initialCategory?: TimeOffCategory;
  onClose: () => void;
  onCreated: (h: Holiday) => void;
}) {
  const { err } = useToast();
  const [startDate, setStartDate] = useState(prefillDate);
  const [endDate, setEndDate] = useState(prefillDate);
  const [category, setCategory] = useState<TimeOffCategory>(initialCategory);
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const kind = DEFAULT_KIND[category];

  const singleDay = startDate === endDate;
  const workingDays = countWorkingDays(startDate, endDate);
  const effectiveDays = singleDay && halfDay ? 0.5 : workingDays;
  const invalidRange = !startDate || !endDate || endDate < startDate;

  // Keep the end date from drifting behind the start date.
  function changeStart(v: string) {
    setStartDate(v);
    if (endDate < v) setEndDate(v);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (invalidRange) { err("Pick a valid date range."); return; }
    if (workingDays === 0) { err("That range is all weekend — pick at least one working day."); return; }
    setBusy(true);
    try {
      const r = await api.post<{ holiday: Holiday }>("/api/holidays", {
        action: "request",
        startDate,
        endDate,
        kind,
        halfDay: singleDay && halfDay,
        reason: reason.trim(),
      });
      onCreated(r.holiday);
    } catch (e: any) { err(e?.message || "Failed to request holiday"); }
    finally { setBusy(false); }
  }

  return (
    <div className="ko-modal-backdrop ko-fade-in">
      <div className="ko-card-glow p-4 sm:p-6 w-full max-w-lg ko-modal-body">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-display text-xl">Request time off</h2>
          <button onClick={onClose} className="ko-btn-ghost h-8 w-8 px-0 inline-flex items-center justify-center"><X size={14} /></button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {/* Category first — a planned holiday and an unplanned absence
              are different things to book, even though both need approval. */}
          <div className="grid grid-cols-2 gap-2">
            {(["HOLIDAY", "ABSENCE"] as TimeOffCategory[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={
                  "h-16 rounded-lg border px-3 text-left transition " +
                  (category === c
                    ? "bg-brand-50 border-brand-300 text-brand-900"
                    : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50")
                }
              >
                <span className="block text-[13px] font-medium">{CATEGORY_LABEL[c]}</span>
                <span className="block text-[11px] text-gray-500 mt-0.5">
                  {c === "HOLIDAY" ? "Planned time off" : "Sick, emergency, unplanned"}
                </span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">First day</div>
              <input type="date" className="ko-input h-10" value={startDate} onChange={(e) => changeStart(e.target.value)} required />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">Last day</div>
              <input type="date" className="ko-input h-10" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} required />
            </div>
          </div>

          {singleDay && (
            <label className="flex items-center gap-2 text-[13px] text-gray-700 cursor-pointer">
              <input type="checkbox" checked={halfDay} onChange={(e) => setHalfDay(e.target.checked)} className="rounded border-gray-300" />
              Half day only
            </label>
          )}

          <div className={
            "rounded-md border px-3 py-2 text-[13px] " +
            (invalidRange || workingDays === 0
              ? "bg-red-50 border-red-200 text-red-800"
              : "bg-brand-50/60 border-brand-200 text-brand-900")
          }>
            {invalidRange
              ? "The last day can't be before the first day."
              : workingDays === 0
                ? "That range covers only weekend days."
                : category === "HOLIDAY"
                  ? <>This books <strong>{formatDays(effectiveDays)}</strong> of holiday. Weekends aren't counted.</>
                  : <>This records <strong>{formatDays(effectiveDays)}</strong> of absence. Weekends aren't counted.</>}
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-1.5">Reason (optional)</div>
            <textarea
              className="ko-input min-h-[80px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Anything your admin should know — cover arrangements, contactability…"
              maxLength={500}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="ko-btn-ghost h-10 px-4 text-sm">Cancel</button>
            <button type="submit" disabled={busy || invalidRange || workingDays === 0} className="ko-btn-primary h-10 px-5 text-sm inline-flex items-center gap-1.5">
              {busy ? "Sending…" : <>Send request <ArrowRight size={14} /></>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

