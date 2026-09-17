import { describe, expect, it } from "vitest";

import { rawAutomation, rawDetection, rawExplanation, rawFact, rawForecast, rawRecommendation } from "./__test-support__/insights";
import {
  AutomationPayloadSchema,
  DetectionPayloadSchema,
  ExplanationPayloadSchema,
  FactPayloadSchema,
  ForecastPayloadSchema,
  RecommendationPayloadSchema,
} from "./claims";

const interval = rawForecast().payload.interval;
const confidence = rawRecommendation().payload.confidence;
const range = rawRecommendation().payload.impact;
const point = { unit: "count", value: 150 };

describe("the six payloads are strict", () => {
  it.each([
    ["FACT", FactPayloadSchema, rawFact().payload],
    ["DETECTION", DetectionPayloadSchema, rawDetection().payload],
    ["FORECAST", ForecastPayloadSchema, rawForecast().payload],
    ["EXPLANATION", ExplanationPayloadSchema, rawExplanation().payload],
    ["RECOMMENDATION", RecommendationPayloadSchema, rawRecommendation().payload],
    ["AUTOMATION", AutomationPayloadSchema, rawAutomation().payload],
  ] as const)("%s accepts its example and refuses an unknown key", (_claim, schema, payload) => {
    expect(schema.safeParse(payload).success).toBe(true);
    expect(schema.safeParse({ ...payload, note: "extra" }).success).toBe(false);
  });
});

describe("what each claim may never carry (DESIGN §1.3)", () => {
  it("FACT has no interval, range or confidence", () => {
    const fact = rawFact().payload;
    expect(FactPayloadSchema.safeParse({ ...fact, interval }).success).toBe(false);
    expect(FactPayloadSchema.safeParse({ ...fact, range }).success).toBe(false);
    expect(FactPayloadSchema.safeParse({ ...fact, confidence }).success).toBe(false);
  });

  it("DETECTION has no interval", () => {
    expect(DetectionPayloadSchema.safeParse({ ...rawDetection().payload, interval }).success).toBe(false);
  });

  it("FORECAST has no value", () => {
    expect(ForecastPayloadSchema.safeParse({ ...rawForecast().payload, value: point }).success).toBe(false);
  });

  it("EXPLANATION has no value", () => {
    expect(ExplanationPayloadSchema.safeParse({ ...rawExplanation().payload, value: point }).success).toBe(false);
  });

  it("RECOMMENDATION has no value and no point impact", () => {
    const rec = rawRecommendation().payload;
    expect(RecommendationPayloadSchema.safeParse({ ...rec, value: point }).success).toBe(false);
    expect(RecommendationPayloadSchema.safeParse({ ...rec, impact: { unit: "paise", value: "200000" } }).success).toBe(false);
  });

  it("AUTOMATION has no value", () => {
    expect(AutomationPayloadSchema.safeParse({ ...rawAutomation().payload, value: point }).success).toBe(false);
  });
});

describe("DETECTION", () => {
  it("refuses a baseline in a different unit from the observation", () => {
    const d = rawDetection().payload;
    expect(DetectionPayloadSchema.safeParse({ ...d, baseline: { ...d.baseline, value: { unit: "count", value: 3 } } }).success).toBe(false);
  });

  it("allows only severity 1..3", () => {
    expect(DetectionPayloadSchema.safeParse({ ...rawDetection().payload, severity: 4 }).success).toBe(false);
  });
});

describe("FORECAST", () => {
  it("needs a backtest with a known provenance and at least one forecast row", () => {
    const f = rawForecast().payload;
    expect(ForecastPayloadSchema.safeParse({ ...f, backtest: { ...f.backtest, provenance: "GUESS" } }).success).toBe(false);
    expect(ForecastPayloadSchema.safeParse({ ...f, forecastIds: [] }).success).toBe(false);
  });
});

describe("EXPLANATION", () => {
  it("requires drivers plus residual to equal the total exactly", () => {
    const e = rawExplanation().payload;
    expect(ExplanationPayloadSchema.safeParse({ ...e, residual: { unit: "paise", value: "-20001" } }).success).toBe(false);
  });

  it("refuses a residual in another unit", () => {
    const e = rawExplanation().payload;
    expect(ExplanationPayloadSchema.safeParse({ ...e, residual: { unit: "count", value: 0 } }).success).toBe(false);
  });
});

describe("RECOMMENDATION", () => {
  it("must expire, cite evidence insights and state assumptions", () => {
    const noExpiry: Partial<ReturnType<typeof rawRecommendation>["payload"]> = rawRecommendation().payload;
    delete noExpiry.expiresAt;
    expect(RecommendationPayloadSchema.safeParse(noExpiry).success).toBe(false);
    expect(RecommendationPayloadSchema.safeParse({ ...rawRecommendation().payload, evidenceInsightIds: [] }).success).toBe(false);
    expect(RecommendationPayloadSchema.safeParse({ ...rawRecommendation().payload, assumptions: [] }).success).toBe(false);
  });
});

describe("AUTOMATION", () => {
  const auto = rawAutomation().payload;
  const person = { by: "11111111-1111-4111-8111-111111111111", at: "2026-09-17T09:00:00+05:30" };

  it("never carries an A3 action", () => {
    expect(AutomationPayloadSchema.safeParse({ ...auto, tier: "A3" }).success).toBe(false);
  });

  it("an A2 action is approved by a person, not an auto policy", () => {
    expect(AutomationPayloadSchema.safeParse({ ...auto, tier: "A2" }).success).toBe(false);
    expect(AutomationPayloadSchema.safeParse({ ...auto, tier: "A2", approvalRef: person }).success).toBe(true);
  });

  it("a pending action has no approval yet; an executed A1 has one", () => {
    expect(AutomationPayloadSchema.safeParse({ ...auto, execution: "PENDING_APPROVAL" }).success).toBe(false);
    expect(AutomationPayloadSchema.safeParse({ ...auto, execution: "PENDING_APPROVAL", approvalRef: null }).success).toBe(true);
    expect(AutomationPayloadSchema.safeParse({ ...auto, approvalRef: null }).success).toBe(false);
  });

  it("A0 runs without approval and never waits for one", () => {
    expect(AutomationPayloadSchema.safeParse({ ...auto, tier: "A0", approvalRef: null }).success).toBe(true);
    expect(AutomationPayloadSchema.safeParse({ ...auto, tier: "A0" }).success).toBe(false);
    expect(AutomationPayloadSchema.safeParse({ ...auto, tier: "A0", execution: "PENDING_APPROVAL", approvalRef: null }).success).toBe(false);
  });

  it("snapshots hold scalars only, and undo needs a kind", () => {
    expect(AutomationPayloadSchema.safeParse({ ...auto, after: { lines: [1, 2] } }).success).toBe(false);
    expect(AutomationPayloadSchema.safeParse({ ...auto, undo: { kind: "NONE", available: true } }).success).toBe(false);
  });
});
