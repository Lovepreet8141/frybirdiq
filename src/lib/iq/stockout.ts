/**
 * Smart 86 — read-only, advisory. Roadmap 3.6, docs/INVENTORY-ARCHITECTURE.md
 * §10 ("`inventoryAvailability(productId)` graduates from `"unknown"` to a
 * computed risk … it never changes availability").
 *
 * Two related but distinct signals come out of the same velocity number:
 *
 *  - a **today's-clock-time projection** ("short around 20:45") when the
 *    last 7 days' rate of consumption, run forward from right now, would
 *    exhaust the current on-hand before the business closes today — the
 *    roadmap's own worked example ("Chicken at 6 kg with 7.8 kg projected");
 *  - a coarser **days-of-cover** flag (roughly 2 days, docs/ROADMAP.md's own
 *    "Decisions needed" line) for an ingredient that is not going to run out
 *    today but is trending low, plus a manual `reorderThreshold` the owner
 *    can set per ingredient as an override that does not depend on velocity
 *    at all — useful for an ingredient with no sales history yet, or one
 *    the owner wants to reorder earlier than the math alone would flag.
 *
 * `assessIngredientStock` is the one place these combine into a single
 * `StockRisk`, so the ingredient list and a product's own risk (the
 * graduated `inventoryAvailability`) can never disagree about what "at
 * risk" means. Pure — the repository supplies on-hand, the 7-day
 * consumption total, the business's open hours and the clock; this file
 * only does the arithmetic and the threshold rules, so it is testable
 * without a database.
 */

/** Days of cover at or below this is "at risk", even when today itself is safe. docs/ROADMAP.md §Phase 3 "Decisions needed". */
export const AT_RISK_DAYS_OF_COVER = 2;

export type StockRisk = "ok" | "at_risk" | "stockout_today";

/** Ranks a `StockRisk` for comparison — which of several ingredients (e.g. a recipe's lines) is the limiting one. */
export const STOCK_RISK_RANK: Readonly<Record<StockRisk, number>> = { ok: 0, at_risk: 1, stockout_today: 2 };

export interface VelocityInput {
  /** Current on-hand, in the ingredient's base unit. */
  readonly onHandBase: number;
  /** Total consumed (SALE movements, magnitude) over the trailing window. */
  readonly consumedBase: number;
  /** Hours the business was actually open across that same window — velocity only counts hours something could have been sold. */
  readonly openHoursInWindow: number;
  /** A manual per-ingredient floor the owner can set (`inventory_items.reorderThreshold`); below it is "at risk" regardless of velocity. Null if never set. */
  readonly reorderThresholdBase: number | null;
}

export interface VelocityAssessment {
  /** Base units consumed per hour, from the trailing window. Zero when there is no sales history to measure from — "at risk" can then only come from the manual threshold. */
  readonly ratePerHour: number;
  /** On-hand ÷ (rate × 24). Null when the rate is zero — nothing to divide by, and "infinite cover" is not a number worth showing. */
  readonly daysOfCover: number | null;
  readonly belowReorderThreshold: boolean;
  /** Days-of-cover or manual-threshold risk — before today's clock-time projection is folded in. */
  readonly atRisk: boolean;
}

/** Base units consumed per hour, from a trailing window's total. Zero (not a divide-by-zero) when the business was never open across it. */
export function hourlyRate(consumedBase: number, openHoursInWindow: number): number {
  if (openHoursInWindow <= 0) return 0;
  return Math.max(consumedBase, 0) / openHoursInWindow;
}

/** The velocity read on an ingredient, independent of the clock. */
export function assessVelocity(input: VelocityInput): VelocityAssessment {
  const ratePerHour = hourlyRate(input.consumedBase, input.openHoursInWindow);
  const daysOfCover = ratePerHour > 0 ? input.onHandBase / (ratePerHour * 24) : null;
  const belowReorderThreshold = input.reorderThresholdBase !== null && input.onHandBase <= input.reorderThresholdBase;
  const atRisk = belowReorderThreshold || (daysOfCover !== null && daysOfCover <= AT_RISK_DAYS_OF_COVER);
  return { ratePerHour, daysOfCover, belowReorderThreshold, atRisk };
}

/**
 * When on-hand would hit zero today, at the current rate — "short around
 * 20:45". Null when the rate is zero, or the projected moment falls at or
 * after closing (a real risk, but not a clock time today — the
 * days-of-cover flag carries it instead). Callers check `onHandBase <= 0`
 * separately: stock already at zero is "already out", not a future
 * projection, even though the arithmetic below would otherwise place it at
 * `now`.
 */
export function projectedStockoutInstant(onHandBase: number, ratePerHour: number, now: Date, closingInstant: Date): Date | null {
  if (onHandBase <= 0 || ratePerHour <= 0) return null;
  const hoursUntilStockout = onHandBase / ratePerHour;
  const instant = new Date(now.getTime() + hoursUntilStockout * 3_600_000);
  return instant.getTime() > now.getTime() && instant.getTime() <= closingInstant.getTime() ? instant : null;
}

export interface IngredientStockAssessment extends VelocityAssessment {
  readonly alreadyOut: boolean;
  /** Set only when `risk` is "stockout_today" from a projection rather than already being out — the clock time to show. */
  readonly stockoutInstant: Date | null;
  readonly risk: StockRisk;
}

/**
 * The single combined risk for one ingredient at one moment — used both for
 * the ingredient-level Smart 86 list and, per recipe line, for a product's
 * own graduated `inventoryAvailability`. Already-out and "runs out before
 * close" both read as `"stockout_today"`; the caller distinguishes them by
 * `alreadyOut` for copy ("out now" vs "short around HH:MM").
 */
export function assessIngredientStock(input: VelocityInput & { readonly now: Date; readonly closingInstant: Date }): IngredientStockAssessment {
  const velocity = assessVelocity(input);
  const alreadyOut = input.onHandBase <= 0;
  const stockoutInstant = alreadyOut ? null : projectedStockoutInstant(input.onHandBase, velocity.ratePerHour, input.now, input.closingInstant);
  const risk: StockRisk = alreadyOut || stockoutInstant !== null ? "stockout_today" : velocity.atRisk ? "at_risk" : "ok";
  return { ...velocity, alreadyOut, stockoutInstant, risk };
}
