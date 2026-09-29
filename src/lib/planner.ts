/**
 * Date helpers for the planner calendar.
 *
 * The grid is Monday-first and always renders whole weeks, so a month
 * view spills into the trailing days of the previous month and the
 * leading days of the next one.
 *
 * Everything is keyed on plain `YYYY-MM-DD` strings rather than Date
 * objects: holidays are whole-day facts, and string keys compare and
 * sort correctly without dragging timezones into it.
 */
import type { Holiday, HolidayKind, HolidayStatus, TimeEntry } from "../types";

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export interface CalendarDay {
  ymd: string;            // YYYY-MM-DD
  dayOfMonth: number;
  inMonth: boolean;       // false for the spill-over days either side
  isWeekend: boolean;
  isToday: boolean;
}

export function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayYmd(): string {
  return ymd(new Date());
}

/** Add `n` days to a YYYY-MM-DD string, returning a YYYY-MM-DD string. */
export function addDays(dateYmd: string, n: number): string {
  const d = new Date(`${dateYmd}T00:00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/**
 * Build the Monday-first grid for `year`/`month` (month is 0-indexed),
 * padded to whole weeks. Always 6 rows so the calendar doesn't jump
 * height as the user pages through months.
 */
export function monthGrid(year: number, month: number): CalendarDay[] {
  const first = new Date(year, month, 1);
  // JS weeks start Sunday; shift so Monday === 0.
  const leading = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - leading);

  const today = todayYmd();
  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const dow = d.getDay();
    const key = ymd(d);
    days.push({
      ymd: key,
      dayOfMonth: d.getDate(),
      inMonth: d.getMonth() === month && d.getFullYear() === year,
      isWeekend: dow === 0 || dow === 6,
      isToday: key === today,
    });
  }
  return days;
}

/**
 * Working days (Mon–Fri) in an inclusive range — mirrors the same
 * calculation the API does, so the request form can preview the number
 * the server will end up storing.
 */
export function countWorkingDays(startYmd: string, endYmd: string): number {
  if (!startYmd || !endYmd || endYmd < startYmd) return 0;
  let count = 0;
  let cur = startYmd;
  for (let i = 0; i < 400 && cur <= endYmd; i++) {
    const dow = new Date(`${cur}T00:00:00`).getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur = addDays(cur, 1);
  }
  return count;
}

/** Every YYYY-MM-DD a holiday covers, inclusive of both ends. */
export function holidayDates(h: Holiday): string[] {
  const out: string[] = [];
  let cur = h.startDate;
  // Guard against a malformed record spinning forever.
  for (let i = 0; i < 400 && cur <= h.endDate; i++) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/** Index holidays by the days they cover, for O(1) lookup per cell. */
export function holidaysByDay(items: Holiday[]): Map<string, Holiday[]> {
  const map = new Map<string, Holiday[]>();
  for (const h of items) {
    for (const day of holidayDates(h)) {
      const list = map.get(day);
      if (list) list.push(h);
      else map.set(day, [h]);
    }
  }
  return map;
}

/** Index worked shifts by day. `startedAt` is an ISO datetime. */
export function shiftsByDay<T extends { startedAt: string }>(entries: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const e of entries) {
    // Convert to the viewer's local day — a shift started at 23:00 UTC
    // belongs to the day the employee actually worked it.
    const day = ymd(new Date(e.startedAt));
    const list = map.get(day);
    if (list) list.push(e);
    else map.set(day, [e]);
  }
  return map;
}

/* ── Worked-time stats ────────────────────────────────────────
 * "Days worked" counts distinct calendar days that have at least one
 * time entry — not the number of entries. Someone who clocks in and
 * out three times on a Tuesday has worked one day, not three.
 *
 * An open entry (no `endedAt`) is the person's live clock-in. It counts
 * toward the day immediately, and its minutes accrue from `startedAt`
 * to now, so the planner reflects a clock-in the moment it happens
 * rather than only once they clock out.
 */

export interface WorkedStats {
  days: number;
  minutes: number;
  /** The currently-running shift, if the person is clocked in. */
  open: TimeEntry | null;
}

/** Minutes on one entry — live elapsed time while it's still open. */
export function entryMinutes(e: TimeEntry, now: number = Date.now()): number {
  if (e.endedAt) return e.durationMinutes ?? 0;
  const started = new Date(e.startedAt).getTime();
  if (isNaN(started)) return 0;
  return Math.max(0, Math.round((now - started) / 60000));
}

/** Distinct local calendar days covered by these entries. */
export function workedDayKeys(entries: TimeEntry[]): Set<string> {
  const days = new Set<string>();
  for (const e of entries) days.add(ymd(new Date(e.startedAt)));
  return days;
}

export function workedStats(entries: TimeEntry[], now: number = Date.now()): WorkedStats {
  let minutes = 0;
  for (const e of entries) minutes += entryMinutes(e, now);
  return {
    days: workedDayKeys(entries).size,
    minutes,
    open: entries.find((e) => !e.endedAt) ?? null,
  };
}

/** Per-user roll-up for the admin's team table. */
export interface UserWorkedStats extends WorkedStats {
  userId: string;
}

export function workedStatsByUser(entries: TimeEntry[], now: number = Date.now()): Map<string, UserWorkedStats> {
  const byUser = new Map<string, TimeEntry[]>();
  for (const e of entries) {
    const list = byUser.get(e.userId);
    if (list) list.push(e);
    else byUser.set(e.userId, [e]);
  }
  const out = new Map<string, UserWorkedStats>();
  for (const [userId, list] of byUser) {
    out.set(userId, { userId, ...workedStats(list, now) });
  }
  return out;
}

/* ── Year-at-a-glance ─────────────────────────────────────────
 * Rolling up a whole year so someone can see last year's attendance
 * without clicking `‹` twelve times. Both planner pages fetch a full
 * year of entries in one request and slice it locally, so paging
 * between months inside a year costs nothing.
 */

export interface MonthSummary {
  month: number;          // 0-indexed
  workedDays: number;     // distinct days; for a team, person-days
  minutes: number;
  holidayDays: number;    // approved planned leave, weekends excluded
  absenceDays: number;    // approved unplanned absence
  people: number;         // distinct people with a shift (team views)
  hasOpen: boolean;       // someone is clocked in right now
}

/** Entries falling in a given local month. */
export function entriesInMonth<T extends { startedAt: string }>(
  entries: T[], year: number, month: number,
): T[] {
  return entries.filter((e) => {
    const d = new Date(e.startedAt);
    return d.getFullYear() === year && d.getMonth() === month;
  });
}

/**
 * Approved leave days landing in a month. Counts per-day rather than
 * per-request so a holiday spanning a month boundary is split across
 * both months instead of being attributed wholly to its start.
 */
export function holidayDaysInMonth(
  holidays: Holiday[], year: number, month: number, category?: TimeOffCategory,
): number {
  let total = 0;
  for (const h of holidays) {
    if (h.status !== "APPROVED") continue;
    if (category && holidayCategory(h.kind) !== category) continue;
    for (const day of holidayDates(h)) {
      const d = new Date(`${day}T00:00:00`);
      if (d.getFullYear() !== year || d.getMonth() !== month) continue;
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue;
      total += h.halfDay ? 0.5 : 1;
    }
  }
  return total;
}

export function yearSummary(
  year: number,
  entries: TimeEntry[],
  holidays: Holiday[],
  now: number = Date.now(),
): MonthSummary[] {
  return Array.from({ length: 12 }, (_, month) => {
    const slice = entriesInMonth(entries, year, month);
    const perUser = workedStatsByUser(slice, now);
    // Summing per-user distinct days gives person-days on a team view
    // and, for one person, simply their own day count.
    let workedDays = 0;
    let minutes = 0;
    let hasOpen = false;
    for (const s of perUser.values()) {
      workedDays += s.days;
      minutes += s.minutes;
      if (s.open) hasOpen = true;
    }
    return {
      month,
      workedDays,
      minutes,
      holidayDays: holidayDaysInMonth(holidays, year, month, "HOLIDAY"),
      absenceDays: holidayDaysInMonth(holidays, year, month, "ABSENCE"),
      people: perUser.size,
      hasOpen,
    };
  });
}

/** Working days (Mon–Fri) in a calendar month — the bar's full scale. */
export function workingDaysInMonth(year: number, month: number): number {
  let count = 0;
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

/* ── Holiday vs absence ───────────────────────────────────────
 * A planned holiday and an unplanned absence go through the same
 * request → approve flow, but they aren't the same thing to the person
 * booking one or the admin reading the calendar, so they're labelled
 * and counted separately.
 */

export type TimeOffCategory = "HOLIDAY" | "ABSENCE";

export function holidayCategory(kind: HolidayKind): TimeOffCategory {
  return kind === "ANNUAL" || kind === "UNPAID" ? "HOLIDAY" : "ABSENCE";
}

export const CATEGORY_LABEL: Record<TimeOffCategory, string> = {
  HOLIDAY: "Holiday",
  ABSENCE: "Absence",
};

/**
 * The kind stored for each category.
 *
 * The request form asks one question — holiday or absence — and nothing
 * more; the free-text reason covers the rest. The other kinds stay in
 * the type union so records created before this simplification (and any
 * written straight into Airtable) still read back correctly.
 */
export const DEFAULT_KIND: Record<TimeOffCategory, HolidayKind> = {
  HOLIDAY: "ANNUAL",
  ABSENCE: "OTHER",
};

/**
 * A type worth naming next to the category, or "" when it adds nothing.
 * "Holiday · Annual leave" is noise; "Absence · Sick" is not.
 */
export function kindDetail(kind: HolidayKind): string {
  const category = holidayCategory(kind);
  return kind === DEFAULT_KIND[category] ? "" : KIND_LABEL[kind];
}

export const KIND_LABEL: Record<HolidayKind, string> = {
  ANNUAL: "Annual leave",
  UNPAID: "Unpaid leave",
  SICK: "Sick",
  EMERGENCY: "Emergency / personal",
  OTHER: "Other absence",
};


const STATUS_WORD: Record<HolidayStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Declined",
  CANCELLED: "Cancelled",
};

/** Just the status word — used in badges next to a separate type chip. */
export function statusWord(status: HolidayStatus): string {
  return STATUS_WORD[status];
}

/** Full calendar-chip label, e.g. "Absence Approved". */
export function chipLabel(h: Holiday): string {
  return `${CATEGORY_LABEL[holidayCategory(h.kind)]} ${STATUS_WORD[h.status]}`;
}

/** Chip colours on the calendar — teal for approved, matching the brief. */
export const STATUS_CHIP: Record<HolidayStatus, string> = {
  PENDING: "bg-amber-500 text-white",
  APPROVED: "bg-teal-600 text-white",
  REJECTED: "bg-red-400 text-white line-through",
  CANCELLED: "bg-gray-400 text-white line-through",
};

/** Badge colours for the request lists (lighter, bordered). */
export const STATUS_BADGE: Record<HolidayStatus, string> = {
  PENDING: "bg-amber-50 text-amber-800 border-amber-200",
  APPROVED: "bg-teal-50 text-teal-800 border-teal-200",
  REJECTED: "bg-red-50 text-red-800 border-red-200",
  CANCELLED: "bg-gray-100 text-gray-600 border-gray-200",
};

/** "23 Sep" / "23 Sep → 25 Sep 2026" for request-list rows. */
export function formatRange(h: Holiday): string {
  const fmt = (s: string, withYear: boolean) =>
    new Date(`${s}T00:00:00`).toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
    });
  if (h.startDate === h.endDate) {
    return `${fmt(h.startDate, true)}${h.halfDay ? " · half day" : ""}`;
  }
  return `${fmt(h.startDate, false)} → ${fmt(h.endDate, true)}`;
}

export function formatDays(days: number): string {
  const n = Number.isInteger(days) ? days : days.toFixed(1);
  return `${n} day${days === 1 ? "" : "s"}`;
}
