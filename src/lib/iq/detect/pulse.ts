/**
 * Service pulse rules — IQ-2 slice S9.
 *
 * hive/reviews/iq-2/DESIGN.md §3 and Revision 2 (R2.8, R2.9); REVIEW-RELIABILITY
 * C8/U3; REVIEW-RESTAURANT-OPS O1 (thresholds kept).
 *
 * Every 15 minutes inside opening hours, compare today so far with the same
 * weekday over the previous 8 weeks, bucket for bucket:
 * - `pulse.sales_pace_below`: net sales from opening to now; at least 2 h after
 *   opening, ≥ 30% below the median and z ≤ −3 → severity 2.
 * - `pulse.no_orders`: no paid order in the last 45 min (counted from orders
 *   directly, not buckets, R2.8) where that window's median is ≥ 3 → severity 3.
 * - `pulse.kitchen_slow`: mean accept→ready over the last 60 min at least 50%
 *   and 5 min above the median, with ≥ 5 tickets → severity 2. The intraday
 *   facts hold totals per bucket, so today and each baseline day use the mean
 *   over the window; the baseline is the median of those means.
 *
 * Outcomes follow the detectors: FIRED, CLEAR (evaluated and silent, may
 * expire), NOT_EVALUATED (never expires), and CLOSED once the day's hours are
 * over (expire with CLOSING_TIME). Hours that wrap past midnight are refused.
 *
 * Pure. Inputs are Observed, minted by the repository reader through
 * `pulseDayFrom`; derived figures stay Observed through the engine's helpers.
 */
import { addDays } from "@/lib/dates";
import { magnitudeOf, observedMean, observedMedian, observedSum, type Observed, type Quantity } from "@/lib/iq/engine";

import { BASELINE_WEEKS, UNIT_FLOOR, baselineDates, baselineStats, deviationBps, zAtMost } from "./baseline";

export const PULSE_RULES_VERSION = 1;
export const BUCKET_MINUTES = 15;
const DAY_MINUTES = 24 * 60;

export const SALES_PACE_MIN_MINUTES_OPEN = 120;
export const SALES_PACE_MAX_DEVIATION_BPS = -3000;
export const NO_ORDERS_WINDOW_MINUTES = 45;
export const NO_ORDERS_MIN_BASELINE_MEDIAN = 3n;
export const KITCHEN_WINDOW_MINUTES = 60;
export const KITCHEN_MIN_TICKETS = 5n;
export const KITCHEN_MIN_EXTRA_SECONDS = 300n;

export const PULSE_RULE_IDS = ["pulse.sales_pace_below", "pulse.no_orders", "pulse.kitchen_slow"] as const;
export type PulseRuleId = (typeof PULSE_RULE_IDS)[number];

/** One 15-minute IST bucket's intraday facts. A bucket with no row is zero. */
export type PulseBucket = {
  /** Minutes after midnight IST that the bucket starts at (0, 15, … 1425). */
  readonly startMinute: number;
  readonly ordersPaid: Observed;
  readonly revenueNet: Observed;
  readonly ticketsReady: Observed;
  /** Σ whole seconds accept→ready over `ticketsReady` (stored as a count of seconds). */
  readonly ticketSeconds: Observed;
};

export type PulseDay = {
  readonly date: string;
  /** False when intraday facts were never built for the day (not yet backfilled). */
  readonly computed: boolean;
  readonly buckets: readonly PulseBucket[];
};

export type OpeningHours = { readonly opening: string; readonly closing: string };

export type PulseNotEvaluatedReason =
  | "outside_hours"
  | "excluded_date"
  | "hours_wrap_unsupported"
  | "hours_invalid"
  | "not_open_long_enough"
  | "window_before_opening"
  | "no_intraday_facts"
  | "no_order_count"
  | "insufficient_history"
  | "zero_median"
  | "too_few_tickets";

export type PulseWindow = { readonly startMinute: number; readonly endMinute: number };

