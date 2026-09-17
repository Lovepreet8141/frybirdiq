import { describe, expect, it } from "vitest";

import { TrustRefSchema } from "./trust";
import { CAPPED_LOW_TRUST, trustGate, trustRefFor, type FigureTrust } from "./trust-gate";

const AS_OF = "2026-09-12T02:10:00+05:30";

describe("trustGate", () => {
  it.each([
    ["HIGH", "PUBLISH", "PUBLISH"],
    ["MEDIUM", "PUBLISH", "PUBLISH"],
    ["LOW", "PUBLISH_CAPPED", "HOLD"],
    ["UNKNOWN", "PUBLISH_CAPPED", "HOLD"],
  ] as const)("%s → detection %s, recommendation %s", (grade, detection, recommendation) => {
    expect(trustGate(grade, "DETECTION")).toBe(detection);
    expect(trustGate(grade, "RECOMMENDATION")).toBe(recommendation);
  });
});

describe("trustRefFor", () => {
  const base: FigureTrust = { grade: "MEDIUM", signalId: "t1_recipe_coverage", ratio: { numerator: 87n, denominator: 100n }, asOf: AS_OF };

  it("scores from the stored ratio of the limiting signal, truncated", () => {
    const ref = trustRefFor("revenue_net", { ...base, ratio: { numerator: 2n, denominator: 3n } }, [CAPPED_LOW_TRUST]);
    expect(ref).toEqual({ state: "MEASURED", score: 66, asOf: AS_OF, metricIds: ["revenue_net"], reasons: ["GRADE_MEDIUM", "T1_RECIPE_COVERAGE", CAPPED_LOW_TRUST] });
    expect(TrustRefSchema.safeParse(ref).success).toBe(true);
  });

  it("clamps a ratio outside 0..1", () => {
    expect(trustRefFor("x", { ...base, ratio: { numerator: 150n, denominator: 100n } })).toMatchObject({ score: 100 });
    expect(trustRefFor("x", { ...base, ratio: { numerator: -5n, denominator: 100n } })).toMatchObject({ score: 0 });
  });

  it("says INSUFFICIENT_DATA for UNKNOWN, a missing ratio or a zero denominator — never a made-up score", () => {
    expect(trustRefFor("x", { ...base, grade: "UNKNOWN" })).toEqual({ state: "INSUFFICIENT_DATA", reasons: ["GRADE_UNKNOWN", "T1_RECIPE_COVERAGE"] });
    expect(trustRefFor("x", { ...base, ratio: null, signalId: null })).toEqual({ state: "INSUFFICIENT_DATA", reasons: ["GRADE_MEDIUM", "NO_RATIO"] });
    const zero = trustRefFor("x", { ...base, ratio: { numerator: 0n, denominator: 0n } });
    expect(zero.state).toBe("INSUFFICIENT_DATA");
    expect(TrustRefSchema.safeParse(zero).success).toBe(true);
  });
});
