/**
 * The IQ metric catalog — IQ-1 slice S1.
 *
 * One entry per metric, so every screen, job and AI tool that names a figure
 * names the same definition. Design: hive/reviews/iq-1/DESIGN.md ("Catalog
 * rules", "Tables", "Trust signals"); adopted answers in REVIEW.md.
 *
 * Two kinds, kept apart on purpose:
 *
 * - **Stored** metrics are additive daily facts. They are the only thing
 *   `iq_daily_facts` holds: a sum over one IST business day, in paise or a
 *   count, that can be summed again across days, channels or products.
 * - **Derived** metrics (AOV, food cost %, profit, channel share) are computed
 *   at read time from summed stored inputs — Σ÷Σ, never an average of daily
 *   ratios — by `./derive`. A ratio is never stored.
 *
 * Pure data. No database, no framework. Table names below are strings for
 * documentation and lineage, not imports of the schema.
 */

/** Additive facts written to `iq_daily_facts`. */
export const STORED_METRIC_IDS = [
  "orders_paid",
  "revenue_net",
  "revenue_net_by_product",
  "units_sold",
  "gst_output",
  "sales_gross",
  "points_tender",
  "discount_total",
  "orders_comp",
  "orders_cancelled",
  "orders_failed",
  "orders_refunded",
  "orders_part_refunded",
  "refunds_amount",
  "captured_amount",
  "expense_direct",
  "expense_operating",
  "expense_nonoperating",
  "food_cost_theoretical",
  "food_cost_actual",
  "waste_cost",
  "sale_lines_costed",
  "sale_lines_total",
] as const;

/** Computed at read time from stored inputs. Never written to a table. */
export const DERIVED_METRIC_IDS = [
  "aov_net",
  "food_cost_pct_theoretical",
  "food_cost_pct_recorded_purchases",
  "gross_profit",
  "net_profit",
  "channel_share",
  "gross_margin_bps",
  "net_margin_bps",
  "net_collected",
] as const;

export type MetricId = (typeof STORED_METRIC_IDS)[number];
export type DerivedMetricId = (typeof DERIVED_METRIC_IDS)[number];
export type AnyMetricId = MetricId | DerivedMetricId;

/** What a stored value counts. Matches `iq_daily_facts.unit`. */
export const METRIC_UNITS = ["paise", "count"] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];

/** A derived figure may also be a ratio, in basis points (10_000 = 100%). */
export const DERIVED_METRIC_UNITS = ["paise", "bps"] as const;
export type DerivedMetricUnit = (typeof DERIVED_METRIC_UNITS)[number];

/**
 * Which side of GST a money figure sits on. `net` excludes GST (the only
 * basis a margin may use), `gross` is what the customer paid, `tax` is GST
 * itself, `cost` is an ingredient or expense cost, `none` is a count.
 *
 * `listed` follows the org's `organizations.price_basis`: excluding GST under
 * `exclusive`, including it under `inclusive` (the column default). A discount
 * comes off the listed price before tax (`priceLine` in src/lib/pricing), so
 * it is net only for an exclusive-pricing org and must not be added to or
 * subtracted from a `net` figure without knowing the basis.
 */
export const METRIC_BASES = ["net", "gross", "tax", "cost", "listed", "none"] as const;
export type MetricBasis = (typeof METRIC_BASES)[number];

export const METRIC_GRAINS = ["day"] as const;
export type MetricGrain = (typeof METRIC_GRAINS)[number];

/**
 * Breakdown keys a fact may carry in `dimension_key`. The undimensioned total
 * (key '' and value '') is always allowed and is not listed.
 */
export const METRIC_DIMENSIONS = ["channel", "product", "expense_category"] as const;
export type MetricDimension = (typeof METRIC_DIMENSIONS)[number];

/**
 * The `dimension_value` of the extra product row that carries everything on
 * the order that is not a line — delivery fee taxable value today. Its amount
 * is the residual Σ revenue_net − Σ order_items.line_taxable over the same
 * sale set (`feesRowAmount`), so `revenue_net_by_product` sums to
 * `revenue_net` exactly (D10). Only `revenue_net_by_product` carries it.
 */
