/**
 * Intraday facts — IQ-2 slice S8. hive/reviews/iq-2/DESIGN.md §3 and
 * Revision 2 R2.8; REVIEW-RELIABILITY.md "Intraday writer", "8-week
 * backfill", C7.
 *
 * `iq_intraday_facts` holds, per org, location and 15-minute IST bucket, the
 * increments the service pulse reads. Pure: bucket arithmetic, the retention
 * cutoff and the backfill dates. No database, no framework.
 *
 * Retention and backfill are computed from the same IST business date, so the
 * nightly purge can never delete a date the backfill has just written (C7):
 * the backfill starts 56 days back, the purge keeps 63.
 */

import { addDays } from "./business-day";
import type { MetricUnit } from "./catalog";

/** A bucket is 15 minutes. IST is UTC+05:30, a multiple of it, so UTC and IST buckets line up. */
export const BUCKET_MS = 15 * 60 * 1000;

/** The start of the 15-minute bucket an instant falls in. */
export function bucketStartOf(at: Date): Date {
  return new Date(Math.floor(at.getTime() / BUCKET_MS) * BUCKET_MS);
}

/** Days of intraday facts kept, today included: 8 weeks of baseline plus a week of slack (B7 revisited, 35 → 63). */
export const INTRADAY_RETENTION_DAYS = 63;

/** Days the intraday backfill rebuilds, ending the day before today: 8 weeks. */
export const INTRADAY_BACKFILL_DAYS = 56;

/** The oldest IST business date the purge keeps for `today`; anything before it is deleted. */
export function intradayRetentionFirstDate(today: string): string {
  return addDays(today, -(INTRADAY_RETENTION_DAYS - 1));
}

/** The IST business dates the backfill rebuilds for `today`, oldest first: D-56 … D-1. Never today. */
export function intradayBackfillDates(today: string): string[] {
  const dates: string[] = [];
  for (let back = INTRADAY_BACKFILL_DAYS; back >= 1; back--) dates.push(addDays(today, -back));
  return dates;
}

export const INTRADAY_METRIC_IDS = ["orders_paid", "revenue_net", "tickets_ready", "ticket_ready_seconds_total"] as const;
export type IntradayMetricId = (typeof INTRADAY_METRIC_IDS)[number];

export interface IntradayMetricDefinition {
  readonly id: IntradayMetricId;
  readonly unit: MetricUnit;
  readonly description: string;
}

/**
 * One definition per intraday metric. `orders_paid` and `revenue_net` are the
 * daily metrics of the same name, split by the bucket of `created_at`, so a
 * day's buckets sum to its daily fact.
 */
export const INTRADAY_METRICS: { readonly [K in IntradayMetricId]: IntradayMetricDefinition & { readonly id: K } } = {
  orders_paid: {
    id: "orders_paid",
    unit: "count",
    description: "Sale-set orders (saleSetWhere), in the 15-minute bucket of created_at. Sums to the daily orders_paid.",
  },
  revenue_net: {
    id: "revenue_net",
    unit: "paise",
    description: "Σ orders.taxable_total over the sale set, in the 15-minute bucket of created_at. Sums to the daily revenue_net.",
  },
  tickets_ready: {
    id: "tickets_ready",
    unit: "count",
    description: "Orders marked ready in the bucket of ready_at, with accepted_at set and not after ready_at. Any status: a ticket cooked and then cancelled was still kitchen work.",
  },
  ticket_ready_seconds_total: {
    id: "ticket_ready_seconds_total",
    unit: "count",
    description: "Σ whole seconds from accepted_at to ready_at over the same tickets as tickets_ready (unit count, of seconds). Mean prep time = this ÷ tickets_ready.",
  },
};
