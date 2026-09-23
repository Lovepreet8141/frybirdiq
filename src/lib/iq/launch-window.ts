/**
 * Pre-launch exclusion (`analytics-start-date`).
 *
 * `organizations.opened_on` is the day the shop actually went live. Everything
 * recorded before it — this sprint's test orders, seeded fixtures, dry runs —
 * is not a real trading day and must not enter a trend, a baseline or a
 * readiness score by accident. By default every trend-facing read excludes it;
 * an explicit, visible `includePreLaunch` lets the owner look at the full
 * history anyway (auditing the test data itself, say).
 *
 * Deliberately narrow: this is about ANALYSIS, never about the money. Finance
 * totals, the payments ledger, GST invoices and CSV/report exports read every
 * row regardless — nothing here ever touches those paths. When `opened_on`
 * is unset there is nothing to exclude yet, so every function here is a no-op.
 */

import { type DateRange, addDays, startOfBusinessDay } from "@/lib/dates";

/** True when `date` (an IST business-date string) falls strictly before the org's Opening date. False with no Opening date set. */
export function isPreLaunch(date: string, openedOn: string | null): boolean {
  return openedOn !== null && date < openedOn;
}

/**
 * Clamps a `{from, to}` window of business-date strings (readiness, the brief)
 * so it never starts before the org's Opening date. A window that would fall
 * entirely before it collapses to zero days — `from` moves one day past `to`
 * — so an inclusive `BETWEEN from AND to` read finds nothing, rather than the
 * wrong days.
 */
export function clampSpanToLaunch<T extends { readonly from: string; readonly to: string }>(
  span: T,
  openedOn: string | null,
  includePreLaunch: boolean,
): T {
  if (includePreLaunch || openedOn === null || span.from >= openedOn) return span;
  if (span.to < openedOn) return { ...span, from: addDays(span.to, 1) };
  return { ...span, from: openedOn };
}

/**
 * The same clamp for a `DateRange` (a Date-based `{from, to}`, used by the
 * repository queries the Command Center and the P&L page read).
 */
export function clampRangeToLaunch(range: DateRange, openedOn: string | null, includePreLaunch: boolean): DateRange {
  if (includePreLaunch || openedOn === null) return range;
  const launchStart = startOfBusinessDay(openedOn);
  if (range.from >= launchStart) return range;
  if (range.to <= launchStart) return { ...range, from: range.to };
  return { ...range, from: launchStart };
}

/**
 * Every business date strictly before `openedOn`, from one day before it back
 * `lookbackDays` days — for a detector's `excludedDates` (`rules.ts`), which
 * takes a discrete list, not a predicate. `lookbackDays` only needs to cover
 * the longest baseline window a detector reads (8 weeks today); a generous
 * default costs nothing since this is a small Set built once per job run, not
 * a hot path. Empty when `openedOn` is null — nothing to exclude yet.
 */
export function preLaunchDates(openedOn: string | null, lookbackDays = 90): readonly string[] {
  if (openedOn === null) return [];
  const dates: string[] = [];
  for (let i = 1; i <= lookbackDays; i++) dates.push(addDays(openedOn, -i));
  return dates;
}