export const FEES_DIMENSION_VALUE = "__fees__";

/**
 * The `dimension_value` for an order line whose `order_items.product_id` is
 * null. The column is nullable and `set null` on delete, so a product removed
 * from the menu keeps its sales history under this bucket rather than
 * dropping out of the product sum.
 */
export const NO_PRODUCT_DIMENSION_VALUE = "__no_product__";

/**
 * What `dimension_value` holds for each dimension. Ids, never display names:
 * a rename must not split one product or category into two series.
 */
export const METRIC_DIMENSION_VALUES: Readonly<Record<MetricDimension, string>> = {
  channel: "orders.channel enum value (DINE_IN, TAKEAWAY, ONLINE).",
  product: `order_items.product_id (uuid); "${NO_PRODUCT_DIMENSION_VALUE}" when it is null; "${FEES_DIMENSION_VALUE}" for revenue_net − Σ line_taxable.`,
  expense_category:
    "expense_categories.id (uuid), never the name. Changing a category's behaviour (DIRECT/FIXED) or is_non_operating moves its past expenses between expense metrics: every day with an expense in it must be recomputed, facts are not restated automatically.",
};

/**
 * Whether v1 can compute a stored metric from a column that exists today.
 * `not_yet_available` metrics stay in the catalog so the id and label are
 * reserved, but the fact job skips them (`V1_COMPUTED_METRIC_IDS`) and no
 * derived metric may use them.
 */
export const METRIC_AVAILABILITIES = ["available", "not_yet_available"] as const;
export type MetricAvailability = (typeof METRIC_AVAILABILITIES)[number];

/** Trust signals from the design, stored in `iq_daily_trust.signal_id`. */
export const TRUST_SIGNAL_IDS = [
  "t1_recipe_coverage",
  "t1b_costed_sale_rows",
  "t2_price_freshness",
  "t3_stock_count_recency",
  "t4_waste_logging",
  "t5_clock_sanity",
  "t6_payment_integrity",
  "t7_cost_recording",
] as const;
export type TrustSignalId = (typeof TRUST_SIGNAL_IDS)[number];

export const TRUST_SIGNAL_DESCRIPTIONS: Readonly<Record<TrustSignalId, string>> = {
  t1_recipe_coverage: "Share of net line value sold whose product has a costed recipe.",
  t1b_costed_sale_rows: "Share of SALE movements that carry a cost.",
  t2_price_freshness: "Share of ingredient usage (weighted) priced within the freshness window.",
  t3_stock_count_recency: "Share of stocked items counted within the last 7 days.",
  t4_waste_logging: "Sales days in the week with waste logged.",
  t5_clock_sanity: "Timezone setting, business_date vs created_at IST day, placed_at vs created_at drift, future rows, app vs DB clock.",
  t6_payment_integrity: "Multiple CAPTURED payments, partial refunds, cancelled-with-capture-no-refund, captured differs from grand total.",
  t7_cost_recording: "DIRECT expenses recorded in the month and within the last 7 days.",
};

export const DEFINITION_VERSION = 1 as const;

export interface StoredMetricDefinition {
  readonly id: MetricId;
  readonly kind: "stored";
  readonly unit: MetricUnit;
  readonly basis: MetricBasis;
  readonly grain: MetricGrain;
  readonly allowedDimensions: readonly MetricDimension[];
  /** `not_yet_available`: no reliable source column; excluded from v1 computation. */
  readonly availability: MetricAvailability;
  /** Tables the fact is computed from. Lineage only. Empty when not yet available. */
  readonly sources: readonly string[];
  readonly definitionVersion: number;
  readonly description: string;
  /** A metric's trust is the lowest grade among these signals. */
  readonly trustSignals: readonly TrustSignalId[];
}