export type PulseOutcome =
  | {
      readonly status: "FIRED";
      readonly ruleId: PulseRuleId;
      readonly dedupeKey: string;
      readonly severity: 2 | 3;
      readonly observed: Observed;
      readonly baseline: { readonly method: "median_mad"; readonly value: Observed; readonly windowWeeks: number };
      readonly deviationBps: number;
      readonly window: PulseWindow;
      readonly metricId: "revenue_net" | "orders_paid" | "tickets_ready";
    }
  | { readonly status: "CLEAR" | "CLOSED"; readonly ruleId: PulseRuleId; readonly dedupeKey: string }
  | { readonly status: "NOT_EVALUATED"; readonly ruleId: PulseRuleId; readonly dedupeKey: string; readonly reason: PulseNotEvaluatedReason };

export type PulseInput = {
  /** The IST business day evaluated. */
  readonly date: string;
  /** End of the last complete bucket, in minutes after that day's midnight IST (15 … 1440). */
  readonly endMinute: number;
  readonly hours: OpeningHours;
  readonly today: PulseDay;
  /** The same weekday in the previous 8 weeks; a missing day counts as not computed. */
  readonly baseline: readonly PulseDay[];
  /** Paid orders created in the last 45 minutes, counted from orders; null when not read. */
  readonly ordersLast45: Observed | null;
  /** Owner-supplied closure / reduced-hours dates (gated owner input, R2.9); empty by default. */
  readonly excludedDates?: readonly string[];
};

export type PulseEvaluation = {
  readonly outcomes: readonly PulseOutcome[];
  readonly summary: Readonly<Record<string, number>>;
};

