/**
 * Kitchen analytics (roadmap 4.4) — pure functions. Facts only.
 *
 * Definitions, stated once so every screen can quote them:
 * - Prep time of an order: from its first ACCEPTED event to the first READY
 *   event after it, both from `order_events`. Whole-order, because that is
 *   what the events record.
 * - A product's prep time: the prep time of each order it appeared in, one
 *   sample per order however many lines it had. A product ordered alongside a
 *   slow item shares that item's time; this is "orders containing it", not a
 *   per-line stopwatch.
 * - p50 / p90: nearest-rank percentiles over those samples. The mean is
 *   rounded to whole seconds.
 * - Hour: the IST hour in which the order was accepted.
 * Nothing here forecasts. An empty set is `null`, never 0.
 *
 * No React, no database.
 */

export interface StatusEvent {
  readonly orderId: string;
  readonly toStatus: string;
  readonly at: Date;
}

export interface PrepSample {
  readonly orderId: string;
  readonly acceptedAt: Date;
  readonly readyAt: Date;
  readonly seconds: number;
}

export interface Summary {
  readonly count: number;
  /** Seconds. */
  readonly p50: number;
  readonly p90: number;
  readonly mean: number;
}

/** Nearest-rank percentile (1..100) of any-order values; null when there are none. */
export function percentile(values: readonly number[], p: number): number | null {
  if (!(p >= 1 && p <= 100)) throw new RangeError("percentile must be between 1 and 100");
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? null;
}

export function summarise(seconds: readonly number[]): Summary | null {
  if (seconds.length === 0) return null;
  const p50 = percentile(seconds, 50);
  const p90 = percentile(seconds, 90);
  if (p50 === null || p90 === null) return null;
  return { count: seconds.length, p50, p90, mean: Math.round(seconds.reduce((sum, value) => sum + value, 0) / seconds.length) };
}

/** One sample per order that was accepted and then marked READY; the first of each, whatever order the events arrive in. */
export function prepSamples(events: readonly StatusEvent[]): readonly PrepSample[] {
  const accepted = new Map<string, Date>();
  for (const event of events) {
    if (event.toStatus !== "ACCEPTED") continue;
    const seen = accepted.get(event.orderId);
    if (!seen || event.at < seen) accepted.set(event.orderId, event.at);
  }
  const ready = new Map<string, Date>();
  for (const event of events) {
    if (event.toStatus !== "READY") continue;
    const start = accepted.get(event.orderId);
    if (!start || event.at <= start) continue;
    const seen = ready.get(event.orderId);
    if (!seen || event.at < seen) ready.set(event.orderId, event.at);
  }
  const samples: PrepSample[] = [];
  for (const [orderId, readyAt] of ready) {
    const acceptedAt = accepted.get(orderId)!;
    samples.push({ orderId, acceptedAt, readyAt, seconds: Math.round((readyAt.getTime() - acceptedAt.getTime()) / 1000) });
  }
  return samples.sort((a, b) => a.acceptedAt.getTime() - b.acceptedAt.getTime());
}

/** India has no daylight saving: the offset is fixed at +05:30. */
export function hourOfIst(at: Date): number {
  return new Date(at.getTime() + (5 * 60 + 30) * 60_000).getUTCHours();
}

export interface HourRow {
  readonly hour: number;
  readonly summary: Summary;
}

/** By IST hour of acceptance; hours in which no order was accepted are left out, not shown as zero. */
export function summariseByHour(samples: readonly PrepSample[]): readonly HourRow[] {
  const byHour = new Map<number, number[]>();
  for (const sample of samples) {
    const hour = hourOfIst(sample.acceptedAt);
    byHour.set(hour, [...(byHour.get(hour) ?? []), sample.seconds]);
  }
  const rows: HourRow[] = [];
  for (const [hour, seconds] of byHour) {
    const summary = summarise(seconds);
    if (summary) rows.push({ hour, summary });
  }
  return rows.sort((a, b) => a.hour - b.hour);
}

export interface LineFact {
  readonly orderId: string;
  /** Stored identity (the product id), or the snapshot name when the product no longer exists. */
  readonly productKey: string;
  readonly productName: string;
  /** products.prep_minutes now; null when none is set. */
  readonly targetMinutes: number | null;
}

export interface ProductRow {
  readonly productKey: string;
  readonly productName: string;
  readonly targetMinutes: number | null;
  readonly summary: Summary;
}

/** Slowest first by median, then p90, then name. `summary.count` is how many orders stand behind the figure. */
export function summariseByProduct(samples: readonly PrepSample[], lines: readonly LineFact[]): readonly ProductRow[] {
  const secondsByOrder = new Map(samples.map((sample) => [sample.orderId, sample.seconds]));
  const products = new Map<string, { name: string; target: number | null; orders: Map<string, number> }>();
  for (const line of lines) {
    const seconds = secondsByOrder.get(line.orderId);
    if (seconds === undefined) continue;
    const entry = products.get(line.productKey) ?? { name: line.productName, target: line.targetMinutes, orders: new Map<string, number>() };
    entry.orders.set(line.orderId, seconds);
    products.set(line.productKey, entry);
  }
  const rows: ProductRow[] = [];
  for (const [productKey, entry] of products) {
    const summary = summarise([...entry.orders.values()]);
    if (summary) rows.push({ productKey, productName: entry.name, targetMinutes: entry.target, summary });
  }
  return rows.sort((a, b) => b.summary.p50 - a.summary.p50 || b.summary.p90 - a.summary.p90 || a.productName.localeCompare(b.productName));
}
