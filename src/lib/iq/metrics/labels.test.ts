import { describe, expect, it } from "vitest";

import { DERIVED_METRIC_IDS, STORED_METRIC_IDS } from "./catalog";
import { LAST_7_DAYS_LABEL, METRIC_LABELS, metricLabel, WEEK_DEFINITION, weekLabel } from "./labels";

describe("metric labels", () => {
  it("labels every stored and derived metric, uniquely", () => {
    const ids = [...STORED_METRIC_IDS, ...DERIVED_METRIC_IDS];
    expect(Object.keys(METRIC_LABELS).sort()).toEqual([...ids].sort());
    const labels = ids.map((id) => metricLabel(id));
    for (const label of labels) expect(label.trim()).not.toBe("");
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("uses the review's owner-facing wording (I4)", () => {
    expect(metricLabel("revenue_net")).toBe("Net sales (excl. GST)");
    expect(metricLabel("captured_amount")).toBe("Collected (cash received)");
    expect(metricLabel("food_cost_pct_theoretical")).toBe("Food cost – recipe");
    expect(metricLabel("food_cost_pct_recorded_purchases")).toBe("Food cost – recorded purchases");
    expect(metricLabel("gross_margin_bps")).toBe("Gross margin");
    expect(metricLabel("net_margin_bps")).toBe("Net margin");
    expect(metricLabel("net_collected")).toBe("Net collected (after refunds)");
  });

  it("never calls a net figure 'captured'", () => {
    expect(metricLabel("revenue_net").toLowerCase()).not.toContain("captured");
  });
});

describe("week naming (I5)", () => {
  it("defines the week as Mon–Sun IST and keeps rolling windows named explicitly", () => {
    expect(WEEK_DEFINITION).toBe("Mon–Sun (IST)");
    expect(LAST_7_DAYS_LABEL).toBe("Last 7 days");
  });

  it("names the Monday-to-Sunday week containing a date", () => {
    expect(weekLabel("2026-09-17")).toBe("Week of Mon 14 Sep – Sun 20 Sep 2026");
    expect(weekLabel("2026-09-01")).toBe("Week of Mon 31 Aug – Sun 6 Sep 2026");
  });

  it("shows both years when the week crosses a year end", () => {
    expect(weekLabel("2027-01-01")).toBe("Week of Mon 28 Dec 2026 – Sun 3 Jan 2027");
  });
});
