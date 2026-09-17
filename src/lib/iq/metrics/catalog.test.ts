import { describe, expect, it } from "vitest";

import {
  DERIVED_METRIC_CATALOG,
  DERIVED_METRIC_IDS,
  DERIVED_METRIC_UNITS,
  FEES_DIMENSION_VALUE,
  getDerivedMetric,
  getMetric,
  isComputedInV1,
  isDerivedMetricId,
  isMetricId,
  METRIC_AVAILABILITIES,
  METRIC_BASES,
  METRIC_CATALOG,
  METRIC_DIMENSION_VALUES,
  METRIC_DIMENSIONS,
  METRIC_UNITS,
  NO_PRODUCT_DIMENSION_VALUE,
  STORED_METRIC_IDS,
  TRUST_SIGNAL_DESCRIPTIONS,
  TRUST_SIGNAL_IDS,
  V1_COMPUTED_METRIC_IDS,
} from "./catalog";

const stored = Object.values(METRIC_CATALOG);
const derived = Object.values(DERIVED_METRIC_CATALOG);

describe("stored metric registry", () => {
  it("has exactly one entry per MetricId, keyed by its own id", () => {
    expect(Object.keys(METRIC_CATALOG).sort()).toEqual([...STORED_METRIC_IDS].sort());
    for (const [key, entry] of Object.entries(METRIC_CATALOG)) expect(entry.id).toBe(key);
  });

  it("has no duplicate ids", () => {
    expect(new Set(STORED_METRIC_IDS).size).toBe(STORED_METRIC_IDS.length);
  });

  it("includes every stored metric the design lists", () => {
    const designed = [
      "orders_paid", "revenue_net", "revenue_net_by_product", "units_sold", "gst_output", "sales_gross",
      "points_tender", "discount_total", "orders_comp", "orders_cancelled", "orders_failed", "orders_refunded",
      "orders_part_refunded", "refunds_amount", "captured_amount", "expense_direct", "expense_operating",
      "expense_nonoperating", "food_cost_theoretical", "food_cost_actual", "waste_cost", "sale_lines_costed",
      "sale_lines_total",
    ];
    expect([...STORED_METRIC_IDS].sort()).toEqual(designed.sort());
  });

  it("uses only valid units, bases, grains, dimensions and trust signals", () => {
    for (const entry of stored) {
      expect(entry.kind).toBe("stored");
      expect(METRIC_UNITS).toContain(entry.unit);
      expect(METRIC_BASES).toContain(entry.basis);
      expect(entry.grain).toBe("day");
      expect(entry.definitionVersion).toBe(1);
      expect(entry.description.length).toBeGreaterThan(10);
      expect(METRIC_AVAILABILITIES).toContain(entry.availability);
      if (entry.availability === "available") expect(entry.sources.length).toBeGreaterThan(0);
      else expect(entry.sources).toEqual([]);
      for (const source of entry.sources) expect(source).toMatch(/^[a-z_]+$/);
      for (const dimension of entry.allowedDimensions) expect(METRIC_DIMENSIONS).toContain(dimension);
      for (const signal of entry.trustSignals) expect(TRUST_SIGNAL_IDS).toContain(signal);
    }
  });

  it("gives counts no money basis and money a GST basis", () => {
    for (const entry of stored) {
      if (entry.unit === "count") expect(entry.basis).toBe("none");
      else expect(entry.basis).not.toBe("none");
    }
  });

  it("keeps GST out of revenue: revenue is net, GST is tax, customer totals are gross", () => {
    expect(getMetric("revenue_net")).toMatchObject({ unit: "paise", basis: "net" });
    expect(getMetric("revenue_net_by_product")).toMatchObject({ unit: "paise", basis: "net", allowedDimensions: ["product"] });
    expect(getMetric("gst_output")).toMatchObject({ unit: "paise", basis: "tax" });
    expect(getMetric("sales_gross").basis).toBe("gross");
    expect(getMetric("sales_gross").description).toContain("after points");
    expect(getMetric("captured_amount").basis).toBe("gross");
    expect(getMetric("food_cost_theoretical").basis).toBe("cost");
  });

  it("names the fees row so products sum to revenue", () => {
    expect(FEES_DIMENSION_VALUE).toBe("__fees__");
    expect(getMetric("revenue_net_by_product").description).toContain(FEES_DIMENSION_VALUE);
    expect(getMetric("revenue_net_by_product").description).toContain("revenue_net − Σ line_taxable");
    expect(getMetric("units_sold").description).not.toContain(FEES_DIMENSION_VALUE);
  });

  it("keys the product dimension on the nullable order_items.product_id, not a slug", () => {
    expect(NO_PRODUCT_DIMENSION_VALUE).toBe("__no_product__");
    expect(NO_PRODUCT_DIMENSION_VALUE).not.toBe(FEES_DIMENSION_VALUE);
    for (const id of ["revenue_net_by_product", "units_sold"] as const) {
      expect(getMetric(id).description).toContain("order_items.product_id");
      expect(getMetric(id).description).toContain(NO_PRODUCT_DIMENSION_VALUE);
      expect(getMetric(id).description).not.toContain("slug");
    }
    expect(METRIC_DIMENSION_VALUES.product).toContain("order_items.product_id");
  });

  it("documents every dimension's value, with expense categories keyed by id and a recompute note", () => {
    expect(Object.keys(METRIC_DIMENSION_VALUES).sort()).toEqual([...METRIC_DIMENSIONS].sort());
    expect(METRIC_DIMENSION_VALUES.expense_category).toContain("expense_categories.id");
    expect(METRIC_DIMENSION_VALUES.expense_category).toMatch(/recomputed/);
    for (const id of ["expense_direct", "expense_operating", "expense_nonoperating"] as const) {
      expect(getMetric(id).description).toContain("expense_categories.id");
      expect(getMetric(id).description).toMatch(/recompute/);
    }
  });

  it("counts comped orders on taxable_total, not grand_total (grand_total is after points)", () => {
    const description = getMetric("orders_comp").description;
    expect(description).toContain("orders.taxable_total = 0");
    expect(description).not.toMatch(/zero grand total/);
  });

  it("puts discounts on the org's listed-price basis, not gross", () => {
    expect(METRIC_BASES).toContain("listed");
    expect(getMetric("discount_total").basis).toBe("listed");
  });

  it("states the v1 day anchor of refund counts and amounts", () => {
    expect(getMetric("orders_refunded").description).toContain("order's created_at IST day");
    expect(getMetric("orders_part_refunded").description).toContain("order's created_at IST day");
    const refunds = getMetric("refunds_amount").description;
    expect(refunds).toContain("refunds.created_at");
    expect(refunds).toContain("finalized_at");
  });

  it("marks points_tender not yet available and keeps it out of v1 computation", () => {
    const points = getMetric("points_tender");
    expect(points.availability).toBe("not_yet_available");
    expect(points.sources).toEqual([]);
    expect(points.description).toMatch(/^NOT YET AVAILABLE/);
    expect(isComputedInV1("points_tender")).toBe(false);
    expect(V1_COMPUTED_METRIC_IDS).not.toContain("points_tender");
  });

  it("computes every other stored metric in v1", () => {
    expect([...V1_COMPUTED_METRIC_IDS].sort()).toEqual(STORED_METRIC_IDS.filter((id) => id !== "points_tender").sort());
    for (const id of V1_COMPUTED_METRIC_IDS) expect(isComputedInV1(id)).toBe(true);
  });

  it("wires the design's trust signals to the metrics they grade", () => {
    expect(getMetric("revenue_net").trustSignals).toContain("t6_payment_integrity");
    expect(getMetric("food_cost_theoretical").trustSignals).toEqual(
      expect.arrayContaining(["t1_recipe_coverage", "t1b_costed_sale_rows", "t2_price_freshness"]),
    );
    expect(getMetric("food_cost_actual").trustSignals).toEqual(
      expect.arrayContaining(["t3_stock_count_recency", "t4_waste_logging"]),
    );
    expect(getMetric("expense_direct").trustSignals).toContain("t7_cost_recording");
  });

  it("describes every trust signal and uses each one somewhere", () => {
    expect(Object.keys(TRUST_SIGNAL_DESCRIPTIONS).sort()).toEqual([...TRUST_SIGNAL_IDS].sort());
    const used = new Set(stored.flatMap((entry) => entry.trustSignals));
    for (const signal of TRUST_SIGNAL_IDS) expect(used.has(signal)).toBe(true);
  });
});

