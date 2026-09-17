import { describe, expect, it } from "vitest";

import { observed } from "./observed-factory";
import {
  EstimatedSchema,
  IntervalSchema,
  QuantitySchema,
  RangeSchema,
  compareQuantities,
  estimated,
  sumMagnitudes,
  type Estimated,
  type Observed,
} from "./quantity";

const count = (value: number) => estimated({ unit: "count", value });

describe("QuantitySchema", () => {
  it("carries money as canonical integer paise in a string", () => {
    expect(QuantitySchema.safeParse({ unit: "paise", value: "-12345" }).success).toBe(true);
    for (const value of ["01", "-0", "1.5", "", "1e3", 100]) {
      expect(QuantitySchema.safeParse({ unit: "paise", value }).success).toBe(false);
    }
  });

  it("refuses fractional or unsafe integers for every other unit", () => {
    expect(QuantitySchema.safeParse({ unit: "grams", value: 1.5 }).success).toBe(false);
    expect(QuantitySchema.safeParse({ unit: "count", value: 2 ** 53 }).success).toBe(false);
    expect(QuantitySchema.safeParse({ unit: "count", value: "5" }).success).toBe(false);
  });

  it("has no milli_pieces unit and no extra keys", () => {
    expect(QuantitySchema.safeParse({ unit: "milli_pieces", value: 5 }).success).toBe(false);
    expect(QuantitySchema.safeParse({ unit: "pieces", value: 5, note: "x" }).success).toBe(false);
  });
});

describe("brands", () => {
  it("keeps Estimated and Observed apart at compile time", () => {
    const est = count(3);
    const obs = observed({ unit: "count", value: 3 });
    // @ts-expect-error — an Estimated quantity is not an Observed one
    const forecastAsFact: Observed = est;
    // @ts-expect-error — an Observed quantity is not an Estimated one
    const factAsForecast: Estimated = obs;
    // @ts-expect-error — an unbranded quantity is neither
    const plainAsFact: Observed = { unit: "count", value: 3 };
    expect([forecastAsFact, factAsForecast, plainAsFact]).toHaveLength(3);
  });

  it("brands only valid quantities", () => {
    expect(() => estimated({ unit: "count", value: 1.2 })).toThrow();
    expect(EstimatedSchema.parse({ unit: "ml", value: 250 })).toEqual({ unit: "ml", value: 250 });
  });
});

describe("compareQuantities and sumMagnitudes", () => {
  it("compares paise exactly beyond float precision", () => {
    const a = estimated({ unit: "paise", value: "9007199254740993" });
    const b = estimated({ unit: "paise", value: "9007199254740992" });
    expect(compareQuantities(a, b)).toBe(1);
    expect(sumMagnitudes([a, b])).toBe(18014398509481985n);
  });

  it("refuses to compare or add different units", () => {
    expect(() => compareQuantities(count(1), estimated({ unit: "grams", value: 1 }))).toThrow(/cannot compare/);
    expect(() => sumMagnitudes([count(1), estimated({ unit: "grams", value: 1 })])).toThrow(/cannot add/);
  });
});

describe("IntervalSchema", () => {
  const interval = (p10: number, p50: number, p90: number) => ({
    p10: { unit: "count", value: p10 },
    p50: { unit: "count", value: p50 },
    p90: { unit: "count", value: p90 },
    nominalCoverage: 80,
  });

  it("accepts an ordered 80% interval", () => {
    expect(IntervalSchema.safeParse(interval(1, 2, 2)).success).toBe(true);
  });

  it("refuses disorder, mixed units and other coverages", () => {
    expect(IntervalSchema.safeParse(interval(3, 2, 4)).success).toBe(false);
    expect(IntervalSchema.safeParse({ ...interval(1, 2, 3), nominalCoverage: 90 }).success).toBe(false);
    expect(IntervalSchema.safeParse({ ...interval(1, 2, 3), p90: { unit: "grams", value: 3 } }).success).toBe(false);
  });
});

describe("RangeSchema", () => {
  it("accepts low ≤ high and refuses the reverse or a mixed unit", () => {
    const low = { unit: "paise", value: "100" };
    expect(RangeSchema.safeParse({ low, high: { unit: "paise", value: "100" }, basis: "simulation" }).success).toBe(true);
    expect(RangeSchema.safeParse({ low, high: { unit: "paise", value: "99" }, basis: "simulation" }).success).toBe(false);
    expect(RangeSchema.safeParse({ low, high: { unit: "count", value: 200 }, basis: "forecast" }).success).toBe(false);
  });
});