export interface DerivedMetricDefinition {
  readonly id: DerivedMetricId;
  readonly kind: "derived";
  readonly unit: DerivedMetricUnit;
  readonly basis: MetricBasis;
  readonly grain: MetricGrain;
  readonly allowedDimensions: readonly MetricDimension[];
  /** Stored metrics summed before the derivation. Its trust is the union of theirs. */
  readonly inputs: readonly MetricId[];
  /** `available` only when every input is. */
  readonly availability: MetricAvailability;
  readonly definitionVersion: number;
  readonly description: string;
  readonly trustSignals: readonly TrustSignalId[];
}

// Source sets reused across entries.
const SALE_SET = ["orders", "payments"] as const;
const SALE_SET_LINES = ["orders", "order_items", "payments"] as const;
const EXPENSES = ["expenses", "expense_categories"] as const;

// Every figure anchored to a business day depends on the clocks being sane.
const SALES_TRUST = ["t5_clock_sanity", "t6_payment_integrity"] as const;

function stored<K extends MetricId>(
  entry: Omit<StoredMetricDefinition, "id" | "kind" | "grain" | "definitionVersion" | "availability"> & {
    readonly id: K;
    readonly availability?: MetricAvailability;
  },
): StoredMetricDefinition & { readonly id: K } {
  return { availability: "available", ...entry, kind: "stored", grain: "day", definitionVersion: DEFINITION_VERSION };
}

