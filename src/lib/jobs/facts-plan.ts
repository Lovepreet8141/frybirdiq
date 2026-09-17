/**
 * Which IST business days each facts job recomputes — pure date planning.
 *
 * hive/reviews/iq-1/DESIGN.md "recomputeDay … Nightly 03:00: yesterday +
 * trailing 35 days", with REVIEW.md required change 2: nothing maintains
 * `updated_at`, so freshness cannot come from watermarks. The nightly run
 * therefore recomputes every day of the current and previous month outright
 * (and never fewer than the trailing 35 days), so a late expense or refund
 * anywhere in either month is picked up within a night.
 *
 * Days are "YYYY-MM-DD" strings, processed oldest first, so a cursor (the
 * last day that committed) resumes exactly where a run stopped.
 */
import { addDays } from "@/lib/iq/metrics";

export const TRAILING_DAYS = 35;

const firstOfMonth = (date: string) => `${date.slice(0, 7)}-01`;
const previousMonthFirst = (date: string) => firstOfMonth(addDays(firstOfMonth(date), -1));

/** Every date from `from` to `to`, inclusive, oldest first. Empty when from > to. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The nightly run for `yesterday`: the earlier of the previous month's first day and the trailing 35 days, through yesterday. */
export function nightlyDates(yesterday: string): string[] {
  const trailingStart = addDays(yesterday, -(TRAILING_DAYS - 1));
  const monthStart = previousMonthFirst(yesterday);
  return datesBetween(monthStart < trailingStart ? monthStart : trailingStart, yesterday);
}

/** The months the nightly run checks against the P&L: all of the previous month, and the current month through yesterday. */
export function parityRanges(yesterday: string): { readonly from: string; readonly to: string }[] {
  const previousFirst = previousMonthFirst(yesterday);
  return [
    { from: previousFirst, to: addDays(firstOfMonth(yesterday), -1) },
    { from: firstOfMonth(yesterday), to: yesterday },
  ];
}

/** The days still to do after `cursor` (the last day that committed), or all of them without one. */
export function remainingAfter(dates: readonly string[], cursor: string | null): string[] {
  return cursor === null ? [...dates] : dates.filter((d) => d > cursor);
}

/** The IST business date a quarter-hour or day period key falls on. */
export function dateOfPeriodKey(periodKey: string): string {
  return periodKey.slice(0, 10);
}
