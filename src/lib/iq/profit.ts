/**
 * Profit and the margins on it.
 *
 * Two costs, kept apart on purpose. Direct costs move with every plate sold —
 * chicken, oil, the box. Operating expenses do not — rent is the same whether
 * you sell fifty burgers or five hundred. Adding them together produces a
 * single "cost" number that cannot answer either question an owner actually
 * has: is this dish worth selling, and is this month worth opening for.
 */

import { type Bps, type Paise, paise, ratioBps, subtract, ZERO } from "@/lib/money";

export interface ProfitInput {
  readonly revenue: Paise;
  /** Food and packaging — costs that scale with volume. */
  readonly directCosts: Paise;
  /** Rent, wages, gas, electricity — costs that do not. */
  readonly operatingExpenses: Paise;
}

export interface ProfitResult {
  readonly revenue: Paise;
  readonly directCosts: Paise;
  readonly operatingExpenses: Paise;
  readonly grossProfit: Paise;
  readonly netProfit: Paise;
  /** Gross profit as a share of revenue. Null when there was no revenue. */
  readonly grossMarginBps: Bps | null;
  readonly netMarginBps: Bps | null;
  /** Direct costs as a share of revenue — "food cost percentage". */
  readonly foodCostBps: Bps | null;
}

/**
 * Margins are null rather than zero on a day with no sales. Zero would render
 * as "0% margin", which reads as a catastrophically bad day rather than a
 * closed one, and would drag any average that includes it.
 */
export function profit(input: ProfitInput): ProfitResult {
  const grossProfit = subtract(input.revenue, input.directCosts);
  const netProfit = subtract(grossProfit, input.operatingExpenses);
  const hasRevenue = input.revenue > ZERO;

  return {
    revenue: input.revenue,
    directCosts: input.directCosts,
    operatingExpenses: input.operatingExpenses,
    grossProfit,
    netProfit,
    grossMarginBps: hasRevenue ? ratioBps(grossProfit, input.revenue) : null,
    netMarginBps: hasRevenue ? ratioBps(netProfit, input.revenue) : null,
    foodCostBps: hasRevenue ? ratioBps(input.directCosts, input.revenue) : null,
  };
}

/** One product's contribution: what selling it adds before any fixed cost. */
export function contribution(sellingPrice: Paise, productCost: Paise): Paise {
  return subtract(sellingPrice, productCost);
}

/** A cost line as a share of revenue, for the P&L's percentage column. */
export function shareOfRevenueBps(amount: Paise, revenue: Paise): Bps | null {
  return revenue > ZERO ? ratioBps(amount, revenue) : null;
}

/** Sums a column of amounts. */
export function total(amounts: readonly Paise[]): Paise {
  return amounts.reduce<Paise>((sum, amount) => paise(sum + amount), ZERO);
}
