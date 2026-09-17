import { describe, expect, it } from "vitest";
import { TRUST_SIGNAL_IDS } from "@/lib/iq/metrics";
import { TRUST_SIGNAL_LABELS, trustBadge } from "./trust-badge";

describe("trustBadge", () => {
  it("names nothing when the grade is high", () => {
    expect(trustBadge("Net sales (excl. GST)", { grade: "HIGH", limitingSignal: null, limitingDate: null, missingDates: [] })).toEqual({ tone: "gain", text: "Net sales (excl. GST): high trust" });
  });

  it("names the limiting signal and its day when the grade is low", () => {
    expect(trustBadge("Net profit", { grade: "LOW", limitingSignal: "t6_payment_integrity", limitingDate: "2026-09-03", missingDates: [] })).toEqual({
      tone: "loss",
      text: "Net profit: low trust — payment integrity, 3 Sep",
    });
  });

  it("names the signal for a medium grade, and for an unchecked one", () => {
    expect(trustBadge("Food cost – recipe", { grade: "MEDIUM", limitingSignal: "t1_recipe_coverage", limitingDate: "2026-08-31", missingDates: [] })).toEqual({
      tone: "flag",
      text: "Food cost – recipe: medium trust — recipe coverage, 31 Aug",
    });
    expect(trustBadge("Food cost – recipe", { grade: "UNKNOWN", limitingSignal: "t3_stock_count_recency", limitingDate: null, missingDates: [] })).toEqual({
      tone: "neutral",
      text: "Food cost – recipe: trust not checked — stock counts",
    });
  });

  it("names no signal for days never scored", () => {
    expect(trustBadge("Net sales (excl. GST)", { grade: "UNKNOWN", limitingSignal: "t5_clock_sanity", limitingDate: "2026-09-01", missingDates: ["2026-09-01", "2026-09-02"] })).toEqual({
      tone: "neutral",
      text: "Net sales (excl. GST): trust not scored for 2 days",
    });
    expect(trustBadge("Net profit", { grade: "UNKNOWN", limitingSignal: "t5_clock_sanity", limitingDate: "2026-09-01", missingDates: ["2026-09-01"] }).text).toBe("Net profit: trust not scored for 1 day");
  });

  it("still leads with a low grade from a scored day, and adds the unscored days", () => {
    expect(trustBadge("Net profit", { grade: "LOW", limitingSignal: "t6_payment_integrity", limitingDate: "2026-09-03", missingDates: ["2026-09-04"] })).toEqual({
      tone: "loss",
      text: "Net profit: low trust — payment integrity, 3 Sep; not scored for 1 day",
    });
  });

  it("has a plain name for every trust signal", () => {
    expect(Object.keys(TRUST_SIGNAL_LABELS).sort()).toEqual([...TRUST_SIGNAL_IDS].sort());
  });
});
