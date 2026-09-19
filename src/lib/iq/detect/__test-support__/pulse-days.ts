/** PulseDay fixtures: a Friday with 11:30–23:00 hours and flat baseline buckets. */
import { observed } from "@/lib/iq/engine/observed-factory";

import { baselineDates } from "../baseline";
import { pulseDayFrom, type IntradayRow, type PulseDay } from "../pulse";

export const D = "2026-09-11";
export const HOURS = { opening: "11:30", closing: "23:00" } as const;
export const OPEN = 690;
export const CLOSE = 1380;

export type BucketValues = { orders?: bigint; revenue?: bigint; tickets?: bigint; seconds?: bigint };

/** A day with the same values in every bucket from opening to closing, then `override(minute)` applied. */
export function pulseDay(date: string, base: BucketValues, override: (minute: number) => BucketValues | null = () => null, computed = true): PulseDay {
  const rows: IntradayRow[] = [];
  for (let minute = OPEN; minute < CLOSE; minute += 15) {
    const v = { ...base, ...(override(minute) ?? {}) };
    rows.push({ startMinute: minute, metricId: "orders_paid", value: v.orders ?? 0n });
    rows.push({ startMinute: minute, metricId: "revenue_net", value: v.revenue ?? 0n });
    rows.push({ startMinute: minute, metricId: "tickets_ready", value: v.tickets ?? 0n });
    rows.push({ startMinute: minute, metricId: "ticket_ready_seconds_total", value: v.seconds ?? 0n });
  }
  return pulseDayFrom(date, computed, rows, observed);
}

export const NORMAL: BucketValues = { orders: 4n, revenue: 100000n, tickets: 4n, seconds: 2400n };

export function flatBaseline(values: BucketValues = NORMAL, overrideDay: (index: number, date: string) => PulseDay | null = () => null): PulseDay[] {
  return baselineDates(D).map((date, i) => overrideDay(i, date) ?? pulseDay(date, values));
}
