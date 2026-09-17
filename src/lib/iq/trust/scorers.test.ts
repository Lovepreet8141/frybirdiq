import { describe, expect, it } from "vitest";

import {
  gradeClockSanity,
  gradeCostRecording,
  gradeCostedSaleRows,
  gradePaymentIntegrity,
  gradePriceFreshness,
  gradeRank,
  gradeRecipeCoverage,
  gradeStockCountRecency,
  gradeWasteLogging,
  lowerGrade,
  metricTrust,
} from "./scorers";

describe("T1 recipe coverage (≥90% HIGH, 70–90% MEDIUM)", () => {
  it.each([
    [9_000n, 10_000n, "HIGH"],
    [8_999n, 10_000n, "MEDIUM"],
    [7_000n, 10_000n, "MEDIUM"],
    [6_999n, 10_000n, "LOW"],
    [0n, 10_000n, "LOW"],
    [0n, 0n, "UNKNOWN"],
  ] as const)("%s of %s is %s", (covered, total, grade) => {
    expect(gradeRecipeCoverage(covered, total)).toBe(grade);
  });

  it("refuses counts that are not a share", () => {
    expect(() => gradeRecipeCoverage(11n, 10n)).toThrow(RangeError);
    expect(() => gradeRecipeCoverage(-1n, 10n)).toThrow(RangeError);
  });
});

describe("T1b costed SALE rows (≥98% HIGH, ≥90% MEDIUM)", () => {
  it.each([
    [98n, 100n, "HIGH"],
    [97n, 100n, "MEDIUM"],
    [90n, 100n, "MEDIUM"],
    [89n, 100n, "LOW"],
    [0n, 0n, "UNKNOWN"],
  ] as const)("%s of %s is %s", (costed, total, grade) => {
    expect(gradeCostedSaleRows(costed, total)).toBe(grade);
  });

  it("does not round 97.99% up to HIGH", () => {
    expect(gradeCostedSaleRows(9_799n, 10_000n)).toBe("MEDIUM");
  });
});

describe("T2 price freshness (≥80% HIGH, ≥50% MEDIUM)", () => {
  it.each([
    [80n, 100n, "HIGH"],
    [79n, 100n, "MEDIUM"],
    [50n, 100n, "MEDIUM"],
    [49n, 100n, "LOW"],
    [0n, 0n, "UNKNOWN"],
  ] as const)("%s of %s is %s", (fresh, total, grade) => {
    expect(gradePriceFreshness(fresh, total)).toBe(grade);
  });
});

describe("T3 stock count recency", () => {
  it("is UNKNOWN until stock counts are recorded (D17)", () => {
    expect(gradeStockCountRecency()).toBe("UNKNOWN");
  });
});

describe("T4 waste logging (≥5/7 HIGH, 3–4/7 MEDIUM)", () => {
  it.each([
    [7n, 7n, "HIGH"],
    [5n, 7n, "HIGH"],
    [4n, 7n, "MEDIUM"],
    [3n, 7n, "MEDIUM"],
    [2n, 7n, "LOW"],
    [0n, 0n, "UNKNOWN"],
    // Fewer sales days: the same share, 5/7 and 3/7.
    [3n, 4n, "HIGH"],
    [2n, 4n, "MEDIUM"],
    [1n, 4n, "LOW"],
  ] as const)("%s of %s sales days is %s", (logged, sales, grade) => {
    expect(gradeWasteLogging(logged, sales)).toBe(grade);
  });
});

describe("T5 clock sanity (any failure LOW)", () => {
  it("is HIGH with every row clean and org checks passing", () => {
    expect(gradeClockSanity(10n, 10n, true)).toBe("HIGH");
  });
  it("is LOW with one bad row", () => {
    expect(gradeClockSanity(9n, 10n, true)).toBe("LOW");
  });
  it("is LOW when an org check fails, even with no rows", () => {
    expect(gradeClockSanity(0n, 0n, false)).toBe("LOW");
    expect(gradeClockSanity(10n, 10n, false)).toBe("LOW");
  });
  it("is UNKNOWN with nothing checked", () => {
    expect(gradeClockSanity(0n, 0n, true)).toBe("UNKNOWN");
  });
});

