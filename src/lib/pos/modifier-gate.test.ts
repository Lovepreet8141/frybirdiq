import { describe, expect, it } from "vitest";
import { needsPosModifierPicker } from "./modifier-gate";

describe("needsPosModifierPicker", () => {
  it("is false for a product with no modifier groups", () => {
    expect(needsPosModifierPicker([])).toBe(false);
  });

  it("is false when every group is optional — a sauce the customer could take or leave", () => {
    expect(needsPosModifierPicker([{ minSelections: 0 }])).toBe(false);
    expect(needsPosModifierPicker([{ minSelections: 0 }, { minSelections: 0 }])).toBe(false);
  });

  it("is true when any group requires a choice — a size or a spice level", () => {
    expect(needsPosModifierPicker([{ minSelections: 1 }])).toBe(true);
    expect(needsPosModifierPicker([{ minSelections: 0 }, { minSelections: 1 }])).toBe(true);
  });

  it("is true when a group requires more than one choice", () => {
    expect(needsPosModifierPicker([{ minSelections: 2 }])).toBe(true);
  });
});