describe("derived metric registry", () => {
  it("has exactly one entry per DerivedMetricId, keyed by its own id", () => {
    expect(Object.keys(DERIVED_METRIC_CATALOG).sort()).toEqual([...DERIVED_METRIC_IDS].sort());
    for (const [key, entry] of Object.entries(DERIVED_METRIC_CATALOG)) expect(entry.id).toBe(key);
    expect(new Set(DERIVED_METRIC_IDS).size).toBe(DERIVED_METRIC_IDS.length);
  });

  it("never shares an id with a stored metric, so a ratio can never be written as a fact", () => {
    for (const id of DERIVED_METRIC_IDS) {
      expect(isMetricId(id)).toBe(false);
      expect(isDerivedMetricId(id)).toBe(true);
    }
    for (const id of STORED_METRIC_IDS) expect(isDerivedMetricId(id)).toBe(false);
    expect(isMetricId("food_cost_pct")).toBe(false);
  });

  it("derives only from stored metrics and inherits all their trust signals", () => {
    for (const entry of derived) {
      expect(entry.kind).toBe("derived");
      expect(DERIVED_METRIC_UNITS).toContain(entry.unit);
      expect(entry.basis).toBe(entry.id === "net_collected" ? "gross" : "net");
      expect(entry.definitionVersion).toBe(1);
      expect(entry.inputs.length).toBeGreaterThan(0);
      for (const input of entry.inputs) {
        expect(isMetricId(input)).toBe(true);
        for (const signal of METRIC_CATALOG[input].trustSignals) expect(entry.trustSignals).toContain(signal);
      }
    }
  });

  it("uses only v1-computed inputs, so every derived metric is available", () => {
    for (const entry of derived) {
      expect(entry.availability).toBe("available");
      for (const input of entry.inputs) expect(isComputedInV1(input)).toBe(true);
    }
  });

  it("includes the P&L margins and net collected", () => {
    expect([...DERIVED_METRIC_IDS].sort()).toEqual(
      [
        "aov_net", "food_cost_pct_theoretical", "food_cost_pct_recorded_purchases", "gross_profit", "net_profit",
        "channel_share", "gross_margin_bps", "net_margin_bps", "net_collected",
      ].sort(),
    );
    expect(getDerivedMetric("gross_margin_bps")).toMatchObject({ unit: "bps", basis: "net", inputs: ["revenue_net", "expense_direct"] });
    expect(getDerivedMetric("net_margin_bps")).toMatchObject({
      unit: "bps",
      basis: "net",
      inputs: ["revenue_net", "expense_direct", "expense_operating"],
    });
    expect(getDerivedMetric("net_margin_bps").inputs).not.toContain("expense_nonoperating");
    expect(getDerivedMetric("net_collected")).toMatchObject({ unit: "paise", basis: "gross", inputs: ["captured_amount", "refunds_amount"] });
    expect(getDerivedMetric("aov_net").description).toContain("null → 0");
  });

  it("uses bps for percentages and paise for amounts", () => {
    expect(getDerivedMetric("food_cost_pct_theoretical")).toMatchObject({ unit: "bps", inputs: ["food_cost_theoretical", "revenue_net"] });
    expect(getDerivedMetric("food_cost_pct_recorded_purchases")).toMatchObject({ unit: "bps", inputs: ["expense_direct", "revenue_net"] });
    expect(getDerivedMetric("channel_share").unit).toBe("bps");
    expect(getDerivedMetric("aov_net").unit).toBe("paise");
    expect(getDerivedMetric("gross_profit").unit).toBe("paise");
    expect(getDerivedMetric("net_profit").inputs).not.toContain("expense_nonoperating");
  });
});
