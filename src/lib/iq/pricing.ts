/**
 * What to charge.
 *
 * Two ways owners actually think about it, and they are not the same question:
 *
 *   "I want 30% margin on this"    → work back from cost and margin
 *   "food cost should be 32%"      → work back from ingredients alone
 *
 * The second is the industry rule of thumb and deliberately ignores packaging
 * and labour; the first is the one that pays the rent. Both are offered because
 * an owner who only ever sees the second will price a heavily-packaged item too
 * low and never know why the month did not work.
 *
 * There is no commission parameter. FRYBIRD sells direct — dine-in, takeaway
 * and its own website — so nobody takes a cut of the menu price.
 */

import { type Bps, type Paise, scale } from "@/lib/money";

export type PricingBasis =
  | {
      readonly mode: "margin";
      /** Full product cost: food, packaging, anything attributable. */
      readonly productCost: Paise;
      /** Target share of the selling price kept as profit. */
      readonly targetMarginBps: Bps;
      /** Payment-processing fee, if the order is paid online. */
      readonly gatewayFeeBps?: Bps;
    }
  | {
      readonly mode: "foodCost";
      /** Ingredients only — packaging is deliberately excluded. */
      readonly ingredientCost: Paise;
      readonly targetFoodCostBps: Bps;
    };

/**
 * The price that hits the target.
 *
 * Margin is a share of the *selling price*, not a markup on cost. A 30% margin
 * on a ₹70 product is ₹100, not ₹91 — getting this backwards is the single
 * most common pricing error, and it underprices by the square of the mistake as
 * margins get thicker.
 */
export function requiredPrice(basis: PricingBasis): Paise {
  if (basis.mode === "foodCost") {
    if (basis.targetFoodCostBps <= 0) {
      throw new Error("A food cost target of 0% would need an infinite price.");
    }
    if (basis.targetFoodCostBps > 10_000) {
      throw new Error("A food cost target above 100% prices the dish below its ingredients.");
    }
    return scale(basis.ingredientCost, 10_000, basis.targetFoodCostBps);
  }

  if (basis.targetMarginBps >= 10_000) {
    throw new Error("A margin of 100% or more is unreachable — the cost has to come from somewhere.");
  }
  if (basis.targetMarginBps < 0) {
    throw new Error("A negative margin target would price the product below cost.");
  }

  const keptAfterMargin = (10_000 - basis.targetMarginBps) as Bps;
  const beforeFees = scale(basis.productCost, 10_000, keptAfterMargin);

  const gatewayFeeBps = basis.gatewayFeeBps ?? 0;
  if (gatewayFeeBps === 0) {
    return beforeFees;
  }
  if (gatewayFeeBps >= 10_000) {
    throw new Error("A gateway fee of 100% or more leaves nothing of the price.");
  }
  const keptAfterGateway = (10_000 - gatewayFeeBps) as Bps;
  return scale(beforeFees, 10_000, keptAfterGateway);
}

/** The margin a price actually achieves — the inverse, for the menu review. */
export function achievedMarginBps(sellingPrice: Paise, productCost: Paise): Bps | null {
  if (sellingPrice <= 0n) {
    return null;
  }
  return Number(((sellingPrice - productCost) * 10_000n) / sellingPrice) as Bps;
}

/** Rounds a computed price up to a whole rupee — nobody prints ₹117.43 on a board. */
export function toMenuPrice(price: Paise): Paise {
  const remainder = price % 100n;
  return (remainder === 0n ? price : price + (100n - remainder)) as Paise;
}
