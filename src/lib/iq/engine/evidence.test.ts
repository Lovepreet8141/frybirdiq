import { describe, expect, it } from "vitest";

import { CodeSchema, EvidenceSchema, IdentifierSchema, IstDateTimeSchema, PeriodSchema } from "./evidence";

describe("identifiers and codes", () => {
  it("accepts machine ids and refuses prose", () => {
    expect(IdentifierSchema.safeParse("food-cost.above_baseline:v2").success).toBe(true);
    expect(IdentifierSchema.safeParse("Ravi Kumar").success).toBe(false);
    expect(CodeSchema.safeParse("SHORT_HISTORY").success).toBe(true);
    expect(CodeSchema.safeParse("short history").success).toBe(false);
  });
});

describe("IST time", () => {
  it("requires the +05:30 offset", () => {
    expect(IstDateTimeSchema.safeParse("2026-09-17T07:30:00+05:30").success).toBe(true);
    expect(IstDateTimeSchema.safeParse("2026-09-17T02:00:00Z").success).toBe(false);
    expect(IstDateTimeSchema.safeParse("2026-09-17T07:30:00").success).toBe(false);
  });

  it("refuses a period that ends before it starts", () => {
    expect(PeriodSchema.safeParse({ start: "2026-09-17T10:00:00+05:30", end: "2026-09-17T09:00:00+05:30" }).success).toBe(false);
  });
});

describe("EvidenceSchema", () => {
  it("accepts each reference kind", () => {
    const uuid = "11111111-1111-4111-8111-111111111111";
    for (const e of [
      { kind: "insight", insightId: uuid },
      { kind: "query", sourceId: "orders.net", paramsHash: "b".repeat(64) },
      { kind: "forecast", forecastId: uuid },
      { kind: "action", actionId: uuid },
    ]) {
      expect(EvidenceSchema.safeParse(e).success).toBe(true);
    }
  });

  it("refuses copied content alongside a reference", () => {
    expect(
      EvidenceSchema.safeParse({ kind: "insight", insightId: "11111111-1111-4111-8111-111111111111", note: "Ravi" }).success,
    ).toBe(false);
  });
});