export function pulseDedupeKey(ruleId: PulseRuleId, date: string): string {
  return `pulse:${ruleId}:${date}`;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes after midnight for "HH:MM", or null when malformed. */
export function minuteOfDay(time: string): number | null {
  const m = HHMM.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** An IST timestamp for `minute` minutes after `date`'s midnight (1440 = the next midnight). */
export function istAt(date: string, minute: number): string {
  const day = minute >= DAY_MINUTES ? addDays(date, 1) : date;
  const m = minute % DAY_MINUTES;
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${day}T${hh}:${mm}:00+05:30`;
}

function sumIn(day: PulseDay, window: PulseWindow, pick: (b: PulseBucket) => Observed, unit: Quantity["unit"]): Observed {
  const inWindow = day.buckets.filter((b) => b.startMinute >= window.startMinute && b.startMinute < window.endMinute);
  return observedSum(unit, inWindow.map(pick));
}

function dayClosed(day: PulseDay): boolean {
  return day.buckets.every((b) => magnitudeOf(b.ordersPaid) === 0n);
}

function usableBaseline(input: PulseInput): PulseDay[] {
  const byDate = new Map(input.baseline.map((d) => [d.date, d]));
  const excluded = new Set(input.excludedDates ?? []);
  const days: PulseDay[] = [];
  for (const date of baselineDates(input.date)) {
    const day = byDate.get(date);
    if (!day || !day.computed || excluded.has(date) || dayClosed(day)) continue;
    days.push(day);
  }
  return days;
}

function definedDeviation(dev: number | null, delta: bigint): number {
  if (dev !== null) return dev;
  return delta > 0n ? 10000 : delta < 0n ? -10000 : 0;
}

export function evaluatePulse(input: PulseInput): PulseEvaluation {
  const outcomes: PulseOutcome[] = [];
  const keyOf = (ruleId: PulseRuleId) => pulseDedupeKey(ruleId, input.date);
  const all = (make: (ruleId: PulseRuleId) => PulseOutcome) => {
    for (const ruleId of PULSE_RULE_IDS) outcomes.push(make(ruleId));
    return { outcomes, summary: summarize(outcomes) };
  };
  const skipAll = (reason: PulseNotEvaluatedReason) => all((ruleId) => ({ status: "NOT_EVALUATED", ruleId, dedupeKey: keyOf(ruleId), reason }));

  const opening = minuteOfDay(input.hours.opening);
  const closing = minuteOfDay(input.hours.closing);
  if (opening === null || closing === null) return skipAll("hours_invalid");
  if (closing <= opening) return skipAll("hours_wrap_unsupported");
  if (input.endMinute > closing) return all((ruleId) => ({ status: "CLOSED", ruleId, dedupeKey: keyOf(ruleId) }));
  if (input.endMinute <= opening) return skipAll("outside_hours");
  if ((input.excludedDates ?? []).includes(input.date)) return skipAll("excluded_date");
  if (!input.today.computed) return skipAll("no_intraday_facts");

  const baseline = usableBaseline(input);
  const end = input.endMinute;
  const skip = (ruleId: PulseRuleId, reason: PulseNotEvaluatedReason) =>
    outcomes.push({ status: "NOT_EVALUATED", ruleId, dedupeKey: keyOf(ruleId), reason });
  const clear = (ruleId: PulseRuleId) => outcomes.push({ status: "CLEAR", ruleId, dedupeKey: keyOf(ruleId) });

  // pulse.sales_pace_below — cumulative net sales from opening.
  {
    const ruleId = "pulse.sales_pace_below" as const;
    const window = { startMinute: opening, endMinute: end };
    if (end - opening < SALES_PACE_MIN_MINUTES_OPEN) skip(ruleId, "not_open_long_enough");
    else {
      const points = baseline.map((d) => sumIn(d, window, (b) => b.revenueNet, "paise"));
      const stats = baselineStats(points.map(magnitudeOf), UNIT_FLOOR.paise);
      const x = sumIn(input.today, window, (b) => b.revenueNet, "paise");
      if (!stats) skip(ruleId, "insufficient_history");
      else if (stats.median <= 0n) skip(ruleId, "zero_median");
      else {
        const xv = magnitudeOf(x);
        const dev = deviationBps(xv, stats.median)!;
        if (zAtMost(xv, stats, -3) && dev <= SALES_PACE_MAX_DEVIATION_BPS) {
          outcomes.push({
            status: "FIRED",
            ruleId,
            dedupeKey: keyOf(ruleId),
            severity: 2,
            observed: x,
            baseline: { method: "median_mad", value: observedMedian(points), windowWeeks: BASELINE_WEEKS },
            deviationBps: dev,
            window,
            metricId: "revenue_net",
          });
        } else clear(ruleId);
      }
    }
  }

  // pulse.no_orders — the last 45 minutes, counted from orders.
  {
    const ruleId = "pulse.no_orders" as const;
    const window = { startMinute: end - NO_ORDERS_WINDOW_MINUTES, endMinute: end };
    if (window.startMinute < opening) skip(ruleId, "window_before_opening");
    else if (input.ordersLast45 === null) skip(ruleId, "no_order_count");
    else {
      const points = baseline.map((d) => sumIn(d, window, (b) => b.ordersPaid, "count"));
      if (points.length < 4) skip(ruleId, "insufficient_history");
      else {
        const median = observedMedian(points);
        const count = magnitudeOf(input.ordersLast45);
        if (count === 0n && magnitudeOf(median) >= NO_ORDERS_MIN_BASELINE_MEDIAN) {
          outcomes.push({
            status: "FIRED",
            ruleId,
            dedupeKey: keyOf(ruleId),
            severity: 3,
            observed: input.ordersLast45,
            baseline: { method: "median_mad", value: median, windowWeeks: BASELINE_WEEKS },
            deviationBps: -10000,
            window,
            metricId: "orders_paid",
          });
        } else clear(ruleId);
      }
    }
  }

  // pulse.kitchen_slow — mean accept→ready over the last 60 minutes.
  {
    const ruleId = "pulse.kitchen_slow" as const;
    const window = { startMinute: end - KITCHEN_WINDOW_MINUTES, endMinute: end };
    if (window.startMinute < opening) skip(ruleId, "window_before_opening");
    else {
      const tickets = sumIn(input.today, window, (b) => b.ticketsReady, "count");
      if (magnitudeOf(tickets) < KITCHEN_MIN_TICKETS) skip(ruleId, "too_few_tickets");
      else {
        const points: Observed[] = [];
        for (const d of baseline) {
          const n = sumIn(d, window, (b) => b.ticketsReady, "count");
          if (magnitudeOf(n) === 0n) continue;
          points.push(observedMean(sumIn(d, window, (b) => b.ticketSeconds, "count"), n, "seconds"));
        }
        if (points.length < 4) skip(ruleId, "insufficient_history");
        else {
          const median = observedMedian(points);
          const mean = observedMean(sumIn(input.today, window, (b) => b.ticketSeconds, "count"), tickets, "seconds");
          const m = magnitudeOf(mean);
          const base = magnitudeOf(median);
          if (base > 0n && m * 2n >= base * 3n && m - base >= KITCHEN_MIN_EXTRA_SECONDS) {
            outcomes.push({
              status: "FIRED",
              ruleId,
              dedupeKey: keyOf(ruleId),
              severity: 2,
              observed: mean,
              baseline: { method: "median_mad", value: median, windowWeeks: BASELINE_WEEKS },
              deviationBps: definedDeviation(deviationBps(m, base), m - base),
              window,
              metricId: "tickets_ready",
            });
          } else if (base <= 0n) skip(ruleId, "zero_median");
          else clear(ruleId);
        }
      }
    }
  }

  return { outcomes, summary: summarize(outcomes) };
}

function summarize(outcomes: readonly PulseOutcome[]): Record<string, number> {
  const summary: Record<string, number> = { rules_fired: 0, rules_clear: 0, rules_closed: 0, rules_not_evaluated: 0 };
  for (const o of outcomes) {
    if (o.status === "FIRED") summary.rules_fired! += 1;
    else if (o.status === "CLEAR") summary.rules_clear! += 1;
    else if (o.status === "CLOSED") summary.rules_closed! += 1;
    else if (o.status === "NOT_EVALUATED") {
      summary.rules_not_evaluated! += 1;
      summary[`not_evaluated_${o.reason}`] = (summary[`not_evaluated_${o.reason}`] ?? 0) + 1;
      summary[`not_evaluated:${o.ruleId}:${o.reason}`] = (summary[`not_evaluated:${o.ruleId}:${o.reason}`] ?? 0) + 1;
    }
  }
  return summary;
}

/** One stored `iq_intraday_facts` row for a day (current definition version, summed across locations). */
export type IntradayRow = {
  readonly startMinute: number;
  readonly metricId: "orders_paid" | "revenue_net" | "tickets_ready" | "ticket_ready_seconds_total";
  readonly value: bigint;
};

/**
 * Builds a PulseDay from stored intraday rows. The repository reader calls this
 * with its own `observe` (it may mint; this module may not). Rows for the same
 * bucket and metric are summed; a bucket with no rows is left out (zero).
 */
export function pulseDayFrom(date: string, computed: boolean, rows: readonly IntradayRow[], observe: (q: Quantity) => Observed): PulseDay {
  const byBucket = new Map<number, { orders: bigint; revenue: bigint; tickets: bigint; seconds: bigint }>();
  for (const row of rows) {
    if (row.startMinute < 0 || row.startMinute >= DAY_MINUTES || row.startMinute % BUCKET_MINUTES !== 0) {
      throw new RangeError(`pulse: bucket minute ${row.startMinute} is not a 15-minute boundary of the day`);
    }
    const b = byBucket.get(row.startMinute) ?? { orders: 0n, revenue: 0n, tickets: 0n, seconds: 0n };
    if (row.metricId === "orders_paid") b.orders += row.value;
    else if (row.metricId === "revenue_net") b.revenue += row.value;
    else if (row.metricId === "tickets_ready") b.tickets += row.value;
    else b.seconds += row.value;
    byBucket.set(row.startMinute, b);
  }
  const count = (v: bigint) => observe({ unit: "count", value: Number(v) });
  const buckets = [...byBucket.entries()]
    .sort(([a], [b]) => a - b)
    .map(([startMinute, b]) => ({
      startMinute,
      ordersPaid: count(b.orders),
      revenueNet: observe({ unit: "paise", value: b.revenue.toString() }),
      ticketsReady: count(b.tickets),
      ticketSeconds: count(b.seconds),
    }));
  return { date, computed, buckets };
}