export const METRIC_CATALOG: { readonly [K in MetricId]: StoredMetricDefinition & { readonly id: K } } = {
  orders_paid: stored({
    id: "orders_paid",
    unit: "count",
    basis: "none",
    allowedDimensions: ["channel"],
    sources: SALE_SET,
    description: "Orders in the sale set (analytics.ts saleSetWhere, shared with the P&L): a CAPTURED or PARTIALLY_REFUNDED payment, counted once, not CANCELLED/FAILED/REFUNDED, on the order's created_at IST day.",
    trustSignals: SALES_TRUST,
  }),
  revenue_net: stored({
    id: "revenue_net",
    unit: "paise",
    basis: "net",
    allowedDimensions: ["channel"],
    sources: SALE_SET,
    description: "Σ orders.taxable_total over the sale set — revenue excluding GST, including the delivery fee's taxable value.",
    trustSignals: SALES_TRUST,
  }),
  revenue_net_by_product: stored({
    id: "revenue_net_by_product",
    unit: "paise",
    basis: "net",
    allowedDimensions: ["product"],
    sources: SALE_SET_LINES,
    description: `Σ order_items.line_taxable by order_items.product_id over the sale set ("${NO_PRODUCT_DIMENSION_VALUE}" when null), plus a "${FEES_DIMENSION_VALUE}" row = revenue_net − Σ line_taxable so products sum to revenue_net. Label that row "Fees and adjustments", not "Delivery fees": any order-level amount outside the lines lands there, and it can be negative.`,
    trustSignals: SALES_TRUST,
  }),
  units_sold: stored({
    id: "units_sold",
    unit: "count",
    basis: "none",
    allowedDimensions: ["product"],
    sources: SALE_SET_LINES,
    description: `Σ order_items.quantity by order_items.product_id over the sale set ("${NO_PRODUCT_DIMENSION_VALUE}" when null). No fees row.`,
    trustSignals: SALES_TRUST,
  }),
  gst_output: stored({
    id: "gst_output",
    unit: "paise",
    basis: "tax",
    allowedDimensions: ["channel"],
    sources: SALE_SET,
    description: "Σ orders.tax_total over the sale set — GST collected for the government, never revenue. Includes delivery-fee GST, which the GST export omits (D9): never show the two side by side until S11.",
    trustSignals: SALES_TRUST,
  }),
  sales_gross: stored({
    id: "sales_gross",
    unit: "paise",
    basis: "gross",
    allowedDimensions: ["channel"],
    sources: SALE_SET,
    description: "Σ orders.grand_total over the sale set — what customers were charged, GST included, after points (points are tender, F5), so it is below taxable_total + tax_total on any order that spent points.",
    trustSignals: SALES_TRUST,
  }),
  points_tender: stored({
    id: "points_tender",
    unit: "paise",
    basis: "gross",
    allowedDimensions: ["channel"],
    availability: "not_yet_available",
    sources: [],
    description:
      "NOT YET AVAILABLE — not computed in v1. Value of loyalty points redeemed over the sale set, tender not discount until the CA decides (F5). No paise column records it: orders.points_redeemed and loyalty_transactions.points are point counts, and the point value is live org config, not snapshotted per order; taxable_total + tax_total − grand_total holds only by an application invariant. Needs an orders points-value snapshot column first.",
    trustSignals: SALES_TRUST,
  }),
  discount_total: stored({
    id: "discount_total",
    unit: "paise",
    basis: "listed",
    allowedDimensions: ["channel"],
    sources: SALE_SET,
    description: "Σ orders.discount_total over the sale set — promotions and stamp rewards, taken off the listed price before GST (excl. GST for an exclusive-pricing org, incl. GST for inclusive). Points are not a discount (F5).",
    trustSignals: SALES_TRUST,
  }),
  orders_comp: stored({
    id: "orders_comp",
    unit: "count",
    basis: "none",
    allowedDimensions: ["channel"],
    sources: SALE_SET,
    description: "Sale-set orders with orders.taxable_total = 0 (fully comped, e.g. a 100% stamp reward). Not grand_total: that is after points, and an order paid in points is tendered, not comped (F5). Proposal.",
    trustSignals: SALES_TRUST,
  }),
  orders_cancelled: stored({
    id: "orders_cancelled",
    unit: "count",
    basis: "none",
    allowedDimensions: ["channel"],
    sources: ["orders"],
    description: "Orders in CANCELLED status, on the created_at IST day. FAILED is counted separately (D12).",
    trustSignals: SALES_TRUST,
  }),
  orders_failed: stored({
    id: "orders_failed",
    unit: "count",
    basis: "none",
    allowedDimensions: ["channel"],
    sources: ["orders"],
    description: "Orders in FAILED status, on the created_at IST day.",
    trustSignals: ["t5_clock_sanity"],
  }),
  orders_refunded: stored({
    id: "orders_refunded",
    unit: "count",
    basis: "none",
    allowedDimensions: ["channel"],
    sources: ["orders"],
    description: "Orders in REFUNDED order status, on the order's created_at IST day in v1 (not the refund's day). Read from the order, not its payments: a double-captured order with one payment refunded is still sold and counts in orders_part_refunded.",
    trustSignals: SALES_TRUST,
  }),
  orders_part_refunded: stored({
    id: "orders_part_refunded",
    unit: "count",
    basis: "none",
    allowedDimensions: ["channel"],
    sources: ["orders", "payments"],
    description: "Sale-set orders (still sold) with a payment PARTIALLY_REFUNDED or REFUNDED, on the order's created_at IST day in v1 (not the refund's day). There is no partial-refund order status. Counted once at full taxable_total (fin-3); the revenue reduction waits on dec-9.",
    trustSignals: SALES_TRUST,
  }),
  refunds_amount: stored({
    id: "refunds_amount",
    unit: "paise",
    basis: "gross",
    allowedDimensions: [],
    sources: ["refunds", "payments"],
    description: "Σ refunds.amount on the refund's own IST day (F1), anchored on refunds.created_at in v1 until ref-1 adds finalized_at (B6). refunds has no status column yet; a row is written only after the provider confirms (payments.ts), so every row is a succeeded refund. Once status exists, SUCCEEDED only. Switches to SUCCEEDED + finalized_at in the refund (ref-1) release.",
    trustSignals: SALES_TRUST,
  }),
  captured_amount: stored({
    id: "captured_amount",
    unit: "paise",
    basis: "gross",
    allowedDimensions: [],
    sources: ["payments"],
    description: "Σ payments.amount of payments ever captured (CAPTURED, PARTIALLY_REFUNDED, REFUNDED), anchored on captured_at (F8). Each payment row counts, so a double capture counts twice. Wider than finance.ts \"Captured\", which filters CAPTURED only. Label it \"Money taken\", never \"Captured\", until finance.ts moves to the same set.",
    trustSignals: SALES_TRUST,
  }),
  expense_direct: stored({
    id: "expense_direct",
    unit: "paise",
    basis: "cost",
    allowedDimensions: ["expense_category"],
    sources: EXPENSES,
    description: "Σ expenses in DIRECT, operating categories, on the paid_on IST date. Org-level. Dimension value is expense_categories.id; recompute affected days when a category changes behaviour.",
    trustSignals: ["t7_cost_recording"],
  }),
  expense_operating: stored({
    id: "expense_operating",
    unit: "paise",
    basis: "cost",
    allowedDimensions: ["expense_category"],
    sources: EXPENSES,
    description: "Σ expenses in FIXED, operating categories, on the paid_on IST date. Org-level. Dimension value is expense_categories.id; recompute affected days when a category changes behaviour.",
    trustSignals: [],
  }),
  expense_nonoperating: stored({
    id: "expense_nonoperating",
    unit: "paise",
    basis: "cost",
    allowedDimensions: ["expense_category"],
    sources: EXPENSES,
    description: "Σ expenses in non-operating categories, on the paid_on IST date. Excluded from profit. Org-level. Dimension value is expense_categories.id; recompute affected days when is_non_operating changes.",
    trustSignals: [],
  }),
  food_cost_theoretical: stored({
    id: "food_cost_theoretical",
    unit: "paise",
    basis: "cost",
    allowedDimensions: [],
    sources: ["inventory_movements"],
    description: "Σ SALE movement total_cost on the occurred_at IST day — what the recipes say was used (v1 parity with getFoodCostComparison).",
    trustSignals: ["t1_recipe_coverage", "t1b_costed_sale_rows", "t2_price_freshness", "t5_clock_sanity"],
  }),
  food_cost_actual: stored({
    id: "food_cost_actual",
    unit: "paise",
    basis: "cost",
    allowedDimensions: [],
    sources: ["inventory_movements"],
    description: "Σ total_cost of SALE, WASTE and negative ADJUSTMENT movements on the occurred_at IST day.",
    trustSignals: [
      "t1_recipe_coverage",
      "t1b_costed_sale_rows",
      "t2_price_freshness",
      "t3_stock_count_recency",
      "t4_waste_logging",
      "t5_clock_sanity",
    ],
  }),
  waste_cost: stored({
    id: "waste_cost",
    unit: "paise",
    basis: "cost",
    allowedDimensions: [],
    sources: ["waste_entries"],
    description: "Σ waste_entries.cost on the occurred_at IST day, including cooked-then-cancelled orders.",
    trustSignals: ["t2_price_freshness", "t4_waste_logging", "t5_clock_sanity"],
  }),
  sale_lines_costed: stored({
    id: "sale_lines_costed",
    unit: "count",
    basis: "none",
    allowedDimensions: [],
    sources: ["inventory_movements"],
    description: "SALE movements carrying a cost. Numerator of t1b.",
    trustSignals: ["t5_clock_sanity"],
  }),
  sale_lines_total: stored({
    id: "sale_lines_total",
    unit: "count",
    basis: "none",
    allowedDimensions: [],
    sources: ["inventory_movements"],
    description: "All SALE movements. Denominator of t1b.",
    trustSignals: ["t5_clock_sanity"],
  }),
};