describe("T6 payment integrity (any anomaly LOW)", () => {
  it.each([
    [5n, 5n, "HIGH"],
    [4n, 5n, "LOW"],
    [0n, 0n, "UNKNOWN"],
  ] as const)("%s clean of %s is %s", (clean, checked, grade) => {
    expect(gradePaymentIntegrity(clean, checked)).toBe(grade);
  });
});

describe("T7 cost recording", () => {
  it.each([
    [true, true, "HIGH"],
    [true, false, "MEDIUM"],
    [false, true, "MEDIUM"],
    [false, false, "LOW"],
  ] as const)("in month %s, within 7 days %s is %s", (month, week, grade) => {
    expect(gradeCostRecording(month, week)).toBe(grade);
  });
});

describe("grade order", () => {
  it("ranks LOW < UNKNOWN < MEDIUM < HIGH", () => {
    expect(["HIGH", "UNKNOWN", "LOW", "MEDIUM"].sort((a, b) => gradeRank(a as never) - gradeRank(b as never))).toEqual(["LOW", "UNKNOWN", "MEDIUM", "HIGH"]);
    expect(lowerGrade("MEDIUM", "UNKNOWN")).toBe("UNKNOWN");
    expect(lowerGrade("LOW", "UNKNOWN")).toBe("LOW");
  });
});

describe("metric trust (I2)", () => {
  it("is the lowest signal grade and names the limiting signal", () => {
    // revenue_net: t5_clock_sanity, t6_payment_integrity.
    const trust = metricTrust("revenue_net", { t5_clock_sanity: "HIGH", t6_payment_integrity: "LOW" });
    expect(trust.grade).toBe("LOW");
    expect(trust.limitingSignal).toBe("t6_payment_integrity");
    expect(trust.signals).toEqual([
      { signalId: "t5_clock_sanity", grade: "HIGH" },
      { signalId: "t6_payment_integrity", grade: "LOW" },
    ]);
  });

  it("names no limiting signal when every signal is HIGH", () => {
    expect(metricTrust("revenue_net", { t5_clock_sanity: "HIGH", t6_payment_integrity: "HIGH" })).toMatchObject({ grade: "HIGH", limitingSignal: null });
  });

  it("treats a missing signal as UNKNOWN and picks the first among ties", () => {
    expect(metricTrust("revenue_net", {})).toMatchObject({ grade: "UNKNOWN", limitingSignal: "t5_clock_sanity" });
  });

  it("caps food_cost_actual at UNKNOWN while T3 is not measured", () => {
    const all = { t1_recipe_coverage: "HIGH", t1b_costed_sale_rows: "HIGH", t2_price_freshness: "HIGH", t4_waste_logging: "HIGH", t5_clock_sanity: "HIGH" } as const;
    expect(metricTrust("food_cost_actual", { ...all, t3_stock_count_recency: gradeStockCountRecency() })).toMatchObject({
      grade: "UNKNOWN",
      limitingSignal: "t3_stock_count_recency",
    });
  });

  it("uses the union of inputs' signals for a derived metric", () => {
    const trust = metricTrust("net_profit", { t5_clock_sanity: "HIGH", t6_payment_integrity: "HIGH", t7_cost_recording: "MEDIUM" });
    expect(trust).toMatchObject({ grade: "MEDIUM", limitingSignal: "t7_cost_recording" });
  });

  it("is UNKNOWN for a metric no signal vouches for", () => {
    expect(metricTrust("expense_operating", {})).toEqual({ grade: "UNKNOWN", limitingSignal: null, signals: [] });
  });
});
