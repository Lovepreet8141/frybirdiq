/**
 * Statistics over stored figures that stay facts.
 *
 * IQ-2 DESIGN.md §2: a DETECTION's baseline is Observed. The median of
 * figures read from stored rows is itself read from those rows (one of them,
 * or the rounded mean of the two middle ones), so it may stay Observed —
 * but only the engine may mint one, and only from Observed inputs, so a
 * forecast can never be laundered into a baseline.
 *
 * Integer only: paise and counts are bigint-exact; halves round away from zero.
 */
import { observed } from "./observed-factory";
import { magnitudeOf, sameUnit, type Observed, type Quantity } from "./quantity";

/** `numerator / denominator` rounded half away from zero. */
export function divRoundHalfAway(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("observed-stats: division by zero");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const rounded = (n % d) * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** Median of integers; an even count takes the mean of the two middle values, rounded half away from zero. */
export function integerMedian(values: readonly bigint[]): bigint {
  if (values.length === 0) throw new RangeError("observed-stats: median of nothing");
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return divRoundHalfAway(sorted[mid - 1]! + sorted[mid]!, 2n);
}

function withValue(unit: Quantity["unit"], value: bigint): Quantity {
  if (unit === "paise") return { unit, value: value.toString() };
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError("observed-stats: value is not a safe integer");
  return { unit, value: n };
}

/** The median of Observed figures of one unit, as an Observed figure. */
export function observedMedian(points: readonly Observed[]): Observed {
  const first = points[0];
  if (!first) throw new RangeError("observed-stats: median of nothing");
  for (const p of points) {
    if (!sameUnit(first, p)) throw new RangeError(`observed-stats: cannot take a median of ${first.unit} and ${p.unit}`);
  }
  return observed(withValue(first.unit, integerMedian(points.map(magnitudeOf))));
}

/**
 * `q × bps ÷ 10000`, half away from zero, in q's unit. For a threshold that is
 * a share of a stored figure ("2% of net sales"): derived only from an
 * Observed input, so it may stay Observed.
 */
export function observedShare(q: Observed, bps: bigint): Observed {
  return observed(withValue(q.unit, divRoundHalfAway(magnitudeOf(q) * bps, 10000n)));
}
