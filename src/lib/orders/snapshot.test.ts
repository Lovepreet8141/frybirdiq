import { describe, expect, it } from "vitest";
import { paise } from "@/lib/money";
import { priceLine, pricingContext } from "@/lib/pricing";
import { snapshotLines } from "./snapshot";

const inclusive = pricingContext({ priceBasis: "inclusive" });

function zinger() {
  return {
    name: "Zinger Burger",
    price: paise(19900),
    taxRateBps: 500,
    hsnCode: "2106",
    modifierGroups: [
      { name: "Heat", modifiers: [{ slug: "mild" }, { slug: "fiery" }] },
      { name: "Add-ons", modifiers: [{ slug: "extra-cheese" }] },
    ],
  };
}

describe("snapshotLines", () => {
  it("copies name, price, tax rate, HSN and every computed tax figure onto the line", () => {
    const product = zinger();
    const modifiers = [{ slug: "fiery", name: "Fiery", priceDelta: paise(0) }, { slug: "extra-cheese", name: "Extra cheese", priceDelta: paise(3000) }];
    const priced = priceLine({ unitPrice: product.price, quantity: 2, modifierDeltas: modifiers.map((m) => m.priceDelta), rateBps: product.taxRateBps }, inclusive);

    const [row] = snapshotLines([{ product, quantity: 2, modifiers, unitPrice: paise(22900), priced }]);

    expect(row).toMatchObject({
      productName: "Zinger Burger",
      quantity: 2,
      unitPrice: paise(22900),
      lineSubtotal: priced.listed,
      lineDiscount: priced.discount,
      taxRateBps: 500,
      hsnCode: "2106",
      lineTaxable: priced.taxable,
      lineTax: priced.total,
      lineTotal: priced.gross,
      position: 0,
    });
    expect(row!.lineTaxable + row!.lineTax).toBe(row!.lineTotal);
  });

  it("names the group each modifier came from, and its price delta", () => {
    const product = zinger();
    const modifiers = [{ slug: "fiery", name: "Fiery", priceDelta: paise(0) }, { slug: "extra-cheese", name: "Extra cheese", priceDelta: paise(3000) }];
    const priced = priceLine({ unitPrice: product.price, quantity: 1, modifierDeltas: [paise(0), paise(3000)], rateBps: 500 }, inclusive);

    const [row] = snapshotLines([{ product, quantity: 1, modifiers, unitPrice: paise(22900), priced }]);

    expect(row!.modifiers).toEqual([
      { groupName: "Heat", modifierName: "Fiery", priceDelta: paise(0) },
      { groupName: "Add-ons", modifierName: "Extra cheese", priceDelta: paise(3000) },
    ]);
  });

  it("falls back to 'Options' when the product no longer names the modifier's group", () => {
    const product = { ...zinger(), modifierGroups: [] };
    const priced = priceLine({ unitPrice: product.price, quantity: 1, rateBps: 500 }, inclusive);
    const [row] = snapshotLines([{ product, quantity: 1, modifiers: [{ slug: "gone", name: "Gone", priceDelta: paise(0) }], unitPrice: product.price, priced }]);
    expect(row!.modifiers[0]!.groupName).toBe("Options");
  });

  it("is a copy: a later menu change does not reach the snapshot", () => {
    const product = zinger();
    const priced = priceLine({ unitPrice: product.price, quantity: 1, rateBps: 500 }, inclusive);
    const [row] = snapshotLines([{ product, quantity: 1, modifiers: [], unitPrice: product.price, priced }]);

    product.name = "Zinger Burger (new recipe)";
    product.taxRateBps = 1800;

    expect(row!.productName).toBe("Zinger Burger");
    expect(row!.taxRateBps).toBe(500);
  });

  it("numbers lines by position in the order they were rung up", () => {
    const product = zinger();
    const priced = priceLine({ unitPrice: product.price, quantity: 1, rateBps: 500 }, inclusive);
    const line = { product, quantity: 1, modifiers: [], unitPrice: product.price, priced };
    expect(snapshotLines([line, line, line]).map((row) => row.position)).toEqual([0, 1, 2]);
  });
});
