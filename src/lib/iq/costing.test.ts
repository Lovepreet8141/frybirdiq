import { describe, expect, it } from "vitest";

import { bps, formatINR, fromRupees, paise } from "@/lib/money";

import {
  costFromRate,
  priceChangeBps,
  productCost,
  purchaseRatePerBaseUnit,
  rateToPaise,
  recipeLineCost,
  theoreticalRecipeCost,
  usableCostPerBaseUnit,
} from "./costing";

describe("usableCostPerBaseUnit", () => {
  it("charges the purchase rate when nothing is lost", () => {
    // 1 kg at ₹280, all of it usable: 28 paise a gram, 28000 millipaise.
    const rate = usableCostPerBaseUnit({
      purchaseCost: fromRupees("280"),
      purchaseQuantityBase: 1000,
      yieldBps: bps(100),
      wasteBps: bps(0),
    });
    expect(rate).toBe(28_000n);
  });

  it("raises the cost by what trimming removes", () => {
    // The whole point of the module: ₹280/kg at 80% yield is ₹350/kg usable,
    // not ₹280. Costing this at 28 paise/g understates food cost by a fifth.
    const rate = usableCostPerBaseUnit({
      purchaseCost: fromRupees("280"),
      purchaseQuantityBase: 1000,
      yieldBps: bps(80),
      wasteBps: bps(0),
    });
    expect(rate).toBe(35_000n);
    expect(formatINR(rateToPaise(rate))).toBe("₹0.35");
  });

  it("compounds waste on top of yield rather than adding it", () => {
    // 80% yield then 3% spoilage leaves 77.6% usable, not 77%.
    const rate = usableCostPerBaseUnit({
      purchaseCost: fromRupees("280"),
      purchaseQuantityBase: 1000,
      yieldBps: bps(80),
      wasteBps: bps(3),
    });
    expect(rate).toBe(36_082n); // 28000 / 0.776
  });

  it("keeps sub-paisa rates that whole paise would destroy", () => {
    // A 50 kg sack of salt at ₹250 is half a paisa per gram. Rounded to whole
    // paise that is zero, and every recipe seasoned with it would cost nothing
    // — the error is invisible because the number looks plausible.
    const rate = usableCostPerBaseUnit({
      purchaseCost: fromRupees("250"),
      purchaseQuantityBase: 50_000,
      yieldBps: bps(100),
      wasteBps: bps(0),
    });
    expect(rate).toBe(500n); // 0.5 paise per gram
    expect(rateToPaise(rate)).toBe(1n); // rounds up to a paisa for display only
    // 500 g of it still costs a real ₹2.50.
    expect(costFromRate(rate, 500)).toBe(250n);
    expect(formatINR(costFromRate(rate, 500))).toBe("₹2.50");
  });

  it("refuses a yield of zero rather than dividing by it", () => {
    expect(() =>
      usableCostPerBaseUnit({
        purchaseCost: fromRupees("280"),
        purchaseQuantityBase: 1000,
        yieldBps: bps(0),
        wasteBps: bps(0),
      }),
    ).toThrow(/Yield must be greater than 0%/);
  });

  it("refuses total waste", () => {
    expect(() =>
      usableCostPerBaseUnit({
        purchaseCost: fromRupees("280"),
        purchaseQuantityBase: 1000,
        yieldBps: bps(100),
        wasteBps: bps(100),
      }),
    ).toThrow(/nothing to cost/);
  });
});