/** Stored metrics the v1 fact job computes. `not_yet_available` ones are skipped. */
export const V1_COMPUTED_METRIC_IDS: readonly MetricId[] = STORED_METRIC_IDS.filter(
  (id) => METRIC_CATALOG[id].availability === "available",
);

function derived<K extends DerivedMetricId>(
  entry: Omit<DerivedMetricDefinition, "id" | "kind" | "grain" | "definitionVersion" | "trustSignals" | "availability"> & {
    readonly id: K;
  },
): DerivedMetricDefinition & { readonly id: K } {
  const signals = new Set<TrustSignalId>();
  for (const input of entry.inputs) for (const signal of METRIC_CATALOG[input].trustSignals) signals.add(signal);
  return {
    ...entry,
    kind: "derived",
    grain: "day",
    definitionVersion: DEFINITION_VERSION,
    availability: entry.inputs.every((input) => METRIC_CATALOG[input].availability === "available") ? "available" : "not_yet_available",
    trustSignals: TRUST_SIGNAL_IDS.filter((id) => signals.has(id)),
  };
}

export const DERIVED_METRIC_CATALOG: { readonly [K in DerivedMetricId]: DerivedMetricDefinition & { readonly id: K } } = {
  aov_net: derived({
    id: "aov_net",
    unit: "paise",
    basis: "net",
    allowedDimensions: ["channel"],
    inputs: ["revenue_net", "orders_paid"],
    description: "Σ revenue_net ÷ Σ orders_paid. v1 truncates (parity with overview.ts); v2 rounds half-up (F12). Null with no orders, where averageOrder shows 0 today: a parity check maps null → 0.",
  }),
  food_cost_pct_theoretical: derived({
    id: "food_cost_pct_theoretical",
    unit: "bps",
    basis: "net",
    allowedDimensions: [],
    inputs: ["food_cost_theoretical", "revenue_net"],
    description: "Σ food_cost_theoretical ÷ Σ revenue_net. The Done-when food cost (F10).",
  }),
  food_cost_pct_recorded_purchases: derived({
    id: "food_cost_pct_recorded_purchases",
    unit: "bps",
    basis: "net",
    allowedDimensions: [],
    inputs: ["expense_direct", "revenue_net"],
    description: "Σ expense_direct ÷ Σ revenue_net — the expense-based food cost on today's P&L.",
  }),
  gross_profit: derived({
    id: "gross_profit",
    unit: "paise",
    basis: "net",
    allowedDimensions: [],
    inputs: ["revenue_net", "expense_direct"],
    description: "Σ revenue_net − Σ expense_direct (P&L parity).",
  }),
  net_profit: derived({
    id: "net_profit",
    unit: "paise",
    basis: "net",
    allowedDimensions: [],
    inputs: ["revenue_net", "expense_direct", "expense_operating"],
    description: "Σ revenue_net − Σ expense_direct − Σ expense_operating. Non-operating expenses excluded (P&L parity).",
  }),
  channel_share: derived({
    id: "channel_share",
    unit: "bps",
    basis: "net",
    allowedDimensions: ["channel"],
    inputs: ["revenue_net"],
    description: "Σ revenue_net for one channel ÷ Σ revenue_net across all channels.",
  }),
  gross_margin_bps: derived({
    id: "gross_margin_bps",
    unit: "bps",
    basis: "net",
    allowedDimensions: [],
    inputs: ["revenue_net", "expense_direct"],
    description: "gross_profit ÷ Σ revenue_net, half away from zero. Null when revenue ≤ 0 (parity with profit.ts grossMarginBps on the P&L page).",
  }),
  net_margin_bps: derived({
    id: "net_margin_bps",
    unit: "bps",
    basis: "net",
    allowedDimensions: [],
    inputs: ["revenue_net", "expense_direct", "expense_operating"],
    description: "net_profit ÷ Σ revenue_net, half away from zero. Null when revenue ≤ 0 (parity with profit.ts netMarginBps on the P&L page).",
  }),
  net_collected: derived({
    id: "net_collected",
    unit: "paise",
    basis: "gross",
    allowedDimensions: [],
    inputs: ["captured_amount", "refunds_amount"],
    description: "Σ captured_amount − Σ refunds_amount (F8): cash kept after refunds, GST included. Each input keeps its own day anchor (captured_at, refund day), so a day can be negative; never clamped.",
  }),
};

export function isMetricId(value: string): value is MetricId {
  return (STORED_METRIC_IDS as readonly string[]).includes(value);
}

export function isDerivedMetricId(value: string): value is DerivedMetricId {
  return (DERIVED_METRIC_IDS as readonly string[]).includes(value);
}

/** True when the v1 fact job computes this stored metric. */
export function isComputedInV1(id: MetricId): boolean {
  return METRIC_CATALOG[id].availability === "available";
}

export function getMetric(id: MetricId): StoredMetricDefinition {
  return METRIC_CATALOG[id];
}

export function getDerivedMetric(id: DerivedMetricId): DerivedMetricDefinition {
  return DERIVED_METRIC_CATALOG[id];
}
