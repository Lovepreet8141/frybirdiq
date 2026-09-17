import { describe, expect, it } from "vitest";

import { observed } from "./observed-factory";
import { divRoundHalfAway, integerMedian, observedMedian, observedShare } from "./observed-stats";
import { estimated, type Observed } from "./quantity";

describe("divRoundHalfAway", () => {
  it("rounds halves away from zero in both directions", () => {
    expect([divRoundHalfAway(5n, 2n), divRoundHalfAway(-5n, 2n), divRoundHalfAway(4n, 3n), divRoundHalfAway(-5n, 3n)]).toEqual([3n, -3n, 1n, -2n]);
  });

  it("refuses division by zero", () => {
    expect(() => divRoundHalfAway(1n, 0n)).toThrow(/zero/);
  });
});

describe("integerMedian", () => {
  it("takes the middle of an odd count, unsorted input", () => {
    expect(integerMedian([9n, 1n, 5n])).toBe(5n);
  });

  it("takes the rounded mean of the two middle values of an even count", () => {
    expect(integerMedian([10n, 11n, 12n, 13n])).toBe(12n);
    expect(integerMedian([-13n, -12n, -11n, -10n])).toBe(-12n);
    expect(integerMedian([1n, 2n])).toBe(2n);
  });

  it("refuses an empty list", () => {
    expect(() => integerMedian([])).toThrow(/nothing/);
  });
});

describe("observedMedian and observedShare", () => {
  it("keeps the unit and stays Observed", () => {
    const points = ["100", "300", "200"].map((value) => observed({ unit: "paise", value }));
    const median: Observed = observedMedian(points);
    expect(median).toEqual({ unit: "paise", value: "200" });
    expect(observedShare(observed({ unit: "paise", value: "1000050" }), 200n)).toEqual({ unit: "paise", value: "20001" });
    expect(observedShare(observed({ unit: "count", value: 7 }), 5000n)).toEqual({ unit: "count", value: 4 });
  });

  it("refuses mixed units and an empty list", () => {
    expect(() => observedMedian([observed({ unit: "paise", value: "1" }), observed({ unit: "count", value: 1 })])).toThrow(/median/);
    expect(() => observedMedian([])).toThrow(/nothing/);
  });

  it("does not compile a median of estimates", () => {
    const forecast = estimated({ unit: "count", value: 3 });
    // @ts-expect-error — only Observed figures can make an Observed median
    const misuse = () => observedMedian([forecast]);
    expect(typeof misuse).toBe("function");
  });
});