describe("recipeLineCost", () => {
  it("costs 150 g of an 80%-yield ingredient at the usable rate", () => {
    const cost = recipeLineCost({
      purchaseCost: fromRupees("280"),
      purchaseQuantityBase: 1000,
      yieldBps: bps(80),
      wasteBps: bps(0),
      usageQuantityBase: 150,
    });
    expect(cost).toBe(5250n); // 35 paise × 150 g = ₹52.50
    expect(formatINR(cost)).toBe("₹52.50");
  });

  it("rounds once at the end, not once per gram", () => {
    // A rate of 36.082 paise/g over 150 g is 5412.3 paise. Rounding the rate to
    // 36 paise first would give 5400 — twelve paise adrift on one line, and
    // this happens on every line of every recipe.
    const input = {
      purchaseCost: fromRupees("280"),
      purchaseQuantityBase: 1000,
      yieldBps: bps(80),
      wasteBps: bps(3),
    } as const;
    expect(recipeLineCost({ ...input, usageQuantityBase: 150 })).toBe(5412n);
  });

  it("costs nothing when a line uses nothing", () => {
    expect(
      recipeLineCost({
        purchaseCost: fromRupees("280"),
        purchaseQuantityBase: 1000,
        yieldBps: bps(100),
        wasteBps: bps(0),
        usageQuantityBase: 0,
      }),
    ).toBe(0n);
  });

  it("refuses a negative usage", () => {
    expect(() =>
      recipeLineCost({
        purchaseCost: fromRupees("280"),
        purchaseQuantityBase: 1000,
        yieldBps: bps(100),
        wasteBps: bps(0),
        usageQuantityBase: -1,
      }),
    ).toThrow(/negative quantity/);
  });
});

describe("productCost", () => {
  it("sums food and packaging alike", () => {
    // A burger: chicken, bun, sauce, and the box it leaves in.
    const total = productCost([paise(5250), paise(1200), paise(480), paise(350)]);
    expect(total).toBe(7280n);
    expect(formatINR(total)).toBe("₹72.80");
  });

  it("is zero for a product with no recipe yet", () => {
    expect(productCost([])).toBe(0n);
  });
});

describe("theoreticalRecipeCost", () => {
  it("is null, not zero, for a recipe with no lines yet", () => {
    // A recipe nobody has entered ingredients for is unknown, not free.
    const result = theoreticalRecipeCost([]);
    expect(result.total).toBeNull();
    expect(result.lines).toEqual([]);
  });

  it("costs each line at the ingredient's stored rate and sums them", () => {
    const chickenRate = purchaseRatePerBaseUnit(fromRupees("280"), 1000); // ignoring yield/waste for this fixture
    const result = theoreticalRecipeCost([
      { ingredientId: "chicken", quantityBase: 150, costPerBaseUnitMilli: chickenRate },
      { ingredientId: "bun", quantityBase: 1, costPerBaseUnitMilli: 1_200_000n as never },
    ]);
    expect(result.lines).toHaveLength(2);
    expect(result.total).toBe(costFromRate(chickenRate, 150) + costFromRate(1_200_000n as never, 1));
    expect(formatINR(result.total ?? paise(0))).not.toBe("₹0");
  });

  it("flags a line as unpriced when the ingredient has never had a price recorded", () => {
    const result = theoreticalRecipeCost([{ ingredientId: "new-ingredient", quantityBase: 50, costPerBaseUnitMilli: 0n as never }]);
    expect(result.lines[0]?.priced).toBe(false);
    expect(result.lines[0]?.cost).toBe(0n);
    // The line still reports ₹0 honestly — it really has cost nothing to date —
    // but `priced: false` is what lets a screen tell "nothing" from "unknown".
    expect(result.total).toBe(0n);
  });

  it("treats packaging like any other line — it adds to the total", () => {
    const boxRate = purchaseRatePerBaseUnit(fromRupees("35"), 100); // ₹35 for 100 boxes
    const result = theoreticalRecipeCost([{ ingredientId: "box", quantityBase: 1, costPerBaseUnitMilli: boxRate }]);
    expect(result.lines[0]?.priced).toBe(true);
    expect(result.total).toBe(costFromRate(boxRate, 1));
  });
});

describe("priceChangeBps", () => {
  it("reports a rise as positive basis points", () => {
    // ₹257/kg to ₹280/kg is +8.95%.
    const previous = purchaseRatePerBaseUnit(fromRupees("257"), 1000);
    const current = purchaseRatePerBaseUnit(fromRupees("280"), 1000);
    expect(priceChangeBps(previous, current)).toBe(894); // 8.94%
  });

  it("reports a fall as negative", () => {
    const previous = purchaseRatePerBaseUnit(fromRupees("280"), 1000);
    const current = purchaseRatePerBaseUnit(fromRupees("257"), 1000);
    expect(priceChangeBps(previous, current)).toBeLessThan(0);
  });

  it("has nothing to say about a first price", () => {
    expect(priceChangeBps(null, 28_000n as never)).toBeNull();
  });
});
