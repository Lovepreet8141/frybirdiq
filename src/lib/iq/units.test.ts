import { describe, expect, it } from "vitest";

import { conversionFor, fromBaseUnits, isBaseUnit, purchaseUnitsFor, toBaseUnits, unitLabel } from "./units";

describe("conversionFor", () => {
  it("converts the bulk units down to their base", () => {
    expect(conversionFor("KG")).toMatchObject({ baseUnit: "G", factor: 1000 });
    expect(conversionFor("L")).toMatchObject({ baseUnit: "ML", factor: 1000 });
  });

  it("leaves a base unit's own conversion at one", () => {
    expect(conversionFor("G")).toMatchObject({ baseUnit: "G", factor: 1 });
    expect(conversionFor("PIECE")).toMatchObject({ baseUnit: "PIECE", factor: 1 });
  });

  it("refuses PACK — a pack has no fixed size until someone says what's in it", () => {
    expect(() => conversionFor("PACK")).toThrow(/no fixed size/);
  });
});

describe("purchaseUnitsFor", () => {
  it("offers both units an ingredient measured in grams can be bought in", () => {
    const units = purchaseUnitsFor("G").map((c) => c.unit);
    expect(units).toEqual(["G", "KG"]);
  });

  it("offers both units an ingredient measured in millilitres can be bought in", () => {
    const units = purchaseUnitsFor("ML").map((c) => c.unit);
    expect(units).toEqual(["ML", "L"]);
  });

  it("offers only piece for a piece-measured ingredient", () => {
    expect(purchaseUnitsFor("PIECE").map((c) => c.unit)).toEqual(["PIECE"]);
  });
});

describe("isBaseUnit", () => {
  it("accepts the three base units and rejects everything that converts to one", () => {
    expect(isBaseUnit("G")).toBe(true);
    expect(isBaseUnit("ML")).toBe(true);
    expect(isBaseUnit("PIECE")).toBe(true);
    expect(isBaseUnit("KG")).toBe(false);
    expect(isBaseUnit("L")).toBe(false);
    expect(isBaseUnit("PACK")).toBe(false);
  });
});

describe("toBaseUnits / fromBaseUnits", () => {
  it("converts a purchase quantity to base units exactly", () => {
    expect(toBaseUnits(10, "KG")).toBe(10_000);
    expect(toBaseUnits(2, "L")).toBe(2000);
    expect(toBaseUnits(5, "PIECE")).toBe(5);
  });

  it("refuses a fractional purchase quantity rather than round it", () => {
    // 10 kg chicken is exact; 10.5 kg is a typo or a scale reading that needs
    // rounding at entry, not silently rounded here.
    expect(() => toBaseUnits(1.5, "KG")).toThrow(/whole number/);
  });

  it("round-trips a base quantity back into the unit it was bought in", () => {
    expect(fromBaseUnits(10_000, "KG")).toBe(10);
    expect(fromBaseUnits(2000, "L")).toBe(2);
  });
});

describe("unitLabel", () => {
  it("labels every convertible unit", () => {
    expect(unitLabel("KG")).toBe("kg");
    expect(unitLabel("ML")).toBe("ml");
    expect(unitLabel("PIECE")).toBe("piece");
  });

  it("falls back to a lowercased unit name for PACK, which has no conversion entry", () => {
    expect(unitLabel("PACK")).toBe("pack");
  });
});
