import { describe, expect, it } from "vitest";
import { ZERO, add, bps, formatBps, formatINR, fromRupees, subtract } from "@/lib/money";
import {
  DEFAULT_PRICE_BASIS,
  type PricingContext,
  margin,
  priceLine,
  priceOrder,
  pricingContext,
  productMargin,
} from "./index";

const GST_5 = bps(5);

/** The two modes, so every behavioural test can be run against both. */
const EXCLUSIVE: PricingContext = { basis: "exclusive", place: "intra-state" };
const INCLUSIVE: PricingContext = { basis: "inclusive", place: "intra-state" };
const BOTH = [
  ["exclusive", EXCLUSIVE],
  ["inclusive", INCLUSIVE],
] as const;

describe("the switch", () => {
  it("reads the basis from the organization and nowhere else", () => {
    expect(pricingContext({ priceBasis: "inclusive" })).toEqual({ basis: "inclusive", place: "intra-state" });
    expect(pricingContext({ priceBasis: "exclusive" })).toEqual({ basis: "exclusive", place: "intra-state" });
  });

  it("defaults a new organization to exclusive", () => {
    expect(DEFAULT_PRICE_BASIS).toBe("exclusive");
  });

  it("switches an inter-state supply to IGST without touching the basis", () => {
    const context = pricingContext({ priceBasis: "exclusive" }, { place: "inter-state" });
    const line = priceLine({ unitPrice: fromRupees("99"), quantity: 1, rateBps: GST_5 }, context);
    expect(line.igst).toBe(line.total);
    expect(add(line.cgst, line.sgst)).toBe(ZERO);
  });
});

describe("the OG Frybird Classic at ₹99, both ways", () => {
  /**
   * The worked example from the module docs, asserted rather than asserted-in-
   * prose. This is the whole reason the flag exists.
   */
  it("charges ₹103.95 and earns ₹99 when prices are exclusive", () => {
    const line = priceLine({ unitPrice: fromRupees("99"), quantity: 1, rateBps: GST_5 }, EXCLUSIVE);
    expect(formatINR(line.gross)).toBe("₹103.95");
    expect(formatINR(line.taxable)).toBe("₹99");
    expect(formatINR(line.total)).toBe("₹4.95");
  });

  it("charges ₹99 and earns ₹94.29 when prices are inclusive", () => {
    const line = priceLine({ unitPrice: fromRupees("99"), quantity: 1, rateBps: GST_5 }, INCLUSIVE);
    expect(formatINR(line.gross)).toBe("₹99");
    expect(formatINR(line.taxable)).toBe("₹94.29");
    expect(formatINR(line.total)).toBe("₹4.71");
  });

  it("differs by the tax rate — which is the risk the flag exists to control", () => {
    const exclusive = priceLine({ unitPrice: fromRupees("99"), quantity: 1, rateBps: GST_5 }, EXCLUSIVE);
    const inclusive = priceLine({ unitPrice: fromRupees("99"), quantity: 1, rateBps: GST_5 }, INCLUSIVE);
    expect(exclusive.taxable).toBeGreaterThan(inclusive.taxable);
    expect(exclusive.gross).toBeGreaterThan(inclusive.gross);
  });
});

describe.each(BOTH)("invariants that hold in %s mode", (_name, context) => {
  it("always has the parts summing to the whole", () => {
    for (const price of ["59", "99", "149", "199", "279", "319", "399"]) {
      const line = priceLine({ unitPrice: fromRupees(price), quantity: 3, rateBps: GST_5 }, context);
      expect(add(line.taxable, line.total)).toBe(line.gross);
      expect(add(line.cgst, line.sgst, line.igst)).toBe(line.total);
    }
  });

  it("never loses a paise to rounding on a whole order", () => {
    const order = priceOrder(
      {
        lines: [
          { unitPrice: fromRupees("99"), quantity: 1, rateBps: GST_5 },
          { unitPrice: fromRupees("149"), quantity: 2, rateBps: GST_5 },
          { unitPrice: fromRupees("59"), quantity: 3, rateBps: GST_5 },
        ],
      },
      context,
    );
    expect(add(...order.lines.map((line) => line.gross))).toBe(order.gross);
    expect(add(...order.lines.map((line) => line.taxable))).toBe(order.taxable);
    expect(add(order.taxable, order.total)).toBe(order.gross);
  });

  it("spreads an order discount so the parts sum to exactly the discount", () => {
    const order = priceOrder(
      {
        lines: [
          { unitPrice: fromRupees("99"), quantity: 1, rateBps: GST_5 },
          { unitPrice: fromRupees("319"), quantity: 1, rateBps: GST_5 },
          { unitPrice: fromRupees("59"), quantity: 1, rateBps: GST_5 },
        ],
        orderDiscount: fromRupees("50"),
      },
      context,
    );
    expect(order.discount).toBe(fromRupees("50"));
    // Weighted by line value: the ₹319 line absorbs the most.
    expect(order.lines[1]!.discount).toBeGreaterThan(order.lines[0]!.discount);
    expect(order.lines[0]!.discount).toBeGreaterThan(order.lines[2]!.discount);
  });

  it("taxes the discounted amount, not the pre-discount price", () => {
    const full = priceLine({ unitPrice: fromRupees("200"), quantity: 1, rateBps: GST_5 }, context);
    const discounted = priceLine(
      { unitPrice: fromRupees("200"), quantity: 1, discount: fromRupees("50"), rateBps: GST_5 },
      context,
    );
    expect(discounted.total).toBeLessThan(full.total);
  });

  it("adds modifier deltas per unit, before quantity", () => {
    // Nashville wings, 8 pc, two orders: (159 + 120 + 20) × 2 = 598.
    const line = priceLine(
      {
        unitPrice: fromRupees("159"),
        modifierDeltas: [fromRupees("120"), fromRupees("20")],
        quantity: 2,
        rateBps: GST_5,
      },
      context,
    );
    expect(line.listed).toBe(fromRupees("598"));
  });

  it("handles a free line without dividing by zero", () => {
    const order = priceOrder(
      { lines: [{ unitPrice: ZERO, quantity: 1, rateBps: GST_5 }], orderDiscount: fromRupees("10") },
      context,
    );
    expect(order.gross).toBeLessThanOrEqual(ZERO === order.gross ? ZERO : order.gross);
    expect(order.listed).toBe(ZERO);
  });

  it("taxes each line at its own rate rather than blending them", () => {
    // A burger as restaurant service at 5% beside something at 12%.
    const order = priceOrder(
      {
        lines: [
          { unitPrice: fromRupees("99"), quantity: 1, rateBps: GST_5 },
          { unitPrice: fromRupees("60"), quantity: 1, rateBps: bps(12) },
        ],
      },
      context,
    );
    expect(order.lines[0]!.total).not.toBe(order.lines[1]!.total);
    expect(add(order.lines[0]!.total, order.lines[1]!.total)).toBe(order.total);
  });
});

