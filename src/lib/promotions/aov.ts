/**
 * Promotion measurement: average order value with and without a promotion
 * (roadmap 7.3). Pure and read-only. It reports facts with their definitions;
 * it draws no conclusion and forecasts nothing.
 *
 * Definitions, shown on the screen next to every figure:
 * - an order is a paid, not cancelled/failed/refunded order created in the window (the sale set every revenue figure uses);
 * - "with" = those orders that carry the promotion's code; "without" = every other order in the window;
 * - AOV = net-of-GST revenue (`taxable_total`) / orders. GST is never revenue;
 * - discount = the discount stored on those orders, as computed at the time of sale.
 * A promotion with no code (one applied by rules alone) leaves no stored link to an order and cannot be measured.
 */

import { type Bps, type Paise, ZERO, add, paise, ratioBps, scale, subtract } from "@/lib/money";

/** Below this many orders on either side, a figure is labelled a small sample. */
export const SMALL_SAMPLE_ORDERS = 30;

export interface OrderFigures {
  readonly taxableTotal: Paise;
  readonly discountTotal: Paise;
}

export interface OrderGroup {
  readonly orders: number;
  readonly revenue: Paise;
  readonly discount: Paise;
  /** Null when there are no orders: "no data", never 0. */
  readonly aov: Paise | null;
}

export function summariseOrders(rows: readonly OrderFigures[]): OrderGroup {
  const revenue = add(...rows.map((r) => paise(r.taxableTotal)));
  const discount = add(...rows.map((r) => paise(r.discountTotal)));
  return { orders: rows.length, revenue, discount, aov: rows.length === 0 ? null : scale(revenue, 1, rows.length) };
}

export interface PromotionComparison {
  readonly with: OrderGroup;
  readonly without: OrderGroup;
  /** with.aov - without.aov, or null when either side has no orders. */
  readonly aovGap: Paise | null;
  /** The gap as basis points of the without-AOV, or null when it can't be stated. */
  readonly aovGapBps: Bps | null;
  /** True when either side has fewer than SMALL_SAMPLE_ORDERS orders. A label, not a verdict. */
  readonly smallSample: boolean;
}

export function comparePromotion(withPromo: readonly OrderFigures[], withoutPromo: readonly OrderFigures[]): PromotionComparison {
  const w = summariseOrders(withPromo);
  const wo = summariseOrders(withoutPromo);
  const aovGap = w.aov !== null && wo.aov !== null ? subtract(w.aov, wo.aov) : null;
  const aovGapBps = aovGap !== null && wo.aov !== null && wo.aov > ZERO ? ratioBps(aovGap, wo.aov) : null;
  return { with: w, without: wo, aovGap, aovGapBps, smallSample: w.orders < SMALL_SAMPLE_ORDERS || wo.orders < SMALL_SAMPLE_ORDERS };
}
