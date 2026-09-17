import { describe, expect, it } from "vitest";

import { ConfidenceSchema, TrustRefSchema } from "./trust";

describe("TrustRefSchema", () => {
  it("accepts the three states", () => {
    expect(TrustRefSchema.safeParse({ state: "NOT_MEASURED" }).success).toBe(true);
    expect(TrustRefSchema.safeParse({ state: "INSUFFICIENT_DATA", reasons: ["UNDER_14_DAYS"] }).success).toBe(true);
    expect(
      TrustRefSchema.safeParse({ state: "MEASURED", score: 87, asOf: "2026-09-17T03:00:00+05:30", metricIds: ["revenue.net"], reasons: [] })
        .success,
    ).toBe(true);
  });

  it("refuses a score outside 0..100 and a score on an unmeasured state", () => {
    const measured = { state: "MEASURED", asOf: "2026-09-17T03:00:00+05:30", metricIds: ["revenue.net"], reasons: [] };
    expect(TrustRefSchema.safeParse({ ...measured, score: 101 }).success).toBe(false);
    expect(TrustRefSchema.safeParse({ state: "NOT_MEASURED", score: 90 }).success).toBe(false);
  });
});

describe("ConfidenceSchema", () => {
  it("needs at least one reason code", () => {
    expect(ConfidenceSchema.safeParse({ level: "HIGH", reasons: [] }).success).toBe(false);
  });
});
