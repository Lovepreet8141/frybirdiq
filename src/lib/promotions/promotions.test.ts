import { describe, expect, it } from "vitest";
import { ZERO, bps, formatINR, fromRupees } from "@/lib/money";
import { type Promotion, afterDiscount, applyPromotion, normaliseCode } from "./index";

const base: Promotion = {
  code: "FRYBIRD10",
  name: "10% off",
  discountBps: bps(10),
  discountAmount: null,
  minOrderAmount: null,
  maxDiscountAmount: null,
  startsAt: null,
  endsAt: null,
  usageLimit: null,
  usageCount: 0,
  isActive: true,
};

const apply = (promotion: Partial<Promotion> | null, rupees: string, now?: Date) =>
  applyPromotion({
    promotion: promotion === null ? null : { ...base, ...promotion },
    orderValue: fromRupees(rupees),
    now,
  });

describe("percentage codes", () => {
  it("takes the percentage off", () => {
    const result = apply({}, "500");
    expect(result.ok && formatINR(result.discount)).toBe("₹50");
  });

  it("respects a maximum", () => {
    // 10% of ₹2,000 is ₹200, capped at ₹100.
    const result = apply({ maxDiscountAmount: fromRupees("100") }, "2000");
    expect(result.ok && formatINR(result.discount)).toBe("₹100");
  });
});

describe("flat codes", () => {
  it("takes a fixed amount off", () => {
    const result = apply({ discountBps: null, discountAmount: fromRupees("75") }, "400");
    expect(result.ok && formatINR(result.discount)).toBe("₹75");
  });

  it("never discounts more than the order is worth", () => {
    // A code can make an order free. It must never make it negative, which
    // would have the shop paying the customer to eat.
    const result = apply({ discountBps: null, discountAmount: fromRupees("500") }, "300");
    expect(result.ok && formatINR(result.discount)).toBe("₹300");
    expect(afterDiscount(fromRupees("300"), result)).toBe(ZERO);
  });
});

describe("refusals", () => {
  it("says the code is unknown", () => {
    const result = apply(null, "500");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unknown");
  });

  it("distinguishes expired from not yet live", () => {
    // Three different problems should not share one message: a customer told
    // "invalid code" for all of them just retypes the same code.
    const past = apply({ endsAt: new Date("2020-01-01") }, "500");
    const future = apply({ startsAt: new Date("2099-01-01") }, "500");
    expect(!past.ok && past.reason).toBe("expired");
    expect(!future.ok && future.reason).toBe("not-started");
    expect(!past.ok && past.message).not.toBe(!future.ok && future.message);
  });

  it("refuses an order below the minimum, and says what the minimum is", () => {
    // Naming it is the point: "too small" leaves the customer guessing how
    // much more to add.
    const result = apply({ minOrderAmount: fromRupees("400") }, "300");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("below-minimum");
    expect(result.message).toContain("₹400");
  });

  it("allows an order exactly on the minimum", () => {
    expect(apply({ minOrderAmount: fromRupees("300") }, "300").ok).toBe(true);
  });

  it("refuses a code that has been used up", () => {
    const result = apply({ usageLimit: 100, usageCount: 100 }, "500");
    expect(!result.ok && result.reason).toBe("used-up");
  });

  it("allows the last use of a limited code", () => {
    expect(apply({ usageLimit: 100, usageCount: 99 }, "500").ok).toBe(true);
  });

  it("refuses an inactive code", () => {
    expect(!apply({ isActive: false }, "500").ok).toBe(true);
  });

  it("refuses when there is nothing to discount", () => {
    const result = apply({}, "0");
    expect(!result.ok && result.reason).toBe("nothing-to-discount");
  });

  it("leaves the order untouched when a code is refused", () => {
    const result = apply(null, "500");
    expect(afterDiscount(fromRupees("500"), result)).toBe(fromRupees("500"));
  });
});

describe("code entry", () => {
  it("forgives case and whitespace", () => {
    expect(normaliseCode("  frybird10 ")).toBe("FRYBIRD10");
  });

  it("does not accept an unbounded string", () => {
    expect(normaliseCode("x".repeat(200))).toHaveLength(40);
  });
});
