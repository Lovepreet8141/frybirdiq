import { describe, expect, it } from "vitest";

import { add, bps, formatINR, fromRupees } from "@/lib/money";

import { breakEven, surplus } from "./breakeven";
import { contribution, netRevenueOf, profit, shareOfRevenueBps, total } from "./profit";
import { achievedMarginBps, requiredPrice, toMenuPrice } from "./pricing";

describe("profit", () => {
  it("separates the cost that scales from the cost that does not", () => {
    const result = profit({
      revenue: fromRupees("240000"),
      directCosts: fromRupees("81600"), // 34%
      operatingExpenses: fromRupees("120000"),
    });
    expect(formatINR(result.grossProfit)).toBe("₹1,58,400");
    expect(formatINR(result.netProfit)).toBe("₹38,400");
    expect(result.grossMarginBps).toBe(6600); // 66%
    expect(result.netMarginBps).toBe(1600); // 16%
    expect(result.foodCostBps).toBe(3400); // 34%
  });

  it("groups rupees the Indian way", () => {
    expect(formatINR(fromRupees("940000"))).toBe("₹9,40,000");
  });

  it("reports a loss as negative rather than clamping to zero", () => {
    const result = profit({
      revenue: fromRupees("100000"),
      directCosts: fromRupees("40000"),
      operatingExpenses: fromRupees("90000"),
    });
    expect(result.netProfit).toBeLessThan(0n);
    expect(formatINR(result.netProfit)).toBe("-₹30,000");
    expect(result.netMarginBps).toBe(-3000);
  });

  it("leaves margins null on a day with no sales", () => {
    // Zero would render as "0% margin" — a closed day reading as a disastrous
    // one, and dragging down any average that includes it.
    const result = profit({
      revenue: fromRupees("0"),
      directCosts: fromRupees("0"),
      operatingExpenses: fromRupees("4000"),
    });
    expect(result.grossMarginBps).toBeNull();
    expect(result.netMarginBps).toBeNull();
    expect(result.netProfit).toBe(fromRupees("-4000"));
  });

  it("sums a column exactly", () => {
    expect(total([fromRupees("12.35"), fromRupees("0.05"), fromRupees("7.60")])).toBe(
      fromRupees("20.00"),
    );
  });

  it("computes one product's contribution", () => {
    expect(formatINR(contribution(fromRupees("299"), fromRupees("72.80")))).toBe("₹226.20");
  });

  it("has no share of revenue to report when there is none", () => {
    expect(shareOfRevenueBps(fromRupees("100"), fromRupees("0"))).toBeNull();
  });
});

describe("netRevenueOf", () => {
  it("sums the net-of-tax total, not what the customer paid", () => {
    // The exact worked example from src/lib/pricing's own docs: a ₹99
    // burger at 5% GST earns ₹94.29, not ₹99 — the bug this guards against
    // is reading grandTotal (gross) here instead of taxableTotal (net).
    const orders = [
      { taxableTotal: fromRupees("94.29"), grandTotal: fromRupees("99.00") },
      { taxableTotal: fromRupees("94.29"), grandTotal: fromRupees("99.00") },
    ];
    expect(formatINR(netRevenueOf(orders))).toBe("₹188.58");
    // Confirms this is genuinely reading a different column, not coincidentally
    // matching — the gross sum would be ₹198.
    expect(netRevenueOf(orders)).not.toBe(add(...orders.map((o) => o.grandTotal)));
  });

  it("is zero for an empty period, not a crash", () => {
    expect(netRevenueOf([])).toBe(fromRupees("0"));
  });

  it("ignores every field but taxableTotal, so a caller cannot pass grandTotal by mistake and have it compile away silently", () => {
    // TypeScript enforces the shape; this just documents that extra fields
    // (channel, fulfilment, id — the real shape of a paidOrders() row) are
    // fine to pass through untouched.
    const rows = [{ taxableTotal: fromRupees("50"), grandTotal: fromRupees("52.50"), channel: "ONLINE" as const, id: "abc" }];
    expect(netRevenueOf(rows)).toBe(fromRupees("50"));
  });
});

