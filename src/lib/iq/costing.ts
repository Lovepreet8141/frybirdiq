/**
 * What an ingredient really costs, and therefore what a product really costs.
 *
 * The number that matters is not the purchase price. A kilogram of chicken at
 * ₹280 that loses 20% to trimming and another 3% to spoilage did not cost ₹280
 * per usable kilogram — it cost ₹360. Costing a recipe on the purchase price
 * understates food cost on every product that uses it, and the error compounds
 * across a menu.
 *
 * Everything here is integer arithmetic on bigint. Rates are carried in
 * millipaise (thousandths of a paisa) rather than paise: an ingredient bought
 * in bulk can genuinely cost a fraction of a paisa per gram — 50 kg of flour at
 * ₹1,000 is 0.2 paise per gram — and rounding that to a whole paisa either
 * zeroes the cost or triples it.
 */

import { type Bps, type Paise, paise, ZERO } from "@/lib/money";

/** A cost per one base unit, in thousandths of a paisa. */
export type MilliPaise = bigint & { readonly __brand: "MilliPaise" };

const MILLI = 1_000n;
const BPS_ONE = 10_000n;

export interface UsableCostInput {
  /** What was paid, as purchased. */
  readonly purchaseCost: Paise;
  /** How much was bought, already converted to base units. */
  readonly purchaseQuantityBase: number;
  /** Basis points of what is bought that survives prep. 8000 = 80%. */
  readonly yieldBps: Bps;
  /** Basis points lost to spoilage and spillage after prep. 300 = 3%. */
  readonly wasteBps: Bps;
}

function usableFactor(input: UsableCostInput): { numerator: bigint; denominator: bigint } {
  const qty = BigInt(Math.trunc(input.purchaseQuantityBase));
  const yieldB = BigInt(input.yieldBps);
  const wasteB = BPS_ONE - BigInt(input.wasteBps);
  return { numerator: BPS_ONE * BPS_ONE, denominator: qty * yieldB * wasteB };
}

function assertUsable(input: UsableCostInput): void {
  if (input.purchaseQuantityBase <= 0) {
    throw new Error("Purchase quantity must be greater than zero.");
  }
  if (input.yieldBps <= 0) {
    throw new Error("Yield must be greater than 0% — nothing usable comes out otherwise.");
  }
  if (input.wasteBps >= 10_000) {
    throw new Error("Waste of 100% or more leaves nothing to cost.");
  }
  if (input.wasteBps < 0 || input.yieldBps > 10_000) {
    throw new Error("Yield and waste must each be between 0% and 100%.");
  }
}

/**
 * Cost of one usable base unit, in millipaise.
 *
 *   cost per usable unit = purchase cost / (quantity × yield × (1 − waste))
 *
 * Rounded half-up at the millipaise, which is three orders of magnitude finer
 * than anything that reaches an invoice.
 */
export function usableCostPerBaseUnit(input: UsableCostInput): MilliPaise {
  assertUsable(input);
  const { numerator, denominator } = usableFactor(input);
  const scaled = input.purchaseCost * numerator * MILLI;
  return ((scaled + denominator / 2n) / denominator) as MilliPaise;
}

/**
 * What one recipe line costs: the usable rate applied to the quantity the
 * recipe actually uses.
 *
 * Computed from the purchase figures in one expression rather than by
 * multiplying a stored per-unit rate, so the rounding happens once at the end
 * instead of once per ingredient and again per line.
 */
export function recipeLineCost(input: UsableCostInput & { readonly usageQuantityBase: number }): Paise {
  assertUsable(input);
  if (input.usageQuantityBase < 0) {
    throw new Error("A recipe cannot use a negative quantity.");
  }
  const { numerator, denominator } = usableFactor(input);
  const usage = BigInt(Math.trunc(input.usageQuantityBase));
  const scaled = input.purchaseCost * numerator * usage;
  return paise((scaled + denominator / 2n) / denominator);
}

/** The same line cost, when all you have is a stored millipaise rate. */
export function costFromRate(rate: MilliPaise, usageQuantityBase: number): Paise {
  if (usageQuantityBase < 0) {
    throw new Error("A recipe cannot use a negative quantity.");
  }
  const total = rate * BigInt(Math.trunc(usageQuantityBase));
  return paise((total + MILLI / 2n) / MILLI);
}

/** Millipaise shown as whole paise, for a column that only has room for one. */
export function rateToPaise(rate: MilliPaise): Paise {
  return paise((rate + MILLI / 2n) / MILLI);
}

/**
 * A product's cost is the sum of its recipe lines — food and packaging alike.
 * Packaging is an ingredient with `isPackaging` set: a burger box is a real
 * cost per burger sold, and a costing that omits it flatters every margin.
 */
export function productCost(lineCosts: readonly Paise[]): Paise {
  return lineCosts.reduce<Paise>((total, line) => paise(total + line), ZERO);
}

/**
 * Movement between two purchase rates, in basis points.
 *
 * Deliberately compares the raw purchase price per unit, not the usable cost:
 * yield and waste are properties of the ingredient rather than of a price
 * event, so correcting a yield estimate must not show up as the supplier
 * putting their prices up.
 */
export function priceChangeBps(previous: MilliPaise | null, current: MilliPaise): Bps | null {
  if (previous === null || previous === 0n) {
    return null;
  }
  const delta = current - previous;
  return Number((delta * BPS_ONE) / previous) as Bps;
}

/** Purchase price per base unit before yield and waste — what the supplier charged. */
export function purchaseRatePerBaseUnit(purchaseCost: Paise, purchaseQuantityBase: number): MilliPaise {
  if (purchaseQuantityBase <= 0) {
    throw new Error("Purchase quantity must be greater than zero.");
  }
  const qty = BigInt(Math.trunc(purchaseQuantityBase));
  return ((purchaseCost * MILLI + qty / 2n) / qty) as MilliPaise;
}
