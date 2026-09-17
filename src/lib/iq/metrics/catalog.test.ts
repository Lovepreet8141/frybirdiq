import { describe, expect, it } from "vitest";

import {
  DERIVED_METRIC_CATALOG,
  DERIVED_METRIC_IDS,
  DERIVED_METRIC_UNITS,
  FEES_DIMENSION_VALUE,
  getDerivedMetric,
  getMetric,
  isDerivedMetricId,
  isMetricId,
  METRIC_BASES,
  METRIC_CATALOG,
  METRIC_DIMENSIONS,
  METRIC_UNITS,
  STORED_METRIC_IDS,
  TRUST_SIGNAL_DESCRIPTIONS,
  TRUST_SIGNAL_IDS,
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
      expect(entry.sources.length).toBeGreaterThan(0);
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
    expect(getMetric("captured_amount").basis).toBe("gross");
    expect(getMetric("food_cost_theoretical").basis).toBe("cost");
  });

  it("names the fees row so products sum to revenue", () => {
    expect(FEES_DIMENSION_VALUE).toBe("__fees__");
    expect(getMetric("revenue_net_by_product").description).toContain(FEES_DIMENSION_VALUE);
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
      expect(entry.basis).toBe("net");
      expect(entry.definitionVersion).toBe(1);
      expect(entry.inputs.length).toBeGreaterThan(0);
      for (const input of entry.inputs) {
        expect(isMetricId(input)).toBe(true);
        for (const signal of METRIC_CATALOG[input].trustSignals) expect(entry.trustSignals).toContain(signal);
      }
    }
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
