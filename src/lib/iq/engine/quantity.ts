/**
 * Quantities — every number an insight carries, with its unit attached.
 *
 * hive/reviews/iq-0/DESIGN.md §1.1, amended by DESIGN-v2-DELTA.md §1.
 *
 * Money is a whole number of paise written as a decimal string, so it
 * survives JSON (a `bigint` does not) and never passes through a float.
 * Every other unit is a safe integer: grams, millilitres and pieces are the
 * inventory base units, bps is basis points, seconds is a duration.
 *
 * Two brands split quantities by where they came from:
 *
 * - `Observed` — read from stored rows. Allowed in FACT, DETECTION and an
 *   EXPLANATION's total and drivers. Built only by `observed()` in
 *   `observed-factory.ts`, which only the repository readers may import.
 * - `Estimated` — produced by a model, simulation or residual. Allowed in
 *   FORECAST, RECOMMENDATION and an EXPLANATION's residual.
 *
 * An `Estimated` is not assignable to an `Observed`, so a forecast figure
 * cannot be handed to anything that renders a fact.
 */
import { z } from "zod";

export const UNITS = ["paise", "count", "bps", "grams", "ml", "pieces", "seconds"] as const;
export type Unit = (typeof UNITS)[number];

/** Canonical integer paise: no leading zeros, no "-0". */
const PAISE_VALUE = /^(0|-?[1-9]\d*)$/;

export const QuantitySchema = z.discriminatedUnion("unit", [
  z.strictObject({ unit: z.literal("paise"), value: z.string().regex(PAISE_VALUE) }),
  z.strictObject({
    unit: z.enum(["count", "bps", "grams", "ml", "pieces", "seconds"]),
    value: z.number().int(),
  }),
]);
export type Quantity = z.infer<typeof QuantitySchema>;

export const ObservedSchema = QuantitySchema.brand<"Observed">();
export type Observed = z.output<typeof ObservedSchema>;

export const EstimatedSchema = QuantitySchema.brand<"Estimated">();
export type Estimated = z.output<typeof EstimatedSchema>;

/** Brands a model's output. Anything may estimate; only repositories observe. */
export function estimated(quantity: Quantity): Estimated {
  return EstimatedSchema.parse(quantity);
}

export function sameUnit(a: Quantity, b: Quantity): boolean {
  return a.unit === b.unit;
}

/** The value as an exact bigint, whichever unit it is in. */
export function magnitudeOf(q: Quantity): bigint {
  return BigInt(q.value);
}

/** -1, 0 or 1. Throws on a unit mismatch — comparing grams to paise is a bug. */
export function compareQuantities(a: Quantity, b: Quantity): -1 | 0 | 1 {
  if (!sameUnit(a, b)) throw new RangeError(`quantity: cannot compare ${a.unit} with ${b.unit}`);
  const x = magnitudeOf(a);
  const y = magnitudeOf(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Sum of same-unit quantities as a bigint, exact for every unit. */
export function sumMagnitudes(quantities: readonly Quantity[]): bigint {
  const first = quantities[0];
  let total = 0n;
  for (const q of quantities) {
    if (first && !sameUnit(first, q)) {
      throw new RangeError(`quantity: cannot add ${q.unit} to ${first.unit}`);
    }
    total += magnitudeOf(q);
  }
  return total;
}

/** p10 ≤ p50 ≤ p90, one unit, 80% nominal coverage. §1.1 */
export const IntervalSchema = z
  .strictObject({
    p10: EstimatedSchema,
    p50: EstimatedSchema,
    p90: EstimatedSchema,
    nominalCoverage: z.literal(80),
  })
  .refine((i) => sameUnit(i.p10, i.p50) && sameUnit(i.p50, i.p90), {
    message: "interval quantiles must share one unit",
  })
  .refine(
    (i) =>
      !sameUnit(i.p10, i.p50) ||
      !sameUnit(i.p50, i.p90) ||
      (compareQuantities(i.p10, i.p50) <= 0 && compareQuantities(i.p50, i.p90) <= 0),
    { message: "interval must satisfy p10 ≤ p50 ≤ p90" },
  );
export type Interval = z.output<typeof IntervalSchema>;

/** A low–high band with where it came from. Never a point. §1.1 */
export const RangeSchema = z
  .strictObject({
    low: EstimatedSchema,
    high: EstimatedSchema,
    basis: z.enum(["forecast", "simulation", "historical"]),
  })
  .refine((r) => sameUnit(r.low, r.high), { message: "range bounds must share one unit" })
  .refine((r) => !sameUnit(r.low, r.high) || compareQuantities(r.low, r.high) <= 0, {
    message: "range must satisfy low ≤ high",
  });
export type Range = z.output<typeof RangeSchema>;
