import { describe, expect, it } from "vitest";

import { RAW_BY_CLAIM, rawAutomation, rawExplanation, rawFact, rawForecast, rawRecommendation } from "./__test-support__/insights";
import { InsightSchema, findPersonalData, parseInsights, resolvePayloadPath } from "./insight";

const issues = (row: unknown) => {
  const parsed = InsightSchema.safeParse(row);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
};

describe("InsightSchema", () => {
  it.each(Object.entries(RAW_BY_CLAIM))("parses a valid %s", (_claim, raw) => {
    expect(issues(raw())).toEqual([]);
  });

  it("refuses unknown envelope keys and a payload under the wrong claim type", () => {
    expect(InsightSchema.safeParse({ ...rawFact(), score: 1 }).success).toBe(false);
    expect(InsightSchema.safeParse({ ...rawForecast(), claimType: "FACT" }).success).toBe(false);
    expect(InsightSchema.safeParse({ ...rawFact(), claimType: "FORECAST" }).success).toBe(false);
  });

  it("needs at least one piece of evidence and a trust state", () => {
    expect(InsightSchema.safeParse({ ...rawFact(), evidence: [] }).success).toBe(false);
    const noTrust: Partial<ReturnType<typeof rawFact>> = rawFact();
    delete noTrust.trust;
    expect(InsightSchema.safeParse(noTrust).success).toBe(false);
  });

  it("requires a recommendation's envelope expiry to match its payload", () => {
    expect(issues({ ...rawRecommendation(), expiresAt: null }).join()).toMatch(/must match its payload/);
  });
});

describe("copy slots", () => {
  const withSlots = <T extends { copy: object }>(row: T, slots: Record<string, string>) => ({
    ...row,
    copy: { templateId: "t", slots },
  });

  it("refuses a slot pointing at a missing path", () => {
    expect(issues(withSlots(rawFact(), { amount: "valeu" })).join()).toMatch(/citable payload value/);
  });

  it("refuses a slot that cites one quantile of a forecast", () => {
    expect(issues(withSlots(rawForecast(), { likely: "interval.p50" })).join()).toMatch(/not a part of one/);
    expect(issues(withSlots(rawForecast(), { likely: "interval.p50.value" })).join()).toMatch(/not a part of one/);
  });

  it("refuses a slot that cites one end of a recommendation's range, or an assumption figure", () => {
    expect(issues(withSlots(rawRecommendation(), { low: "impact.low" })).join()).toMatch(/not a part of one/);
    const rec = rawRecommendation();
    const withAssumption = {
      ...rec,
      payload: { ...rec.payload, assumptions: [{ code: "PRICE", value: { unit: "paise", value: "9900" } }] },
    };
    expect(issues(withSlots(withAssumption, { price: "assumptions.0.value" })).join()).toMatch(/not a bare figure/);
  });

  it("refuses a slot that cites a whole object that is not a figure", () => {
    expect(issues(withSlots(rawForecast(), { bt: "backtest" })).join()).toMatch(/citable payload value/);
  });

  it("resolves array indexes and nothing else", () => {
    const payload = rawExplanation().payload;
    expect(resolvePayloadPath(payload, "drivers.1.driverId")).toBe("ticket.average");
    expect(resolvePayloadPath(payload, "drivers.01.driverId")).toBeUndefined();
    expect(resolvePayloadPath(payload, "drivers.length")).toBeUndefined();
    expect(resolvePayloadPath(payload, "constructor")).toBeUndefined();
  });
});

describe("personal data (T7)", () => {
  it.each(["name", "customerName", "customer_phone", "Mobile", "emailAddress", "address"])(
    "refuses the key %s at any depth",
    (key) => {
      const auto = rawAutomation();
      const row = { ...auto, payload: { ...auto.payload, after: { ...auto.payload.after, [key]: "x" } } };
      expect(findPersonalData(row).map((f) => f.path.join("."))).toEqual([`payload.after.${key}`]);
      expect(InsightSchema.safeParse(row).success).toBe(false);
    },
  );

  it("does not flag words that merely contain a banned word", () => {
    expect(findPersonalData({ renamed: 1, surname_count: 2, phonebook: 3 })).toEqual([]);
  });

  it.each(["9876543210", "call 9876543210 now", "+91 9876543210", "91-9876543210"])(
    "refuses a phone-shaped string: %s",
    (text) => {
      const auto = rawAutomation();
      const row = { ...auto, payload: { ...auto.payload, after: { note: text } } };
      expect(InsightSchema.safeParse(row).success).toBe(false);
    },
  );

  it("does not flag uuids, hashes, timestamps, short numbers or a ten-digit paise figure", () => {
    const fact = rawFact();
    const big = { ...fact, payload: { ...fact.payload, value: { unit: "paise", value: "1234567890" } } };
    expect(findPersonalData(big)).toEqual([]);
    expect(findPersonalData({ a: "abc1234567890def", b: "123456789", c: "12345678901" })).toEqual([]);
    expect(InsightSchema.safeParse(big).success).toBe(true);
  });
});

describe("parseInsights", () => {
  it("keeps valid rows and drops and counts invalid ones", () => {
    const result = parseInsights([rawFact(), { ...rawForecast(), payload: { ...rawForecast().payload, value: 150 } }, rawAutomation()]);
    expect(result.valid.map((i) => i.claimType)).toEqual(["FACT", "AUTOMATION"]);
    expect(result.dropped).toBe(1);
    expect(result.issues[0]?.index).toBe(1);
  });
});
