/**
 * The download filename for a reports.export CSV.
 *
 * Pure. The dates are the IST business dates the range covers, from
 * `businessDate`, never `toISOString().slice(0, 10)`: a range starts at
 * midnight IST, which is 18:30 UTC the day before, so the UTC date would name
 * September's export "2026-08-31_to_…". `to` is exclusive, so the last covered
 * date is the one a millisecond before it.
 */

import { type DateRange, businessDate } from "@/lib/dates";

export function exportFilename(type: string, range: Pick<DateRange, "from" | "to">): string {
  const from = businessDate(range.from);
  const to = businessDate(new Date(range.to.getTime() - 1));
  return `frybird-${type}-${from}_to_${to}.csv`;
}
