import { describe, expect, it } from "vitest";
import { TRUST_SIGNAL_IDS } from "@/lib/iq/metrics";
import { TRUST_SIGNAL_LABELS, trustBadge } from "./trust-badge";

describe("trustBadge", () => {
  it("names nothing when the grade is high", () => {
    expect(trustBadge("Net sales (excl. GST)", { grade: "HIGH", limitingSignal: null, limitingDate: null })).toEqual({ tone: "gain", text: "Net sales (excl. GST): high trust" });
  });

  it("names the limiting signal and its day when the grade is low", () => {
    expect(trustBadge("Net profit", { grade: "LOW", limitingSignal: "t6_payment_integrity", limitingDate: "2026-09-03" })).toEqual({
      tone: "loss",
      text: "Net profit: low trust — payment integrity, 3 Sep",
    });
  });

  it("names the signal for a medium grade, and for an unchecked one", () => {
    expect(trustBadge("Food cost – recipe", { grade: "MEDIUM", limitingSignal: "t1_recipe_coverage", limitingDate: "2026-08-31" })).toEqual({
      tone: "flag",
      text: "Food cost – recipe: medium trust — recipe coverage, 31 Aug",
    });
    expect(trustBadge("Food cost – recipe", { grade: "UNKNOWN", limitingSignal: "t3_stock_count_recency", limitingDate: null })).toEqual({
      tone: "neutral",
      text: "Food cost – recipe: trust not checked — stock counts",
    });
  });

  it("has a plain name for every trust signal", () => {
    expect(Object.keys(TRUST_SIGNAL_LABELS).sort()).toEqual([...TRUST_SIGNAL_IDS].sort());
  });
});
