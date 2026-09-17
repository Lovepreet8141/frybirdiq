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

/** Σ of Observed figures of one unit (an empty list sums to zero in `unit`). */
export function observedSum(unit: Quantity["unit"], points: readonly Observed[]): Observed {
  let total = 0n;
  for (const p of points) {
    if (p.unit !== unit) throw new RangeError(`observed-stats: cannot add ${p.unit} to ${unit}`);
    total += magnitudeOf(p);
  }
  return observed(withValue(unit, total));
}

/**
 * `total ÷ count`, half away from zero, stated in `unit` — e.g. seconds of
 * prep over tickets ready gives a mean prep time in seconds. Both inputs are
 * Observed counts from stored rows; `count` must be positive.
 */
export function observedMean(total: Observed, count: Observed, unit: Quantity["unit"]): Observed {
  const n = magnitudeOf(count);
  if (n <= 0n) throw new RangeError("observed-stats: mean over zero items");
  return observed(withValue(unit, divRoundHalfAway(magnitudeOf(total), n)));
}