describe("breakEven", () => {
  it("finds the revenue that covers the fixed costs", () => {
    // ₹1,20,000 of rent and wages, 34 paise of every rupee going on food.
    const result = breakEven({
      fixedCosts: fromRupees("120000"),
      variableCostBps: bps(34),
    });
    expect(result.contributionMarginBps).toBe(6600);
    expect(formatINR(result.revenue)).toBe("₹1,81,818.18");
    // Screens round this to whole rupees; the calc keeps the paise so a year of
    // monthly targets does not drift by the rounding.
    expect(formatINR(result.revenue, "whole")).toBe("₹1,81,818");
  });

  it("turns revenue into a number of orders, rounded up", () => {
    // 3,000.5 orders' worth of fixed cost is not covered by 3,000 orders.
    const result = breakEven({
      fixedCosts: fromRupees("120000"),
      variableCostBps: bps(34),
      averageContribution: fromRupees("197"),
    });
    expect(result.orders).toBe(610); // 120000/197 = 609.1
  });

  it("refuses to pretend there is a break-even point when every rupee is spent earning it", () => {
    expect(() => breakEven({ fixedCosts: fromRupees("120000"), variableCostBps: bps(100) })).toThrow(
      /loses money on each sale/,
    );
  });

  it("reports how far above break-even a month landed", () => {
    const be = breakEven({ fixedCosts: fromRupees("120000"), variableCostBps: bps(34) });
    expect(formatINR(surplus(fromRupees("240000"), be.revenue))).toBe("₹58,181.82");
  });
});

describe("requiredPrice", () => {
  it("treats margin as a share of price, not a markup on cost", () => {
    // The classic error: 30% margin on ₹70 is ₹100, not ₹91.
    const price = requiredPrice({
      mode: "margin",
      productCost: fromRupees("70"),
      targetMarginBps: bps(30),
    });
    expect(formatINR(price)).toBe("₹100");
    expect(achievedMarginBps(price, fromRupees("70"))).toBe(3000);
  });

  it("works back from a food cost target", () => {
    const price = requiredPrice({
      mode: "foodCost",
      ingredientCost: fromRupees("52.50"),
      targetFoodCostBps: bps(32),
    });
    expect(formatINR(price)).toBe("₹164.06");
  });

  it("adds a gateway fee on top rather than absorbing it", () => {
    const withoutFee = requiredPrice({
      mode: "margin",
      productCost: fromRupees("70"),
      targetMarginBps: bps(30),
    });
    const withFee = requiredPrice({
      mode: "margin",
      productCost: fromRupees("70"),
      targetMarginBps: bps(30),
      gatewayFeeBps: bps(2),
    });
    expect(withFee).toBeGreaterThan(withoutFee);
    expect(formatINR(withFee)).toBe("₹102.04");
  });

  it("refuses an unreachable margin", () => {
    expect(() =>
      requiredPrice({ mode: "margin", productCost: fromRupees("70"), targetMarginBps: bps(100) }),
    ).toThrow(/unreachable/);
  });

  it("refuses a negative margin target — that would price below cost", () => {
    expect(() =>
      requiredPrice({ mode: "margin", productCost: fromRupees("70"), targetMarginBps: bps(-1) }),
    ).toThrow(/below cost/);
  });

  it("refuses a food cost target of 0%, which needs an infinite price", () => {
    expect(() =>
      requiredPrice({ mode: "foodCost", ingredientCost: fromRupees("52.50"), targetFoodCostBps: bps(0) }),
    ).toThrow(/infinite price/);
  });

  it("refuses a food cost target above 100%, which prices below the ingredients", () => {
    expect(() =>
      requiredPrice({ mode: "foodCost", ingredientCost: fromRupees("52.50"), targetFoodCostBps: bps(101) }),
    ).toThrow(/below its ingredients/);
  });

  it("rounds up to a whole rupee for the board", () => {
    expect(formatINR(toMenuPrice(fromRupees("164.06")))).toBe("₹165");
    expect(toMenuPrice(fromRupees("165"))).toBe(fromRupees("165"));
  });
});

describe("achievedMarginBps", () => {
  it("has no margin to report on a zero or negative price", () => {
    // A free or comped item is not "a 100% loss margin" — it is not priced at
    // all, and division by zero would otherwise produce it.
    expect(achievedMarginBps(fromRupees("0"), fromRupees("70"))).toBeNull();
  });

  it("reports a negative margin honestly when the price sits below cost", () => {
    expect(achievedMarginBps(fromRupees("50"), fromRupees("70"))).toBeLessThan(0);
  });
});
