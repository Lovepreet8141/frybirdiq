/**
 * The stamp card — "buy 7, get the 8th free."
 *
 * A second loyalty mechanic, independent of points. Points reward what was
 * spent; the stamp card rewards showing up — one stamp per qualifying order,
 * a ₹49 sauce and a ₹599 party box earn the same one stamp. A customer earns
 * both from the same order.
 *
 * The reward is one free unit — the cheapest thing on the qualifying order —
 * not a percentage and not the whole order. That keeps the business's cost
 * bounded regardless of what the customer adds to the cart, and it is how
 * this kind of card reads on a physical one: your smallest item, on us.
 */

import { type Paise, ZERO } from "@/lib/money";

export interface StampConfig {
  readonly enabled: boolean;
  /** Orders per cycle. The Nth order — the free one — resets the count to zero. */
  readonly goal: number;
}

export const STAMP_DISABLED: StampConfig = { enabled: false, goal: 8 };

export function isStampRewardEnabled(config: StampConfig): boolean {
  return config.enabled && config.goal > 1;
}

/** Stamps needed before the next order is the free one. */
export function stampsRequired(config: StampConfig): number {
  return Math.max(0, config.goal - 1);
}

/**
 * Whether the order about to be priced is the free one — the customer has
 * already banked enough stamps that this order is the Nth in the cycle.
 */
export function isStampRewardDue(count: number, config: StampConfig): boolean {
  return isStampRewardEnabled(config) && count >= stampsRequired(config);
}

/**
 * The count after this order settles.
 *
 * A redeeming order resets the cycle rather than also banking a stamp of its
 * own — it already spent the one the count was tracking. Capped at the
 * threshold so a config change between placing and paying cannot leave the
 * count sitting past the goal it is supposed to trigger on.
 */
export function nextStampCount(count: number, redeemed: boolean, config: StampConfig): number {
  if (redeemed) return 0;
  return Math.min(count + 1, stampsRequired(config));
}

/**
 * What "the free one" is worth on this order: one unit of the cheapest line.
 *
 * Per unit, not per line — three of the cheapest item does not make three of
 * them free, only one. Takes the listed per-unit prices directly rather than
 * a cart shape, so it has no dependency on how a caller represents a line.
 */
export function stampRewardValue(lineUnitPrices: readonly Paise[]): Paise {
  let min: Paise = ZERO;
  let seen = false;
  for (const price of lineUnitPrices) {
    if (!seen || price < min) {
      min = price;
      seen = true;
    }
  }
  return min;
}
