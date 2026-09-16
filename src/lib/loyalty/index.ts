/**
 * Loyalty points.
 *
 * Points are worth money, so they follow the money rules: whole integers,
 * exact arithmetic, and a value in paise that nothing else redefines.
 *
 * FRYBIRD gives 5% back as points, where one point is one rupee, spendable
 * against any order with no minimum. Both numbers live on the organization —
 * changing what loyalty costs is a settings change, not a deploy.
 */

import { type Bps, type Paise, ZERO, multiply, percentOf, subtract } from "@/lib/money";

export interface LoyaltyConfig {
  /** Share of qualifying spend returned as points. 500 bps is 5%. */
  readonly earnBps: Bps;
  /** What one point is worth when spent. 100 paise is ₹1. */
  readonly pointValue: Paise;
  /** Points needed before any can be spent. Zero means no minimum. */
  readonly minRedeemPoints: number;
}

export const LOYALTY_DISABLED: LoyaltyConfig = {
  earnBps: 0,
  pointValue: ZERO,
  minRedeemPoints: 0,
};

export function isLoyaltyEnabled(config: LoyaltyConfig): boolean {
  return config.earnBps > 0 && config.pointValue > ZERO;
}

/**
 * Points earned on an order.
 *
 * Earned on the food, not on the delivery fee. A delivery charge covers the
 * rider's petrol; paying a customer 5% of it back is giving away money on a
 * cost rather than rewarding a purchase.
 *
 * Rounded down. A part point is not a point, and rounding up would mean an
 * order of a few rupees earns one — which is a rounding rule, not a reward.
 */
export function pointsEarned(qualifyingSpend: Paise, config: LoyaltyConfig): number {
  if (!isLoyaltyEnabled(config) || qualifyingSpend <= ZERO) return 0;
  const value = percentOf(qualifyingSpend, config.earnBps);
  return Number(value / config.pointValue);
}

/** What a number of points is worth in money. */
export function pointsValue(points: number, config: LoyaltyConfig): Paise {
  if (points <= 0 || !isLoyaltyEnabled(config)) return ZERO;
  return multiply(config.pointValue, Math.floor(points));
}

export interface Redemption {
  /** Points actually spent. */
  readonly points: number;
  /** What they take off the order. */
  readonly discount: Paise;
  /** Why fewer points were spent than were asked for, if that happened. */
  readonly cappedBy: "balance" | "order-total" | "minimum" | null;
}

/**
 * Works out how many points can actually be spent on an order.
 *
 * Capped at the order total: points may pay for an order in full but never
 * leave the shop owing money. A customer with 900 points on a ₹300 order
 * spends 300 of them and keeps the rest.
 *
 * Returns the cap that bit, so the interface can say why rather than silently
 * spending a different number than the customer chose.
 */
export function redeem({
  requestedPoints,
  balance,
  orderTotal,
  config,
}: {
  requestedPoints: number;
  balance: number;
  orderTotal: Paise;
  config: LoyaltyConfig;
}): Redemption {
  if (!isLoyaltyEnabled(config) || requestedPoints <= 0 || balance <= 0 || orderTotal <= ZERO) {
    return { points: 0, discount: ZERO, cappedBy: null };
  }

  if (balance < config.minRedeemPoints) {
    return { points: 0, discount: ZERO, cappedBy: "minimum" };
  }

  let points = Math.floor(requestedPoints);
  let cappedBy: Redemption["cappedBy"] = null;

  if (points > balance) {
    points = balance;
    cappedBy = "balance";
  }

  // Points that would exceed the order total are not spent at all, rather than
  // spent and refunded as a credit nobody asked for.
  const affordable = Number(orderTotal / config.pointValue);
  if (points > affordable) {
    points = affordable;
    cappedBy = "order-total";
  }

  return { points, discount: pointsValue(points, config), cappedBy };
}

/** The most a balance could take off this order, for showing an offer. */
export function maxRedeemable(balance: number, orderTotal: Paise, config: LoyaltyConfig): Redemption {
  return redeem({ requestedPoints: balance, balance, orderTotal, config });
}

/** What is left to pay after points are applied. */
export function remainingAfterPoints(orderTotal: Paise, redemption: Redemption): Paise {
  return subtract(orderTotal, redemption.discount);
}

/**
 * How many points a refund can actually claw back from a balance.
 *
 * Floors at zero rather than going negative: `pointsBalance` is a mutable
 * cache, not a real count the way a stamp tally is, and a customer may
 * already have spent some or all of what this order earned on a later
 * order before this one was refunded. This account owing FRYBIRD points
 * back is not a real state the program has, so the reversal takes what is
 * there and no more — `src/lib/repositories/loyalty.ts`'s
 * `reversePointsForOrder` still records the full amount in the ledger.
 */
export function pointsReclaimable(currentBalance: number, earnedByThisOrder: number): number {
  return Math.max(Math.min(currentBalance, earnedByThisOrder), 0);
}
