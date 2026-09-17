import { describe, expect, it } from "vitest";

import { observed, observedPaise } from "./observed-factory";

describe("observed", () => {
  it("brands a valid quantity read from rows", () => {
    expect(observed({ unit: "seconds", value: 420 })).toEqual({ unit: "seconds", value: 420 });
  });

  it("refuses an invalid quantity rather than branding it", () => {
    expect(() => observed({ unit: "grams", value: 0.5 })).toThrow();
  });

  it("turns a bigint paise column into a canonical paise string", () => {
    expect(observedPaise(-940000n)).toEqual({ unit: "paise", value: "-940000" });
    expect(observedPaise(0n)).toEqual({ unit: "paise", value: "0" });
  });
});
