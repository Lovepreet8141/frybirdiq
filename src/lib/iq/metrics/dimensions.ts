/**
 * `dimension_value` rules for IQ facts, as pure functions so the fact job and
 * its tests agree on them. See `METRIC_DIMENSION_VALUES` in ./catalog.
 */

import { type Paise, add, subtract } from "@/lib/money";

import { NO_PRODUCT_DIMENSION_VALUE } from "./catalog";

/**
 * The product dimension value for an order line: its `order_items.product_id`,
 * or `NO_PRODUCT_DIMENSION_VALUE` when the column is null (the product was
 * deleted and the foreign key set null). Never the product name or slug.
 */
export function productDimensionValue(productId: string | null | undefined): string {
  return productId === null || productId === undefined || productId === "" ? NO_PRODUCT_DIMENSION_VALUE : productId;
}

/**
 * The amount on the `__fees__` product row: Σ revenue_net − Σ line_taxable over
 * the same sale set, so the product rows sum to revenue_net exactly. Not
 * clamped: a negative residual means order and line totals disagree, and
 * hiding it would hide that.
 */
export function feesRowAmount(revenueNet: Paise, lineTaxable: readonly Paise[]): Paise {
  return subtract(revenueNet, add(...lineTaxable));
}
