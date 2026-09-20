import { describe, expect, it } from "vitest";
import { paise } from "@/lib/money";
import { SMALL_SAMPLE_ORDERS, comparePromotion, summariseOrders } from "./aov";

const o = (net: bigint, discount = 0n) => ({ taxableTotal: paise(net), discountTotal: paise(discount) });
const many = (n: number, net: bigint, discount = 0n) => Array.from({ length: n }, () => o(net, discount));

describe("summariseOrders", () => {
  it("is null, not zero, when there are no orders", () => {
    expect(summariseOrders([])).toEqual({ orders: 0, revenue: 0n, discount: 0n, aov: null });
  });
  it("averages net revenue per order in whole paise, rounding half up", () => {
    const s = summariseOrders([o(10_000n, 1_000n), o(20_001n, 500n)]);
    expect(s.orders).toBe(2);
    expect(s.revenue).toBe(30_001n);
    expect(s.discount).toBe(1_500n);
    expect(s.aov).toBe(15_001n); // 15000.5 rounds up
  });
});

describe("comparePromotion", () => {
  it("gives the AOV gap in paise and as basis points of the without-AOV", () => {
    const c = comparePromotion(many(40, 12_000n, 1_000n), many(50, 10_000n));
    expect(c.aovGap).toBe(2_000n);
    expect(c.aovGapBps).toBe(2_000);
    expect(c.smallSample).toBe(false);
  });
  it("labels a small sample on either side, and still reports the figures", () => {
    expect(comparePromotion(many(SMALL_SAMPLE_ORDERS - 1, 12_000n), many(100, 10_000n)).smallSample).toBe(true);
    expect(comparePromotion(many(100, 12_000n), many(SMALL_SAMPLE_ORDERS - 1, 10_000n)).smallSample).toBe(true);
    expect(comparePromotion(many(SMALL_SAMPLE_ORDERS, 12_000n), many(SMALL_SAMPLE_ORDERS, 10_000n)).smallSample).toBe(false);
  });
  it("has no gap when either side has no orders", () => {
    expect(comparePromotion([], many(50, 10_000n)).aovGap).toBeNull();
    expect(comparePromotion(many(50, 10_000n), []).aovGapBps).toBeNull();
  });
  it("a negative gap is reported as negative", () => {
    expect(comparePromotion(many(40, 8_000n), many(40, 10_000n)).aovGap).toBe(-2_000n);
    expect(comparePromotion(many(40, 8_000n), many(40, 10_000n)).aovGapBps).toBe(-2_000);
  });
});
