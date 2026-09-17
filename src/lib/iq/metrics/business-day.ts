/**
 * The business day, as the metric layer sees it.
 *
 * A business day is the IST calendar date of an instant, [00:00, 24:00) IST.
 * `src/lib/dates` is the only module that computes it; this file re-exports
 * it and adds the matching SQL expression, so a fact query buckets rows on
 * exactly the day the TypeScript side names. No timezone logic lives here.
 *
 * Never slice `toISOString()` to get a business date: that is the UTC date,
 * which is the previous day from 00:00 to 05:30 IST (D4).
 */

import { addDays, BUSINESS_TIMEZONE, businessDate, endOfBusinessDay, startOfBusinessDay } from "@/lib/dates";

export { addDays, BUSINESS_TIMEZONE, businessDate, endOfBusinessDay, startOfBusinessDay };

/** A column reference: `created_at` or `o.created_at`. Nothing else is interpolated into SQL. */
const COLUMN_REFERENCE = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;

/**
 * The Postgres expression for a `timestamptz` column's business date:
 * `(created_at AT TIME ZONE 'Asia/Kolkata')::date`. Agrees with
 * `businessDate()` for every instant (see business-day.test.ts).
 *
 * Only for `timestamptz` columns. On a `timestamp without time zone`,
 * `AT TIME ZONE` converts the other way and the date is wrong. Throws on
 * anything that is not a plain column reference.
 */
export function businessDateSql(column: string): string {
  if (!COLUMN_REFERENCE.test(column)) {
    throw new RangeError(`metrics: "${column}" is not a column reference`);
  }
  return `(${column} AT TIME ZONE '${BUSINESS_TIMEZONE}')::date`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 0 = Monday … 6 = Sunday, for a "YYYY-MM-DD" calendar date. Calendar arithmetic only. */
function mondayIndex(date: string): number {
  if (!ISO_DATE.test(date)) throw new RangeError(`metrics: "${date}" is not a YYYY-MM-DD date`);
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

export interface BusinessWeek {
  /** The Monday, "YYYY-MM-DD". */
  readonly start: string;
  /** The Sunday, "YYYY-MM-DD", inclusive. */
  readonly end: string;
}

/** The Mon–Sun IST week a business date falls in (I5). */
export function businessWeek(date: string): BusinessWeek {
  const start = addDays(date, -mondayIndex(date));
  return { start, end: addDays(start, 6) };
}
