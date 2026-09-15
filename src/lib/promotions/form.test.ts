import { describe, expect, it } from "vitest";

import { fromRupees } from "@/lib/money";
import { type PromoInput, blankInput, priceLabel, promoToInput, toEngineProducts, toPromo } from "./form";
import { ALL_DAYS } from "./engine";

/** A fully filled-in editor form, the shape a real save posts. */
const fullInput: PromoInput = {
  id: null,
  name: "Weekday Wings",
  type: "percent",
  description: "20% off wings on weekdays",
  code: "wings-20!",
  buyQty: 1,
  buyProducts: [],
  getQty: 1,
  getProducts: [],
  getDiscountPct: 20,
  products: ["wings-6pc"],
  discountPct: "20",
  discountAmt: "",
  minOrder: "199",
  maxDiscount: "150.50",
  comboPrice: "",
  startDate: "2026-09-15",
  endDate: "2026-09-29",
  startTime: "11:00",
  endTime: "22:00",
  days: [true, true, true, true, true, false, false],
  customer: "everyone",
  stacking: "none",
  channels: { pos: true, web: true },
  usageLimit: "500",
  perCustomer: "1",
};

describe("toPromo", () => {
  it("converts money and percentage fields into the engine's paise and bps", () => {
    const promo = toPromo(fullInput);
    expect(promo.discountBps).toBe(2000);
    expect(promo.minOrder).toBe(fromRupees("199"));
    expect(promo.maxDiscount).toBe(fromRupees("150.50"));
    expect(promo.comboPrice).toBeNull();
    expect(promo.days).toEqual([true, true, true, true, true, false, false]);
  });

  it("normalizes a code to uppercase alphanumerics, capped at 20 characters", () => {
    const promo = toPromo({ ...fullInput, code: "  wings-20! off/now for a very long time  " });
    expect(promo.code).toBe("WINGS20OFFNOWFORAVER");
    expect(promo.code.length).toBeLessThanOrEqual(20);
  });

  it("floors and floors-at-one a fractional or zero buy/get quantity", () => {
    // The stepper cannot go below one item, and a half-typed quantity should
    // not round up to a quantity that was never entered.
    const promo = toPromo({ ...fullInput, buyQty: 0, getQty: 2.9 });
    expect(promo.buyQty).toBe(1);
    expect(promo.getQty).toBe(2);
  });

  it("clamps the buy-get discount to 0–100%", () => {
    expect(toPromo({ ...fullInput, getDiscountPct: 150 }).getDiscountBps).toBe(10_000);
    expect(toPromo({ ...fullInput, getDiscountPct: -10 }).getDiscountBps).toBe(0);
  });

  it("treats an empty money field as not set, not as zero", () => {
    // A blank "max discount" means uncapped — ₹0 would mean the promotion
    // discounts nothing, which is a different rule with the same UI state.
    const promo = toPromo({ ...fullInput, discountAmt: "", minOrder: "", maxDiscount: "", comboPrice: "" });
    expect(promo.discountAmount).toBeNull();
    expect(promo.minOrder).toBeNull();
    expect(promo.maxDiscount).toBeNull();
    expect(promo.comboPrice).toBeNull();
  });

  it("treats a money field that does not parse as not set, rather than crash the save", () => {
    expect(toPromo({ ...fullInput, minOrder: "not a number" }).minOrder).toBeNull();
  });

  it("treats an empty, negative or fractional count field as not set", () => {
    expect(toPromo({ ...fullInput, usageLimit: "" }).usageLimit).toBeNull();
    expect(toPromo({ ...fullInput, usageLimit: "-5" }).usageLimit).toBeNull();
    expect(toPromo({ ...fullInput, usageLimit: "2.5" }).usageLimit).toBeNull();
    expect(toPromo({ ...fullInput, usageLimit: "500" }).usageLimit).toBe(500);
  });

  it("rejects a percentage field that is empty, negative, or finer than one basis point", () => {
    expect(toPromo({ ...fullInput, discountPct: "" }).discountBps).toBeNull();
    expect(toPromo({ ...fullInput, discountPct: "-5" }).discountBps).toBeNull();
    expect(toPromo({ ...fullInput, discountPct: "12.5" }).discountBps).toBe(1250);
  });

  it("defaults usage and per-customer meta on a new promotion", () => {
    const promo = toPromo(fullInput);
    expect(promo.status).toBe("draft");
    expect(promo.usageCount).toBe(0);
    expect(promo.liveSince).toBeNull();
  });

  it("carries an existing promotion's saved status rather than resetting it", () => {
    const promo = toPromo(fullInput, { status: "live", liveSince: "2026-09-01T00:00:00.000Z", usageCount: 42 });
    expect(promo.status).toBe("live");
    expect(promo.usageCount).toBe(42);
    expect(promo.liveSince).toEqual(new Date("2026-09-01T00:00:00.000Z"));
  });
});

describe("promoToInput", () => {
  it("is the inverse of toPromo for the fields the editor round-trips", () => {
    const promo = toPromo(fullInput);
    const input = promoToInput(promo);
    expect(input.name).toBe(fullInput.name);
    expect(input.code).toBe("WINGS20"); // toPromo already normalized it
    expect(input.discountPct).toBe("20");
    expect(input.minOrder).toBe("199");
    expect(input.maxDiscount).toBe("150.5");
    expect(input.comboPrice).toBe("");
    expect(input.days).toEqual(fullInput.days);
  });
});

describe("blankInput", () => {
  it("starts today and runs two weeks, with every day selected", () => {
    const plusDays = (date: string, days: number) => {
      const d = new Date(`${date}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const input = blankInput("percent", "2026-09-15", plusDays);
    expect(input.startDate).toBe("2026-09-15");
    expect(input.endDate).toBe("2026-09-29");
    expect(input.days).toEqual(ALL_DAYS);
    expect(input.type).toBe("percent");
  });
});

describe("toEngineProducts / priceLabel", () => {
  const picker = { slug: "wings-6pc", name: "6 pc Wings", category: "Wings", priceRupees: "249" };

  it("parses a picker product's rupee-string price into paise, exactly", () => {
    expect(toEngineProducts([picker])[0]?.price).toBe(fromRupees("249"));
  });

  it("formats a picker product's price as a whole-rupee label", () => {
    expect(priceLabel(picker)).toBe("₹249");
  });
});
