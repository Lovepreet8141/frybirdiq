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

export interface RecipeCostLineInput {
  readonly ingredientId: string;
  /** Usage in the ingredient's base unit — what a recipe line stores. */
  readonly quantityBase: number;
  /** The ingredient's stored usable rate. Zero means no price has ever been recorded. */
  readonly costPerBaseUnitMilli: MilliPaise;
}

export interface RecipeCostLine {
  readonly ingredientId: string;
  readonly cost: Paise;
  /** False when the rate behind this line's cost is zero because the ingredient has never been priced — the cost is not really nothing, it is unknown. */
  readonly priced: boolean;
}

export interface RecipeCostResult {
  readonly lines: readonly RecipeCostLine[];
  /**
   * Null when there are no lines to cost.
   *
   * A recipe with nothing in it is not a ₹0 recipe — it is one nobody has
   * costed yet, and showing zero would read as "this product is free to
   * make" instead of "nothing has been entered."
   */
  readonly total: Paise | null;
}

/**
 * A recipe's theoretical cost: each line costed at the ingredient's current
 * usable rate (`costFromRate`), summed with `productCost`. The one place
 * that turns a set of recipe lines into a single cost figure, so the product
 * page and anything else that shows this number computes it the same way.
 */
export function theoreticalRecipeCost(lines: readonly RecipeCostLineInput[]): RecipeCostResult {
  if (lines.length === 0) {
    return { lines: [], total: null };
  }
  const costed = lines.map((line) => ({
    ingredientId: line.ingredientId,
    cost: costFromRate(line.costPerBaseUnitMilli, line.quantityBase),
    priced: line.costPerBaseUnitMilli !== 0n,
  }));
  return { lines: costed, total: productCost(costed.map((line) => line.cost)) };
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

/**
 * How much of an ingredient consuming `lineQuantity` sold units actually
 * uses. Roadmap 3.4.
 *
 * A recipe version's line records usage for one full batch, which yields
 * `yieldQuantity` portions of the product (`recipes.yieldQuantity`,
 * default 1 — the common case, one recipe run per unit sold). Consuming 2
 * units of a product whose recipe yields 1 portion per batch uses exactly
 * 2× the recipe line's quantity; a batch recipe that yields more than one
 * portion divides down first. Rounded half-up to the nearest whole base
 * unit — inventory movements are integers, so a 150 g line split across a
 * yield of 3 (50 g/portion) rounds rather than losing the remainder.
 */
export function consumptionQuantity(perBatchQuantityBase: number, lineQuantity: number, yieldQuantity: number): number {
  if (lineQuantity < 0) {
    throw new Error("An order line cannot consume a negative quantity.");
  }
  const yieldQ = Math.max(Math.trunc(yieldQuantity), 1);
  return Math.round((perBatchQuantityBase * lineQuantity) / yieldQ);
}

/** Purchase price per base unit before yield and waste — what the supplier charged. */
export function purchaseRatePerBaseUnit(purchaseCost: Paise, purchaseQuantityBase: number): MilliPaise {
  if (purchaseQuantityBase <= 0) {
    throw new Error("Purchase quantity must be greater than zero.");
  }
  const qty = BigInt(Math.trunc(purchaseQuantityBase));
  return ((purchaseCost * MILLI + qty / 2n) / qty) as MilliPaise;
}
