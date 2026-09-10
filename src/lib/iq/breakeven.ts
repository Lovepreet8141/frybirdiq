/**
 * The revenue at which a month stops losing money.
 *
 *   break-even revenue = fixed costs / contribution margin
 *
 * Contribution margin is what is left of a rupee of sales after the costs that
 * moved to earn it. If food and packaging take 34 paise of every rupee, 66
 * paise is left to cover rent — so rent divided by 0.66 is the revenue needed.
 */

import { type Bps, type Paise, ZERO, scale } from "@/lib/money";

export interface BreakEvenInput {
  /** Rent, wages, and everything else that arrives whether you open or not. */
  readonly fixedCosts: Paise;
  /** Share of each rupee of revenue consumed by direct costs. */
  readonly variableCostBps: Bps;
  /** Average contribution per order, if known — turns revenue into a count. */
  readonly averageContribution?: Paise;
}

export interface BreakEvenResult {
  readonly revenue: Paise;
  /** Orders needed, rounded up. Null without an average contribution. */
  readonly orders: number | null;
  readonly contributionMarginBps: Bps;
}

export function breakEven(input: BreakEvenInput): BreakEvenResult {
  const contributionMarginBps = (10_000 - input.variableCostBps) as Bps;

  if (contributionMarginBps <= 0) {
    throw new Error(
      "Direct costs take every rupee of revenue, so there is no break-even point — the menu loses money on each sale regardless of volume.",
    );
  }

  const revenue = scale(input.fixedCosts, 10_000, contributionMarginBps);

  let orders: number | null = null;
  if (input.averageContribution !== undefined && input.averageContribution > ZERO) {
    // Ceiling: 3,001 orders' worth of fixed cost is not covered by 3,000.
    const needed = (input.fixedCosts + input.averageContribution - 1n) / input.averageContribution;
    orders = Number(needed);
  }

  return { revenue, orders, contributionMarginBps };
}

/** How far a month's actual revenue sits above or below its break-even point. */
export function surplus(actualRevenue: Paise, breakEvenRevenue: Paise): Paise {
  return (actualRevenue - breakEvenRevenue) as Paise;
}
