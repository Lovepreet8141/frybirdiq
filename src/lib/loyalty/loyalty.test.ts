import { describe, expect, it } from "vitest";
import { ZERO, formatINR, fromRupees } from "@/lib/money";
import {
  LOYALTY_DISABLED,
  type LoyaltyConfig,
  isLoyaltyEnabled,
  maxRedeemable,
  pointsEarned,
  pointsReclaimable,
  pointsValue,
  redeem,
  remainingAfterPoints,
} from "./index";

/** FRYBIRD's scheme: 5% back, one point is one rupee, no minimum. */
const CONFIG: LoyaltyConfig = {
  earnBps: 500,
  pointValue: fromRupees("1"),
  minRedeemPoints: 0,
};

describe("earning", () => {
  it("gives 5% back as points", () => {
    expect(pointsEarned(fromRupees("300"), CONFIG)).toBe(15);
    expect(pointsEarned(fromRupees("100"), CONFIG)).toBe(5);
    expect(pointsEarned(fromRupees("1000"), CONFIG)).toBe(50);
  });

  it("rounds a part point down", () => {
    // ₹99 earns ₹4.95 of value. A part point is not a point, and rounding up
    // would mean a ₹10 order earns one — a rounding rule, not a reward.
    expect(pointsEarned(fromRupees("99"), CONFIG)).toBe(4);
    expect(pointsEarned(fromRupees("19"), CONFIG)).toBe(0);
  });

  it("earns nothing on a free or empty order", () => {
    expect(pointsEarned(ZERO, CONFIG)).toBe(0);
    expect(pointsEarned(fromRupees("-50"), CONFIG)).toBe(0);
  });

  it("earns nothing when loyalty is switched off", () => {
    expect(pointsEarned(fromRupees("500"), LOYALTY_DISABLED)).toBe(0);
    expect(isLoyaltyEnabled(LOYALTY_DISABLED)).toBe(false);
    expect(isLoyaltyEnabled(CONFIG)).toBe(true);
  });
});

describe("what points are worth", () => {
  it("values a point at a rupee", () => {
    expect(formatINR(pointsValue(15, CONFIG))).toBe("₹15");
    expect(formatINR(pointsValue(250, CONFIG))).toBe("₹250");
  });

  it("is worth nothing at zero or below", () => {
    expect(pointsValue(0, CONFIG)).toBe(ZERO);
    expect(pointsValue(-10, CONFIG)).toBe(ZERO);
  });
});

describe("redeeming", () => {
  it("spends what was asked for when the balance covers it", () => {
    const result = redeem({ requestedPoints: 50, balance: 200, orderTotal: fromRupees("300"), config: CONFIG });
    expect(result.points).toBe(50);
    expect(formatINR(result.discount)).toBe("₹50");
    expect(result.cappedBy).toBeNull();
  });

  it("cannot spend more points than the customer has", () => {
    const result = redeem({ requestedPoints: 500, balance: 80, orderTotal: fromRupees("300"), config: CONFIG });
    expect(result.points).toBe(80);
    expect(result.cappedBy).toBe("balance");
  });

  it("never takes off more than the order is worth", () => {
    // 900 points on a ₹300 order spends 300 and keeps the rest. Points may pay
    // for an order in full, but must never leave the shop owing money.
    const result = redeem({ requestedPoints: 900, balance: 900, orderTotal: fromRupees("300"), config: CONFIG });
    expect(result.points).toBe(300);
    expect(formatINR(result.discount)).toBe("₹300");
    expect(result.cappedBy).toBe("order-total");
    expect(remainingAfterPoints(fromRupees("300"), result)).toBe(ZERO);
  });

  it("says which cap bit, rather than silently spending a different number", () => {
    const byBalance = redeem({ requestedPoints: 100, balance: 40, orderTotal: fromRupees("500"), config: CONFIG });
    const byTotal = redeem({ requestedPoints: 400, balance: 400, orderTotal: fromRupees("120"), config: CONFIG });
    expect(byBalance.cappedBy).toBe("balance");
    expect(byTotal.cappedBy).toBe("order-total");
  });

  it("respects a minimum balance when one is set", () => {
    const gated: LoyaltyConfig = { ...CONFIG, minRedeemPoints: 100 };
    const under = redeem({ requestedPoints: 50, balance: 99, orderTotal: fromRupees("300"), config: gated });
    const over = redeem({ requestedPoints: 50, balance: 100, orderTotal: fromRupees("300"), config: gated });
    expect(under.points).toBe(0);
    expect(under.cappedBy).toBe("minimum");
    expect(over.points).toBe(50);
  });

  it("spends nothing on a zero balance or a zero request", () => {
    expect(redeem({ requestedPoints: 0, balance: 500, orderTotal: fromRupees("300"), config: CONFIG }).points).toBe(0);
    expect(redeem({ requestedPoints: 50, balance: 0, orderTotal: fromRupees("300"), config: CONFIG }).points).toBe(0);
  });

  it("spends nothing when loyalty is switched off", () => {
    const result = redeem({ requestedPoints: 50, balance: 500, orderTotal: fromRupees("300"), config: LOYALTY_DISABLED });
    expect(result.points).toBe(0);
    expect(result.discount).toBe(ZERO);
  });

  it("offers the most a balance could take off", () => {
    expect(maxRedeemable(200, fromRupees("300"), CONFIG).points).toBe(200);
    expect(maxRedeemable(900, fromRupees("300"), CONFIG).points).toBe(300);
  });

  it("leaves the right amount to pay", () => {
    const result = redeem({ requestedPoints: 120, balance: 200, orderTotal: fromRupees("327"), config: CONFIG });
    expect(formatINR(remainingAfterPoints(fromRupees("327"), result))).toBe("₹207");
  });
});

describe("pointsReclaimable — a refund clawing back what an order earned", () => {
  it("reclaims the full amount when it's all still there", () => {
    expect(pointsReclaimable(50, 15)).toBe(15);
  });

  it("floors at what's left, not what was originally earned — the customer spent some of it on a later order first", () => {
    expect(pointsReclaimable(8, 15)).toBe(8);
  });

  it("reclaims nothing from an empty balance", () => {
    expect(pointsReclaimable(0, 15)).toBe(0);
  });

  it("never goes negative even given a nonsensical negative balance", () => {
    expect(pointsReclaimable(-5, 15)).toBe(0);
  });

  it("reclaims nothing when the order earned nothing", () => {
    expect(pointsReclaimable(50, 0)).toBe(0);
  });
});
