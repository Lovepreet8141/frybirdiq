/**
 * Same-weekday baseline: integer median and MAD, robust z by cross-multiplication.
 *
 * hive/reviews/iq-2/DESIGN.md §2 (Revision 2 wins where it differs).
 *
 * Points are the same weekday over the previous 8 weeks. A day is not a point
 * when it has no facts, is closed (orders_paid = 0), is an owner-excluded date,
 * was flagged by facts parity, has no value for the figure (a ratio with no
 * denominator), or its figure's trust is LOW. At least 4 points, else nothing
 * is evaluated.
 *
 * robust σ = 1.4826 · MAD, floored at max(5% of |median|, the figure's floor):
 * by unit ₹500 (50000 paise), 3 orders, 100 bps; average order value uses
 * ₹10 (see FIGURE_SIGMA_FLOOR in rules.ts). z is never divided out: "z ≤ −3" is
 * tested as (x − median) · 10000 ≤ −3 · max(14826 · MAD, 10000 · floor), so
 * a boundary case is exact, not a rounding accident.
 */
import { addDays } from "@/lib/dates";
import { divRoundHalfAway, integerMedian } from "@/lib/iq/engine";

export const BASELINE_WEEKS = 8;
export const MIN_BASELINE_POINTS = 4;

/** 1.4826 in ten-thousandths. */
const MAD_TO_SIGMA_E4 = 14826n;

export type FigureUnit = "paise" | "count" | "bps";

export const UNIT_FLOOR: Readonly<Record<FigureUnit, bigint>> = {
  paise: 50000n,
  count: 3n,
  bps: 100n,
};

/** The same weekday in each of the previous `weeks` weeks, most recent first. */
export function baselineDates(date: string, weeks = BASELINE_WEEKS): string[] {
  return Array.from({ length: weeks }, (_, i) => addDays(date, -7 * (i + 1)));
}

export type BaselineStats = {
  readonly points: number;
  readonly median: bigint;
  readonly mad: bigint;
  /** 10000 · effective σ: max(14826 · MAD, 10000 · floor). Always > 0. */
  readonly sigmaE4: bigint;
};

function abs(n: bigint): bigint {
  return n < 0n ? -n : n;
}

/** Median, MAD and floored σ of the baseline points, or null below the minimum point count. */
export function baselineStats(points: readonly bigint[], unitFloor: bigint): BaselineStats | null {
  if (points.length < MIN_BASELINE_POINTS) return null;
  const median = integerMedian(points);
  const mad = integerMedian(points.map((p) => abs(p - median)));
  const fivePercent = abs(median) / 20n;
  const floor = fivePercent > unitFloor ? fivePercent : unitFloor;
  const fromMad = MAD_TO_SIGMA_E4 * mad;
  const fromFloor = 10000n * floor;
  return { points: points.length, median, mad, sigmaE4: fromMad > fromFloor ? fromMad : fromFloor };
}

/** True when z ≥ k (k may be negative: use `zAtMost` for "z ≤ −k"). */
export function zAtLeast(x: bigint, stats: BaselineStats, k: number): boolean {
  return (x - stats.median) * 10000n >= BigInt(k) * stats.sigmaE4;
}

/** True when z ≤ k, e.g. `zAtMost(x, s, -3)`. */
export function zAtMost(x: bigint, stats: BaselineStats, k: number): boolean {
  return (x - stats.median) * 10000n <= BigInt(k) * stats.sigmaE4;
}

/** z in hundredths, truncated toward zero. For summaries and tests only; rules use zAtLeast/zAtMost. */
export function zCenti(x: bigint, stats: BaselineStats): number {
  return Number(((x - stats.median) * 1_000_000n) / stats.sigmaE4);
}

/**
 * (x − median) ÷ median in basis points, half away from zero; null when the
 * median is not positive (a relative change from nothing is undefined).
 */
export function deviationBps(x: bigint, median: bigint): number | null {
  if (median <= 0n) return null;
  return Number(divRoundHalfAway((x - median) * 10000n, median));
}
