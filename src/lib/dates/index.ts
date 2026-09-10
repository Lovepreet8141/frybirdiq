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
export type RangeKey = "today" | "yesterday" | "7d" | "30d" | "mtd" | "lastMonth";

/**
 * Calendar months, not rolling windows.
 *
 * A profit-and-loss has to run on a calendar month because the costs do. Rent
 * is paid once on the 1st; a rolling 30-day window ending on the 2nd contains
 * two rents, and one ending on the 31st of a 31-day month contains none.
 * Either way the month looks wildly wrong for a reason nobody would guess from
 * the screen.
 */
function monthBounds(date: string): { first: string; last: string } {
  const [year, month] = date.split("-").map(Number) as [number, number, number];
  const first = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  // Day 0 of the next month is the last day of this one, leap years included.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { first, last };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function monthLabel(date: string): string {
  const [year, month] = date.split("-").map(Number) as [number, number, number];
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

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
    case "mtd": {
      const { first } = monthBounds(today);
      return {
        from: startOfBusinessDay(first),
        to: endOfBusinessDay(today),
        label: `${monthLabel(today)} so far`,
      };
    }
    case "lastMonth": {
      const { first } = monthBounds(today);
      const inPrevious = addDays(first, -1);
      const previous = monthBounds(inPrevious);
      return {
        from: startOfBusinessDay(previous.first),
        to: endOfBusinessDay(previous.last),
        label: monthLabel(inPrevious),
      };
    }
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
