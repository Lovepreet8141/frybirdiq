import { describe, expect, it } from "vitest";

import { RAW_BY_CLAIM, rawAutomation, rawExplanation, rawFact, rawForecast, rawRecommendation } from "./__test-support__/insights";
import { InsightSchema, type Insight } from "./insight";
import { observed } from "./observed-factory";
import { factFigure, present, type ForecastPresentation, type Presentation, type RecommendationPresentation } from "./present";
import { estimated } from "./quantity";

const parse = (raw: unknown): Insight => InsightSchema.parse(raw);

describe("present — badges are fixed by claim type", () => {
  it.each([
    ["FACT", "Fact"],
    ["DETECTION", "Detected"],
    ["FORECAST", "Forecast"],
    ["EXPLANATION", "Why"],
    ["RECOMMENDATION", "Suggested"],
    ["AUTOMATION", "Done automatically"],
  ] as const)("%s → %s", (claim, label) => {
    const p = present(parse(RAW_BY_CLAIM[claim]()));
    expect(p.kind).toBe(claim);
    expect(p.badge).toEqual({ label, claimType: claim });
  });

  it("an automation waiting for approval says so", () => {
    const auto = rawAutomation();
    const pending = { ...auto, payload: { ...auto.payload, execution: "PENDING_APPROVAL", approvalRef: null } };
    expect(present(parse(pending)).badge.label).toBe("Waiting approval");
  });
});

describe("present — a prediction never becomes a bare number", () => {
  it("renders a forecast as an 80% band with no median and no bare number", () => {
    const p = present(parse(rawForecast())) as ForecastPresentation;
    expect(p.range).toEqual({ text: "120 – 190", low: "120", high: "190", coverage: "80% interval" });
    expect(p).not.toHaveProperty("bareNumber");
    expect(JSON.stringify(p)).not.toContain("150");
    expect(p.beatsNaive).toBe(true);
  });

  it("renders a recommendation's impact as a range in rupees, with its expiry in IST", () => {
    const p = present(parse(rawRecommendation())) as RecommendationPresentation;
    expect(p.impact).toEqual({ low: "₹1,500", high: "₹3,000", basis: "forecast" });
    expect(p.expiresAt).toContain("11:00");
    expect(p.decision).toBe("APPROVE_OR_DISMISS");
    expect(p).not.toHaveProperty("bareNumber");
    expect(p.copy.slots).toEqual({ impact: "₹1,500 – ₹3,000" });
  });

  it("hands an A3 recommendation off instead of offering approval", () => {
    const rec = rawRecommendation();
    const a3 = { ...rec, payload: { ...rec.payload, tier: "A3", actionKind: "price.change" } };
    expect((present(parse(a3)) as RecommendationPresentation).decision).toBe("HANDOFF");
  });

  it("marks an explanation's residual as an estimate and its drivers as facts", () => {
    const p = present(parse(rawExplanation()));
    if (p.kind !== "EXPLANATION") throw new Error("expected an explanation");
    expect(p.residual).toBe("≈ -₹200");
    expect(p.total.text).toBe("-₹5,000");
    expect(p.drivers.map((d) => d.contribution.text)).toEqual(["-₹4,000", "-₹800"]);
    expect(p.copy.slots).toEqual({ residual: "≈ -₹200", total: "-₹5,000" });
  });

  it("does not compile a forecast presentation with a bare number", () => {
    const p = present(parse(rawForecast())) as ForecastPresentation;
    // @ts-expect-error — bareNumber is `never` on a forecast
    const withBare: ForecastPresentation = { ...p, bareNumber: "150" };
    expect(withBare.kind).toBe("FORECAST");
  });

  it("does not compile a fact figure built from an estimate", () => {
    const est = estimated({ unit: "count", value: 150 });
    // @ts-expect-error — factFigure takes an Observed quantity only
    const misuse = () => factFigure(est);
    expect(typeof misuse).toBe("function");
    expect(factFigure(observed({ unit: "count", value: 150 })).text).toBe("150");
  });
});

describe("present — facts, detections, units and trust", () => {
  it("formats a fact in Indian rupee grouping and fills its copy slot", () => {
    const p = present(parse(rawFact()));
    if (p.kind !== "FACT") throw new Error("expected a fact");
    expect(p.figure.text).toBe("₹42,500");
    expect(p.copy).toEqual({ templateId: "fact.revenue", slots: { amount: "₹42,500" } });
  });

  it("formats a detection in percent", () => {
    const p = present(parse(RAW_BY_CLAIM.DETECTION()));
    if (p.kind !== "DETECTION") throw new Error("expected a detection");
    expect([p.observed.text, p.baseline.text, p.deviation, p.severity]).toEqual(["34.0%", "30.0%", "13.3%", 2]);
  });

  it.each([
    ["grams", 125000, "1,25,000 g"],
    ["ml", 500, "500 ml"],
    ["pieces", 12, "12 pcs"],
    ["seconds", 420, "420 s"],
    ["count", 1000, "1,000"],
  ] as const)("formats %s", (unit, value, text) => {
    expect(factFigure(observed({ unit, value })).text).toBe(text);
  });

  it("states trust plainly, including when it is not measured", () => {
    expect(present(parse(rawFact())).trust).toEqual({ state: "NOT_MEASURED", text: "trust not measured yet" });
    const measured = { ...rawFact(), trust: { state: "MEASURED", score: 87, asOf: "2026-09-17T03:00:00+05:30", metricIds: ["revenue.net"], reasons: [] } };
    expect(present(parse(measured)).trust.text).toBe("Data trust 87/100");
    const thin = { ...rawFact(), trust: { state: "INSUFFICIENT_DATA", reasons: ["UNDER_14_DAYS"] } };
    expect(present(parse(thin)).trust.text).toBe("not enough data to measure trust");
  });

  it("covers every claim type exhaustively", () => {
    const kinds: Presentation["kind"][] = Object.values(RAW_BY_CLAIM).map((raw) => present(parse(raw())).kind);
    expect(new Set(kinds).size).toBe(6);
  });
});
