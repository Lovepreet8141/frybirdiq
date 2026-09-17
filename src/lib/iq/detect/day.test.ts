import { describe, expect, it } from "vitest";

import { observed } from "@/lib/iq/engine/observed-factory";
import type { TrustSignalId } from "@/lib/iq/metrics";
import { metricTrust, type TrustGrade } from "@/lib/iq/trust";

import { baselineDates } from "./baseline";
import { FIGURE_INPUTS, detectDayFrom, type DayFacts, type DayTrustRow } from "./day";
import { DETECT_FIGURES, evaluateDetectDay } from "./rules";

const D = "2026-09-11";

const FACTS: DayFacts = {
  computed: true,
  totals: {
    revenue_net: 1_000_000n,
    orders_paid: 40n,
    discount_total: 30_000n,
    sales_gross: 1_050_000n,
    orders_cancelled: 2n,
    orders_failed: 1n,
    refunds_amount: 5_000n,
    waste_cost: 20_000n,
    food_cost_theoretical: 300_000n,
  },
  breakdowns: { revenue_net: { channel: { ONLINE: 200_000n, DINE_IN: 800_000n } } },
};

const ALL_SIGNALS: readonly TrustSignalId[] = [
  "t1_recipe_coverage",
  "t1b_costed_sale_rows",
  "t2_price_freshness",
  "t3_stock_count_recency",
  "t4_waste_logging",
  "t5_clock_sanity",
  "t6_payment_integrity",
  "t7_cost_recording",
];

function rows(overrides: Partial<Record<TrustSignalId, Partial<DayTrustRow> | null>> = {}): DayTrustRow[] {
  const out: DayTrustRow[] = [];
  ALL_SIGNALS.forEach((signalId, i) => {
    const o = overrides[signalId];
    if (o === null) return;
    out.push({
      signalId,
      grade: "HIGH",
      numerator: BigInt(90 + i),
      denominator: 100n,
      computedAt: new Date(Date.UTC(2026, 8, 11, 20, 30 + i)),
      ...o,
    });
  });
  return out;
}

describe("detectDayFrom — figures", () => {
  it("derives every figure from one day's facts with the catalog helpers, in its unit", () => {
    const day = detectDayFrom(D, FACTS, rows(), observed);
    expect(day).toMatchObject({ date: D, hasFacts: true, parityFlagged: false });
    expect(day.figures).toEqual({
      revenue_net: { unit: "paise", value: "1000000" },
      orders_paid: { unit: "count", value: 40 },
      aov_net: { unit: "paise", value: "25000" },
      discount_share: { unit: "bps", value: 286 },
      orders_cancelled_failed: { unit: "count", value: 3 },
      refunds_amount: { unit: "paise", value: "5000" },
      sales_gross: { unit: "paise", value: "1050000" },
      waste_cost: { unit: "paise", value: "20000" },
      food_cost_pct_theoretical: { unit: "bps", value: 3000 },
      online_share: { unit: "bps", value: 2000 },
    });
  });

  it("leaves ratios with no denominator absent, never zero; missing totals count as zero", () => {
    const empty = detectDayFrom(D, { computed: true, totals: {}, breakdowns: {} }, [], observed);
    expect(Object.keys(empty.figures).sort()).toEqual(["orders_cancelled_failed", "orders_paid", "refunds_amount", "revenue_net", "sales_gross", "waste_cost"].sort());
    expect(empty.figures.revenue_net).toEqual({ unit: "paise", value: "0" });
  });

  it("gives a day without computed facts no figures", () => {
    const day = detectDayFrom(D, { ...FACTS, computed: false }, rows(), observed);
    expect([day.hasFacts, day.figures]).toEqual([false, {}]);
  });

  it("has one derivation per detector figure", () => {
    expect(Object.keys(FIGURE_INPUTS).sort()).toEqual([...DETECT_FIGURES].sort());
  });
});

describe("detectDayFrom — trust (metricTrust + lowerGrade)", () => {
  it("has no trust entries on a day with no trust rows, so its rules do not evaluate", () => {
    expect(detectDayFrom(D, FACTS, [], observed).trust).toEqual({});
  });

  it("names no limiting signal at HIGH (metricTrust's rule), yet scores from the weakest stored ratio", () => {
    const day = detectDayFrom(D, FACTS, rows(), observed);
    // revenue_net rests on t5 (95/100) and t6 (96/100): weakest is t5.
    expect(day.trust.revenue_net).toEqual({
      grade: "HIGH",
      signalId: null,
      ratio: { numerator: 95n, denominator: 100n },
      asOf: "2026-09-12T02:07:00+05:30",
      lowSignals: { unit: "count", value: 0 },
    });
  });

  it("names the limiting signal and its ratio below HIGH, and counts LOW signals", () => {
    const day = detectDayFrom(D, FACTS, rows({ t6_payment_integrity: { grade: "LOW", numerator: 40n } }), observed);
    expect(day.trust.revenue_net).toMatchObject({
      grade: "LOW",
      signalId: "t6_payment_integrity",
      ratio: { numerator: 40n, denominator: 100n },
      lowSignals: { unit: "count", value: 1 },
    });
  });

  it("treats a signal with no row as UNKNOWN, with no ratio", () => {
    const day = detectDayFrom(D, FACTS, rows({ t5_clock_sanity: null }), observed);
    expect(day.trust.revenue_net).toMatchObject({ grade: "UNKNOWN", signalId: "t5_clock_sanity", ratio: null });
  });

  it("takes the lowest grade across a figure's metrics and agrees with metricTrust for each", () => {
    const grades: Partial<Record<TrustSignalId, TrustGrade>> = { t5_clock_sanity: "MEDIUM", t6_payment_integrity: "HIGH" };
    const day = detectDayFrom(
      D,
      FACTS,
      rows({ t5_clock_sanity: { grade: "MEDIUM" }, t6_payment_integrity: { grade: "HIGH" } }),
      observed,
    );
    const expected = metricTrust("discount_total", { ...Object.fromEntries(ALL_SIGNALS.map((s) => [s, "HIGH"])), ...grades });
    expect(day.trust.discount_share).toMatchObject({ grade: expected.grade, signalId: expected.limitingSignal });
    expect(day.trust.discount_share?.grade).toBe("MEDIUM");
  });
});

describe("detectDayFrom feeds the rules unchanged", () => {
  it("a sharp drop built from facts fires sales.below_weekday_baseline", () => {
    const dayWith = (date: string, revenue: bigint) =>
      detectDayFrom(date, { ...FACTS, totals: { ...FACTS.totals, revenue_net: revenue } }, rows(), observed);
    const days = [dayWith(D, 600_000n), ...baselineDates(D).map((date) => dayWith(date, 1_000_000n))];
    const outcome = evaluateDetectDay({ date: D, days }).outcomes.find((o) => o.ruleId === "sales.below_weekday_baseline");
    expect(outcome).toMatchObject({ status: "FIRED", severity: 3 });
  });
});
