/**
 * Purchase units and the base units a recipe measures in.
 *
 * An owner buys "10 kg chicken" and a recipe uses "150 g". Both refer to the
 * same ingredient, so one of them has to be converted, and the conversion has
 * to be exact — a float factor would put fractions of a paisa into every
 * recipe line that uses a kilogram-bought ingredient.
 */

import type { Unit } from "@/db/schema/inventory";

/** What a recipe measures in. PACK and the bulk units convert down to these. */
export type BaseUnit = Extract<Unit, "G" | "ML" | "PIECE">;

export interface UnitConversion {
  readonly unit: Unit;
  readonly label: string;
  readonly baseUnit: BaseUnit;
  /** How many base units one of this unit contains. Always an integer. */
  readonly factor: number;
}

/**
 * PACK is deliberately absent: a "pack" is not a quantity until someone says
 * how much is in it, and guessing would silently misprice every recipe using
 * it. Ingredients sold by the pack are entered by their contents.
 */
export const UNIT_CONVERSIONS: readonly UnitConversion[] = [
  { unit: "G", label: "g", baseUnit: "G", factor: 1 },
  { unit: "KG", label: "kg", baseUnit: "G", factor: 1000 },
  { unit: "ML", label: "ml", baseUnit: "ML", factor: 1 },
  { unit: "L", label: "L", baseUnit: "ML", factor: 1000 },
  { unit: "PIECE", label: "piece", baseUnit: "PIECE", factor: 1 },
];

const BY_UNIT = new Map(UNIT_CONVERSIONS.map((c) => [c.unit, c]));

export function conversionFor(unit: Unit): UnitConversion {
  const conversion = BY_UNIT.get(unit);
  if (!conversion) {
    throw new Error(
      `${unit} has no fixed size, so a quantity in ${unit} cannot be converted. Enter the contents instead.`,
    );
  }
  return conversion;
}

/** The units an ingredient measured in `baseUnit` can be purchased in. */
export function purchaseUnitsFor(baseUnit: BaseUnit): UnitConversion[] {
  return UNIT_CONVERSIONS.filter((c) => c.baseUnit === baseUnit);
}

/** Is this unit usable as a recipe's base unit? */
export function isBaseUnit(unit: Unit): unit is BaseUnit {
  return unit === "G" || unit === "ML" || unit === "PIECE";
}

/**
 * Converts a purchase quantity to base units. Integer in, integer out — 10 kg
 * is 10,000 g exactly, and nothing here can introduce a fraction.
 */
export function toBaseUnits(quantity: number, unit: Unit): number {
  if (!Number.isInteger(quantity)) {
    throw new Error(`Purchase quantity must be a whole number, got ${quantity}.`);
  }
  return quantity * conversionFor(unit).factor;
}

/** The reverse, for showing a stored base quantity in the unit it was bought in. */
export function fromBaseUnits(baseQuantity: number, unit: Unit): number {
  return baseQuantity / conversionFor(unit).factor;
}

export function unitLabel(unit: Unit): string {
  return BY_UNIT.get(unit)?.label ?? unit.toLowerCase();
}