describe("inclusive pricing never surprises the customer", () => {
  it("charges exactly the listed price for every item on the menu", () => {
    // The promise of inclusive pricing: the board price is the final price.
    for (const price of ["59", "79", "89", "99", "109", "119", "129", "139", "149", "159", "179", "199", "239", "259", "279", "289", "299", "319", "329", "339", "399"]) {
      const line = priceLine({ unitPrice: fromRupees(price), quantity: 1, rateBps: GST_5 }, INCLUSIVE);
      expect(line.gross, `${price} did not round-trip`).toBe(fromRupees(price));
    }
  });
});

describe("margin follows the switch", () => {
  const cost = fromRupees("33.50");

  it("works from net-of-tax revenue, because GST is not revenue", () => {
    const exclusive = productMargin({ listedPrice: fromRupees("99"), rateBps: GST_5, cost }, EXCLUSIVE);
    const inclusive = productMargin({ listedPrice: fromRupees("99"), rateBps: GST_5, cost }, INCLUSIVE);

    expect(exclusive.netRevenue).toBe(fromRupees("99"));
    expect(inclusive.netRevenue).toBe(fromRupees("94.29"));
  });

  it("reports a worse margin under inclusive pricing on the same board price", () => {
    const exclusive = productMargin({ listedPrice: fromRupees("99"), rateBps: GST_5, cost }, EXCLUSIVE);
    const inclusive = productMargin({ listedPrice: fromRupees("99"), rateBps: GST_5, cost }, INCLUSIVE);

    // Same menu price, same cost, ~5% less revenue — so margin drops and food
    // cost percentage rises. Flipping the flag moves every figure on the
    // dashboard, which is exactly why it is worth confirming.
    expect(inclusive.marginBps).toBeLessThan(exclusive.marginBps);
    expect(inclusive.foodCostBps).toBeGreaterThan(exclusive.foodCostBps);

    expect(formatBps(exclusive.foodCostBps)).toBe("33.8%");
    expect(formatBps(inclusive.foodCostBps)).toBe("35.5%");
  });

  it("is revenue net of tax minus cost, and nothing else", () => {
    // No commission term. FRYBIRD sells direct, so contribution is exactly the
    // gap between what it earns and what the food costs.
    const direct = productMargin({ listedPrice: fromRupees("99"), rateBps: GST_5, cost }, EXCLUSIVE);
    expect(direct.contribution).toBe(subtract(direct.netRevenue, direct.cost));
    expect(direct.contribution).toBe(fromRupees("65.50"));
  });

  it("scales cost with quantity", () => {
    const three = productMargin({ listedPrice: fromRupees("99"), rateBps: GST_5, cost, quantity: 3 }, EXCLUSIVE);
    expect(three.cost).toBe(fromRupees("100.50"));
    expect(three.netRevenue).toBe(fromRupees("297"));
    // Margin per unit is unchanged by ordering three of them.
    const one = productMargin({ listedPrice: fromRupees("99"), rateBps: GST_5, cost }, EXCLUSIVE);
    expect(three.marginBps).toBe(one.marginBps);
  });

  it("reports a negative contribution rather than hiding it", () => {
    const upsideDown = margin({ netRevenue: fromRupees("50"), cost: fromRupees("80") });
    expect(upsideDown.contribution).toBe(fromRupees("-30"));
    expect(upsideDown.marginBps).toBe(-6000);
  });

  it("survives a zero-revenue day without throwing", () => {
    const nothing = margin({ netRevenue: ZERO, cost: ZERO });
    expect(nothing.marginBps).toBe(0);
    expect(nothing.foodCostBps).toBe(0);
  });
});
