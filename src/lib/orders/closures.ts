/**
 * Days the shop is closed all day (ops-3): the weekly off day and the planned
 * closed dates. Pure — no database, no clock — so every rule is testable and
 * `opening-hours.ts`, the picker and the write gate all ask the same question.
 *
 * A closed day is a BUSINESS DATE, "YYYY-MM-DD" in Asia/Kolkata, and the
 * trading session that STARTS on it is what is closed (the same keying
 * `sessionStartDate` already uses, so overnight hours behave). The weekday of a
 * date string is calendar arithmetic, independent of any timezone.
 *
 * Missing reads as "no closures", on purpose and only because the mapping is
 * tested end to end (`shopStatusFromOrg`, the placeOrder integration test): a
 * shop that is never closed is what every row meant before ops-3.
 */

/** 0 = Sunday … 6 = Saturday, the calendar weekday of a business date. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export interface ClosedDateRange {
  /** Inclusive, "YYYY-MM-DD". */
  readonly startDate: string;
  /** Inclusive; equal to `startDate` for a single day. */
  readonly endDate: string;
  /** Shown to customers on the closed-day banner. Plain text. */
  readonly note: string | null;
}

export interface Closures {
  readonly weeklyClosedDays: readonly number[];
  readonly closedDates: readonly ClosedDateRange[];
}

export const NO_CLOSURES: Closures = { weeklyClosedDays: [], closedDates: [] };

/** Why a day is closed. A planned date wins over the weekly day, because it can carry the owner's note. */
export type ClosedDay =
  | { readonly source: "DATE"; readonly note: string | null }
  | { readonly source: "WEEKLY"; readonly weekday: Weekday; readonly note: null };

/** The calendar weekday of "2026-09-22" (a Tuesday → 2). */
export function weekdayOf(date: string): Weekday {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay() as Weekday;
}

/** A stored weekday list, tolerant of null/undefined and junk: only real weekdays 0–6, once each, sorted. */
export function normaliseWeekdays(raw: readonly unknown[] | null | undefined): number[] {
  if (!Array.isArray(raw)) return [];
  const valid = raw.filter((day): day is number => typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6);
  return [...new Set(valid)].sort((a, b) => a - b);
}

export function closedDay(date: string, closures: Closures | undefined): ClosedDay | null {
  if (!closures) return null;
  const planned = closures.closedDates.find((range) => date >= range.startDate && date <= range.endDate);
  if (planned) return { source: "DATE", note: planned.note };
  const weekday = weekdayOf(date);
  return closures.weeklyClosedDays.includes(weekday) ? { source: "WEEKLY", weekday, note: null } : null;
}

export function isClosedDay(date: string, closures: Closures | undefined): boolean {
  return closedDay(date, closures) !== null;
}

/** "Open daily", or "Open daily except Tuesday" / "except Tuesday and Wednesday": what the public site says about the week. */
export function openDaysLabel(closedWeekdays: readonly number[] | undefined): string {
  const days = normaliseWeekdays(closedWeekdays).map((day) => WEEKDAY_NAMES[day]);
  if (days.length === 0) return "Open daily";
  return `Open daily except ${days.length === 1 ? days[0] : `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}`}`;
}
