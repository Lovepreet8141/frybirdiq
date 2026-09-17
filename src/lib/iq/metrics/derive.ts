/**
 * Derived IQ metrics, computed at read time from summed additive facts.
 *
 * Always Σ÷Σ: sum the stored inputs over the whole range first, then divide
 * once. Averaging daily ratios weights a ₹500 day the same as a ₹50,000 day
 * and is wrong. Nothing here is ever stored (DESIGN.md "Catalog rules").
 *
 * All money arithmetic goes through `src/lib/money`. A ratio with no
 * denominator (no orders, no revenue) is `null`, never zero — a closed day is
 * not a 0% food cost day, the same rule as `src/lib/iq/profit.ts`.
 */

import { type Bps, type Paise, add, paise, ratioBps, scale, subtract } from "@/lib/money";

/** Σ of daily paise facts. */
export function sumPaise(values: readonly Paise[]): Paise {
  return add(...values);
}

/** Σ of daily count facts. Counts are stored as bigint like every fact value. */
export function sumCount(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

function toCount(count: bigint | number): bigint {
  if (typeof count === "number" && !Number.isInteger(count)) {
    throw new RangeError(`metrics: ${count} is not a whole count`);
  }
  return BigInt(count);
}

/**
 * `part / whole` in basis points, half away from zero (`ratioBps`). Null when
 * the whole is zero or negative: a share of nothing, or of a net refund, has
 * no meaningful percentage.
 */
export function ratioBpsOrNull(part: Paise, whole: Paise): Bps | null {
  return whole > 0n ? ratioBps(part, whole) : null;
}

/**
 * Average order value, definition v1: TRUNCATES toward zero, exactly as
 * `averageOrder` in overview.ts does today. Kept for parity; do not use for
 * new screens. Null when there are no orders.
 */
export function aovNetV1(revenueNet: Paise, ordersPaid: bigint | number): Paise | null {
  const orders = toCount(ordersPaid);
  if (orders <= 0n) return null;
  return paise(revenueNet / orders);
}

/** Average order value, definition v2: rounds half away from zero via `scale` (F12). */
export function aovNetV2(revenueNet: Paise, ordersPaid: bigint | number): Paise | null {
  const orders = toCount(ordersPaid);
  if (orders <= 0n) return null;
  return scale(revenueNet, 1n, orders);
}

/** "Food cost – recipe": Σ food_cost_theoretical ÷ Σ revenue_net. */
export function foodCostPctTheoretical(foodCostTheoretical: Paise, revenueNet: Paise): Bps | null {
  return ratioBpsOrNull(foodCostTheoretical, revenueNet);
}

/** "Food cost – recorded purchases": Σ expense_direct ÷ Σ revenue_net. */
export function foodCostPctRecordedPurchases(expenseDirect: Paise, revenueNet: Paise): Bps | null {
  return ratioBpsOrNull(expenseDirect, revenueNet);
}

/** Σ revenue_net − Σ expense_direct. Same composition as `getProfitAndLoss`. */
export function grossProfit(revenueNet: Paise, expenseDirect: Paise): Paise {
  return subtract(revenueNet, expenseDirect);
}

/** Σ revenue_net − Σ expense_direct − Σ expense_operating. Non-operating expenses stay out. */
export function netProfit(revenueNet: Paise, expenseDirect: Paise, expenseOperating: Paise): Paise {
  return subtract(grossProfit(revenueNet, expenseDirect), expenseOperating);
}

/** One channel's Σ revenue_net as a share of Σ revenue_net across channels. */
export function channelShare(channelRevenueNet: Paise, totalRevenueNet: Paise): Bps | null {
  return ratioBpsOrNull(channelRevenueNet, totalRevenueNet);
}
