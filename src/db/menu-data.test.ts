import { describe, expect, it } from "vitest";
import { add, formatINR, fromRupees } from "@/lib/money";
import {
  CATEGORIES,
  CHICKEN_CUTS,
  CHICKEN_HEAT,
  CHICKEN_PRINTED_PRICES,
  COMBOS,
  SAUCES,
  TAX_RATES,
} from "./menu-data";

describe("chicken modifier pricing", () => {
  /**
   * The load-bearing test in this file.
   *
   * Popcorn, wings and tenders are stored as three products with size and heat
   * modifiers rather than eighteen SKUs. That collapse is only valid if base +
   * size delta + heat delta reproduces every cell of the printed board. If it
   * does not, the POS charges a price the customer never agreed to.
   */
  it("reproduces every printed price from base plus deltas", () => {
    for (const cut of CHICKEN_CUTS) {
      const printed = CHICKEN_PRINTED_PRICES[cut.slug];
      expect(printed, `no printed prices for ${cut.slug}`).toBeDefined();

      for (const heat of CHICKEN_HEAT) {
        for (const size of cut.sizes) {
          const computed = add(fromRupees(cut.basePrice), fromRupees(size.delta), fromRupees(heat.delta));
          const expected = fromRupees(printed![heat.slug]![size.slug]!);

          expect(
            computed,
            `${cut.name} · ${heat.name} · ${size.name}: computed ${formatINR(computed)}, board says ${formatINR(expected)}`,
          ).toBe(expected);
        }
      }
    }
  });

  it("covers every printed cell — no cut, heat or size silently dropped", () => {
    const cells = CHICKEN_CUTS.flatMap((cut) => cut.sizes.map((size) => `${cut.slug}/${size.slug}`)).length;
    expect(cells * CHICKEN_HEAT.length).toBe(18);

    for (const [cutSlug, byHeat] of Object.entries(CHICKEN_PRINTED_PRICES)) {
      const cut = CHICKEN_CUTS.find((candidate) => candidate.slug === cutSlug);
      expect(cut, `printed prices for unknown cut ${cutSlug}`).toBeDefined();

      for (const [heatSlug, bySize] of Object.entries(byHeat)) {
        expect(CHICKEN_HEAT.some((heat) => heat.slug === heatSlug)).toBe(true);
        expect(Object.keys(bySize).sort()).toEqual(cut!.sizes.map((size) => size.slug).sort());
      }
    }
  });

  it("keeps Classic as the base, so no delta is negative", () => {
    for (const heat of CHICKEN_HEAT) {
      expect(fromRupees(heat.delta)).toBeGreaterThanOrEqual(0n);
    }
    for (const cut of CHICKEN_CUTS) {
      for (const size of cut.sizes) {
        expect(fromRupees(size.delta)).toBeGreaterThanOrEqual(0n);
      }
    }
  });
});

describe("menu data integrity", () => {
  const products = CATEGORIES.flatMap((category) => category.products);

  it("has a unique slug for every product, combo and sauce", () => {
    const slugs = [...products, ...COMBOS, ...SAUCES].map((item) => item.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("has a unique slug for every category", () => {
    const slugs = CATEGORIES.map((category) => category.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("prices every product with something lib/money can read", () => {
    for (const product of [...products, ...COMBOS, ...SAUCES]) {
      expect(() => fromRupees(product.price), `${product.slug} has an unreadable price`).not.toThrow();
      expect(fromRupees(product.price), `${product.slug} is priced at or below zero`).toBeGreaterThan(0n);
    }
  });

  it("prices everything in whole rupees, as the board does", () => {
    for (const product of [...products, ...COMBOS, ...SAUCES]) {
      expect(fromRupees(product.price) % 100n, `${product.slug} carries paise`).toBe(0n);
    }
  });

  it("points every combo component at a product that exists", () => {
    const known = new Set([...products.map((p) => p.slug), ...CHICKEN_CUTS.map((c) => c.slug)]);
    for (const combo of COMBOS) {
      for (const component of combo.components) {
        expect(known.has(component), `${combo.slug} references unknown product ${component}`).toBe(true);
      }
    }
  });

  it("classifies every product as veg or non-veg", () => {
    // The green and brown marks are a legal requirement on Indian menus and a
    // hard filter for a large share of the customers. A missing value is not a
    // default — it is an error.
    for (const product of [...products, ...COMBOS, ...SAUCES]) {
      expect(["VEG", "NON_VEG"]).toContain(product.veg);
    }
  });

  it("never marks a chicken product veg", () => {
    const chickenish = /chicken|nashville bomb|frybird loaded|og smash|double smash|peri inferno|thunder|chipotle burger|og frybird/i;
    for (const product of products) {
      if (chickenish.test(product.name)) {
        expect(product.veg, `${product.name} is marked veg`).toBe("NON_VEG");
      }
    }
  });

  it("keeps spice levels inside the 0–5 scale", () => {
    for (const product of products) {
      if (product.spice === undefined) continue;
      expect(product.spice).toBeGreaterThanOrEqual(0);
      expect(product.spice).toBeLessThanOrEqual(5);
    }
  });

  it("has exactly one default tax rate", () => {
    expect(TAX_RATES.filter((rate) => rate.isDefault)).toHaveLength(1);
  });

  it("taxes restaurant service at 5% under SAC 996331", () => {
    const restaurant = TAX_RATES.find((rate) => rate.isDefault);
    expect(restaurant?.rateBps).toBe(500);
    expect(restaurant?.hsnCode).toBe("996331");
  });
});

describe("menu shape", () => {
  it("matches what the four boards print", () => {
    const counts = Object.fromEntries(CATEGORIES.map((c) => [c.slug, c.products.length]));
    expect(counts).toEqual({
      burgers: 8,
      "smash-burgers": 4,
      wraps: 6,
      fries: 6,
      "mac-and-cheese": 6,
      "rice-bowls": 3,
    });
    expect(COMBOS).toHaveLength(6);
    expect(SAUCES).toHaveLength(7);
  });

  it("has the cheapest item at ₹59 and the dearest at ₹399", () => {
    const all = [...CATEGORIES.flatMap((c) => c.products), ...COMBOS].map((p) => fromRupees(p.price));
    expect(all.reduce((a, b) => (a < b ? a : b))).toBe(fromRupees("59"));
    expect(all.reduce((a, b) => (a > b ? a : b))).toBe(fromRupees("399"));
  });
});
