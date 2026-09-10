/**
 * Business days.
 *
 * "Today" means today in Ambala. A server in UTC is five and a half hours
 * behind, so between midnight and 05:30 IST it would still be reporting
 * yesterday — every early-morning figure attributed to the wrong day, and the
 * error invisible because the numbers still look plausible.
 *
 * Pure, so the rule is testable without a database or a server clock.
 */

export const BUSINESS_TIMEZONE = "Asia/Kolkata";

/** The offset is fixed: India has no daylight saving. */
const IST_OFFSET_MINUTES = 5 * 60 + 30;

/** The calendar date in Ambala, as "2026-09-10". */
export function businessDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** The instant a business day starts, as a UTC Date. */
export function startOfBusinessDay(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  // Midnight IST expressed as UTC.
  return new Date(Date.UTC(year!, month! - 1, day!, 0, -IST_OFFSET_MINUTES, 0, 0));
}

export function endOfBusinessDay(date: string): Date {
  const start = startOfBusinessDay(date);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

/** Shifts a business date by whole days. `addDays("2026-09-10", -1)`. */
export function addDays(date: string, days: number): string {
  const shifted = new Date(startOfBusinessDay(date).getTime() + days * 24 * 60 * 60 * 1000);
  return businessDate(shifted);
}

export interface DateRange {
  readonly from: Date;
  readonly to: Date;
  readonly label: string;
}

/** The named ranges the dashboard offers. */
export type RangeKey = "today" | "yesterday" | "7d" | "30d";

export function resolveRange(key: RangeKey, now: Date = new Date()): DateRange {
  const today = businessDate(now);

  switch (key) {
    case "today":
      return { from: startOfBusinessDay(today), to: endOfBusinessDay(today), label: "Today" };
    case "yesterday": {
      const day = addDays(today, -1);
      return { from: startOfBusinessDay(day), to: endOfBusinessDay(day), label: "Yesterday" };
    }
    case "7d":
      return { from: startOfBusinessDay(addDays(today, -6)), to: endOfBusinessDay(today), label: "Last 7 days" };
    case "30d":
      return { from: startOfBusinessDay(addDays(today, -29)), to: endOfBusinessDay(today), label: "Last 30 days" };
  }
}

/**
 * The period immediately before a range, of equal length.
 *
 * What a delta is measured against. Comparing a part-finished today with a
 * whole yesterday flatters or damns it for no reason, which is why the
 * dashboard says what it is comparing rather than only showing an arrow.
 */
export function previousPeriod(range: DateRange): DateRange {
  const span = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - span), to: range.from, label: "the period before" };
}

/** Every business date in a range, oldest first. For charting. */
export function daysInRange(range: DateRange): string[] {
  const days: string[] = [];
  let cursor = businessDate(range.from);
  const last = businessDate(new Date(range.to.getTime() - 1));
  for (let guard = 0; guard < 400; guard++) {
    days.push(cursor);
    if (cursor === last) break;
    cursor = addDays(cursor, 1);
  }
  return days;
}
