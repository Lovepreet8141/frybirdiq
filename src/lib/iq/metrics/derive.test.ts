import { describe, expect, it } from "vitest";

import { type Paise, paise } from "@/lib/money";

import {
  aovNetV1,
  aovNetV2,
  channelShare,
  foodCostPctRecordedPurchases,
  foodCostPctTheoretical,
  grossProfit,
  netProfit,
  ratioBpsOrNull,
  sumCount,
  sumPaise,
} from "./derive";

const p = (value: bigint | number): Paise => paise(value);

describe("sums", () => {
  it("sums paise and counts exactly, empty is zero", () => {
    expect(sumPaise([p(1), p(2), p(3)])).toBe(6n);
    expect(sumPaise([])).toBe(0n);
    expect(sumCount([4n, 5n])).toBe(9n);
    expect(sumCount([])).toBe(0n);
  });

  it("stays exact beyond Number.MAX_SAFE_INTEGER", () => {
    const big = p(2n ** 60n + 1n);
    expect(sumPaise([big, big])).toBe(2n ** 61n + 2n);
  });
});

describe("ratioBpsOrNull", () => {
  it("is null with no denominator, and with a negative one", () => {
    expect(ratioBpsOrNull(p(100), p(0))).toBeNull();
    expect(ratioBpsOrNull(p(0), p(0))).toBeNull();
    expect(ratioBpsOrNull(p(100), p(-500))).toBeNull();
  });

  it("rounds half away from zero like ratioBps", () => {
    // 1/3 = 3333.33 bps -> 3333; 2/3 = 6666.67 -> 6667
    expect(ratioBpsOrNull(p(1), p(3))).toBe(3333);
    expect(ratioBpsOrNull(p(2), p(3))).toBe(6667);
    // 1/20000 = 0.5 bps exactly -> 1 (half-up), never truncated to 0
    expect(ratioBpsOrNull(p(1), p(20_000))).toBe(1);
    expect(ratioBpsOrNull(p(0), p(20_000))).toBe(0);
  });

  it("allows a part larger than the whole and a negative part", () => {
    expect(ratioBpsOrNull(p(150), p(100))).toBe(15_000);
    expect(ratioBpsOrNull(p(-1), p(20_000))).toBe(-1);
  });
});

describe("average order value", () => {
  it("is null with no orders, in both versions", () => {
    expect(aovNetV1(p(10_000), 0)).toBeNull();
    expect(aovNetV2(p(10_000), 0n)).toBeNull();
    expect(aovNetV1(p(0), 0n)).toBeNull();
    expect(aovNetV2(p(0), 0)).toBeNull();
  });

  it("v1 truncates (parity with overview.ts averageOrder)", () => {
    expect(aovNetV1(p(10_001), 2)).toBe(5_000n); // 5000.5
    expect(aovNetV1(p(29_999), 3)).toBe(9_999n); // 9999.67
    expect(aovNetV1(p(10_000), 3n)).toBe(3_333n);
  });

  it("v2 rounds half up", () => {
    expect(aovNetV2(p(10_001), 2)).toBe(5_001n); // 5000.5
    expect(aovNetV2(p(29_999), 3)).toBe(10_000n); // 9999.67
    expect(aovNetV2(p(10_000), 3n)).toBe(3_333n); // 3333.33
    expect(aovNetV2(p(9_999), 2)).toBe(5_000n); // 4999.5
  });

  it("agrees on exact divisions", () => {
    expect(aovNetV1(p(30_000), 3)).toBe(10_000n);
    expect(aovNetV2(p(30_000), 3)).toBe(10_000n);
  });

  it("handles bigint-scale revenue without float loss", () => {
    const revenue = p(2n ** 62n + 1n);
    expect(aovNetV1(revenue, 2)).toBe(2n ** 61n);
    expect(aovNetV2(revenue, 2)).toBe(2n ** 61n + 1n);
  });

  it("rejects a fractional order count", () => {
    expect(() => aovNetV1(p(100), 1.5)).toThrow(RangeError);
    expect(() => aovNetV2(p(100), 1.5)).toThrow(RangeError);
  });

  it("is Σ÷Σ over days, not the mean of daily averages", () => {
    // Day 1: ₹1,000 over 1 order. Day 2: ₹100 over 9 orders.
    const revenue = sumPaise([p(100_000), p(10_000)]);
    const orders = sumCount([1n, 9n]);
    expect(aovNetV2(revenue, orders)).toBe(11_000n);
    const meanOfDaily = (aovNetV2(p(100_000), 1)! + aovNetV2(p(10_000), 9)!) / 2n;
    expect(meanOfDaily).not.toBe(11_000n);
  });
});

describe("food cost percentages", () => {
  it("divides cost by net revenue in bps", () => {
    expect(foodCostPctTheoretical(p(30_000), p(100_000))).toBe(3_000);
    expect(foodCostPctRecordedPurchases(p(33_333), p(100_000))).toBe(3_333);
  });

  it("is null on a day with no revenue", () => {
    expect(foodCostPctTheoretical(p(5_000), p(0))).toBeNull();
    expect(foodCostPctRecordedPurchases(p(0), p(0))).toBeNull();
  });

  it("is Σ÷Σ across days", () => {
    const cost = sumPaise([p(1_000), p(90_000)]);
    const revenue = sumPaise([p(10_000), p(100_000)]);
    expect(foodCostPctTheoretical(cost, revenue)).toBe(8_273); // 91000/110000 = 82.727%
  });
});

describe("profit", () => {
  it("matches the P&L composition", () => {
    expect(grossProfit(p(100_000), p(30_000))).toBe(70_000n);
    expect(netProfit(p(100_000), p(30_000), p(50_000))).toBe(20_000n);
  });

  it("goes negative rather than clamping", () => {
    expect(grossProfit(p(0), p(30_000))).toBe(-30_000n);
    expect(netProfit(p(10_000), p(30_000), p(50_000))).toBe(-70_000n);
  });
});

describe("channel share", () => {
  it("is the channel's share of total net revenue", () => {
    expect(channelShare(p(25_000), p(100_000))).toBe(2_500);
    expect(channelShare(p(100_000), p(100_000))).toBe(10_000);
  });

  it("is null with no revenue", () => {
    expect(channelShare(p(0), p(0))).toBeNull();
  });
});
