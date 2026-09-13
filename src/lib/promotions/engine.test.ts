import { describe, expect, it } from "vitest";
import { bps, formatINR, fromRupees, paise } from "@/lib/money";
import {
  type CartLine,
  type EligibilityContext,
  type Promo,
  type PromoProduct,
  blankPromo,
  dayRange,
  eligible,
  generateCode,
  localDayAndTime,
  rankEligible,
  summarize,
  typeFlags,
  validate,
} from "./engine";

const products: readonly PromoProduct[] = [
  { slug: "og-frybird-classic", name: "OG Frybird Classic", price: fromRupees("99"), category: "Burgers" },
  { slug: "og-salt-fries", name: "OG Salt Fries", price: fromRupees("99"), category: "Fries" },
  { slug: "nashville-bomb", name: "Nashville Bomb", price: fromRupees("139"), category: "Burgers" },
];

const live = (over: Partial<Promo>): Promo => ({
  ...blankPromo(over.type ?? "percent"),
  name: "Test",
  startDate: "2026-09-01",
  endDate: "2026-12-31",
  status: "live",
  channels: { pos: true, web: true },
  ...over,
});

/** Sunday 13 Sep 2026, 14:32 IST. */
const now = new Date("2026-09-13T09:02:00Z");
const ctx = (over: Partial<EligibilityContext> = {}): EligibilityContext => ({ channel: "pos", segment: null, customerUses: null, now, ...over });
const line = (slug: string, quantity: number, rupees: string): CartLine => ({ slug, quantity, unitPrice: fromRupees(rupees) });

describe("summarize — mirrors promo-engine.js", () => {
  it("percent and coupon", () => {
    expect(summarize(live({ type: "percent", discountBps: bps(10), minOrder: fromRupees("200"), maxDiscount: fromRupees("100") }), products)).toEqual({
      headline: "10% OFF",
      lines: ["min ₹200 · up to ₹100"],
      short: "10% off",
    });
    expect(summarize(live({ type: "coupon", code: "FRYBIRD10", discountBps: bps(10) }), products).lines).toEqual(["Use code FRYBIRD10"]);
  });

  it("flat, bogo, combo, free item, happy hour", () => {
    expect(summarize(live({ type: "flat", discountAmount: fromRupees("50") }), products).headline).toBe("₹50 OFF");
    const bogo = summarize(live({ type: "bogo", buyProducts: ["og-frybird-classic"], getProducts: ["og-frybird-classic"] }), products);
    expect(bogo.short).toBe("Buy 1 OG Frybird Classic → Get 1 OG Frybird Classic FREE");
    const combo = summarize(live({ type: "combo", products: ["og-frybird-classic", "og-salt-fries"], comboPrice: fromRupees("179") }), products);
    expect(combo.headline).toBe("OG Frybird Classic + OG Salt Fries");
    expect(combo.lines).toEqual(["₹179", "was ₹198"]);
    expect(combo.saves).toBe(fromRupees("19"));
    expect(summarize(live({ type: "freeitem", products: ["og-salt-fries"], minOrder: fromRupees("300") }), products).headline).toBe("FREE OG Salt Fries");
    const hh = summarize(live({ type: "happyhour", discountBps: bps(20), startTime: "15:00", endTime: "17:00", days: [true, true, true, true, true, false, false] }), products);
    expect(hh.lines).toEqual(["Mon–Fri", "15:00 → 17:00"]);
  });

  it("day ranges", () => {
    expect(dayRange([true, true, true, true, true, true, true])).toBe("Every day");
    expect(dayRange([false, false, false, false, false, false, false])).toBe("No days");
    expect(dayRange([true, false, true, false, false, false, false])).toBe("Mon Wed");
    expect(dayRange([false, false, false, false, true, true, true])).toBe("Fri–Sun");
  });
});

describe("validate — every branch", () => {
  it("passes a complete percent promo", () => {
    expect(validate(live({ discountBps: bps(10) }))).toEqual([]);
  });

  it("names each missing thing", () => {
    const errors = validate({ ...blankPromo("bogo"), name: "", discountBps: null, days: [false, false, false, false, false, false, false] });
    expect(errors).toContain("Give the promotion a name.");
    expect(errors).toContain("Select at least one product to buy and one to get.");
    expect(errors).toContain("Add a start and end date.");
    expect(errors).toContain("Pick at least one day.");
    expect(validate(live({ type: "combo", products: ["a"], comboPrice: null }))).toEqual(expect.arrayContaining(["A combo needs at least two products.", "Enter a combo price."]));
    expect(validate(live({ type: "flat", discountAmount: null }))).toContain("Enter a discount.");
    expect(validate(live({ type: "coupon", code: "", discountBps: bps(10) }))).toContain("Enter a coupon code.");
    expect(validate(live({ type: "coupon", code: "fry-10", discountBps: bps(10) }))).toContain("A coupon code is 3–20 capital letters and digits.");
    expect(validate(live({ type: "freeitem", products: ["og-salt-fries"], minOrder: null }))).toContain("Minimum order must be greater than ₹0.");
    expect(validate(live({ startDate: "2026-09-30", endDate: "2026-09-01" }))).toContain("End date must be after the start date.");
    expect(validate(live({ type: "happyhour", discountBps: bps(10), startTime: null, endTime: null }))).toContain("Add a start and end time.");
    expect(validate(live({ discountBps: bps(150) }))).toContain("A discount can't be more than 100%.");
  });

  it("type flags follow the design's t map", () => {
    expect(typeFlags("bogo")).toMatchObject({ isBuyGet: true, showDiscount: false, hasMinMax: false });
    expect(typeFlags("coupon")).toMatchObject({ isCoupon: true, isPct: true, hasMinMax: true, showDiscount: true });
    expect(typeFlags("combo")).toMatchObject({ hasProducts: true, isCombo: true, showDiscount: false, productsTitle: "PRODUCTS IN THIS COMBO" });
    expect(typeFlags("freeitem")).toMatchObject({ hasProducts: true, isFree: true, productsTitle: "FREE PRODUCT" });
  });
});

describe("eligible — the design's branches", () => {
  const cart = [line("og-frybird-classic", 1, "99"), line("og-salt-fries", 1, "99")];

  it("percent with minimum and cap", () => {
    expect(eligible(live({ discountBps: bps(10) }), cart, products, ctx())).toBe(fromRupees("19.80"));
    expect(eligible(live({ discountBps: bps(10), minOrder: fromRupees("200") }), cart, products, ctx())).toBeNull();
    expect(eligible(live({ discountBps: bps(50), maxDiscount: fromRupees("30") }), cart, products, ctx())).toBe(fromRupees("30"));
  });

  it("flat, capped at the cart", () => {
    expect(eligible(live({ type: "flat", discountAmount: fromRupees("50") }), cart, products, ctx())).toBe(fromRupees("50"));
    expect(eligible(live({ type: "flat", discountAmount: fromRupees("500") }), cart, products, ctx())).toBe(fromRupees("198"));
  });

  it("bogo needs buy + get of the same product, and frees the cheapest 'get'", () => {
    const bogo = live({ type: "bogo", buyProducts: ["og-frybird-classic"], getProducts: ["og-frybird-classic"] });
    expect(eligible(bogo, [line("og-frybird-classic", 1, "99")], products, ctx())).toBeNull();
    expect(eligible(bogo, [line("og-frybird-classic", 2, "99")], products, ctx())).toBe(fromRupees("99"));
    const half = live({ type: "bxgy", buyProducts: ["nashville-bomb"], getProducts: ["og-salt-fries"], getDiscountBps: bps(50) });
    expect(eligible(half, [line("nashville-bomb", 1, "139"), line("og-salt-fries", 1, "99")], products, ctx())).toBe(fromRupees("49.50"));
  });

  it("combo needs every product and saves the difference", () => {
    const combo = live({ type: "combo", products: ["og-frybird-classic", "og-salt-fries"], comboPrice: fromRupees("179") });
    expect(eligible(combo, cart, products, ctx())).toBe(fromRupees("19"));
    expect(eligible(combo, [line("og-frybird-classic", 1, "99")], products, ctx())).toBeNull();
    expect(eligible({ ...combo, comboPrice: fromRupees("250") }, cart, products, ctx())).toBeNull();
  });

  it("free item over a minimum", () => {
    const free = live({ type: "freeitem", products: ["og-salt-fries"], minOrder: fromRupees("150") });
    expect(eligible(free, cart, products, ctx())).toBe(fromRupees("99"));
    expect(eligible(free, [line("og-salt-fries", 1, "99")], products, ctx())).toBeNull();
  });

  it("happy hour respects the day and the time in IST", () => {
    const weekdaysOnly = live({ type: "happyhour", discountBps: bps(20), startTime: "12:00", endTime: "16:00", days: [true, true, true, true, true, false, false] });
    expect(localDayAndTime(now)).toEqual({ day: 6, hm: "14:32", date: "2026-09-13" }); // Sunday
    expect(eligible(weekdaysOnly, cart, products, ctx())).toBeNull();
    const everyDay = { ...weekdaysOnly, days: [true, true, true, true, true, true, true] as Promo["days"] };
    expect(eligible(everyDay, cart, products, ctx())).toBe(fromRupees("39.60"));
    expect(eligible({ ...everyDay, startTime: "15:00", endTime: "17:00" }, cart, products, ctx())).toBeNull();
  });
});

describe("eligible — the shop's own rules", () => {
  const cart = [line("og-frybird-classic", 2, "99")];
  const promo = live({ discountBps: bps(10) });

  it("only live, only on a channel that is on", () => {
    expect(eligible({ ...promo, status: "paused" }, cart, products, ctx())).toBeNull();
    expect(eligible({ ...promo, channels: { pos: false, web: true } }, cart, products, ctx({ channel: "pos" }))).toBeNull();
    expect(eligible({ ...promo, channels: { pos: false, web: true } }, cart, products, ctx({ channel: "web" }))).toBe(fromRupees("19.80"));
  });

  it("dates: not before the start, not after the end", () => {
    expect(eligible({ ...promo, startDate: "2026-09-14" }, cart, products, ctx())).toBeNull();
    expect(eligible({ ...promo, endDate: "2026-09-12" }, cart, products, ctx())).toBeNull();
  });

  it("usage limit and per-customer limit", () => {
    expect(eligible({ ...promo, usageLimit: 5, usageCount: 5 }, cart, products, ctx())).toBeNull();
    expect(eligible({ ...promo, usageLimit: 5, usageCount: 4 }, cart, products, ctx())).not.toBeNull();
    expect(eligible({ ...promo, perCustomer: 1 }, cart, products, ctx({ customerUses: null }))).toBeNull();
    expect(eligible({ ...promo, perCustomer: 1 }, cart, products, ctx({ customerUses: 1 }))).toBeNull();
    expect(eligible({ ...promo, perCustomer: 1 }, cart, products, ctx({ customerUses: 0 }))).not.toBeNull();
  });

  it("segments resolve only when a customer is attached", () => {
    expect(eligible({ ...promo, customer: "new" }, cart, products, ctx({ segment: null }))).toBeNull();
    expect(eligible({ ...promo, customer: "new" }, cart, products, ctx({ segment: "returning" }))).toBeNull();
    expect(eligible({ ...promo, customer: "new" }, cart, products, ctx({ segment: "new" }))).not.toBeNull();
  });

  it("never negative, never on an empty cart", () => {
    expect(eligible(promo, [], products, ctx())).toBeNull();
    expect(eligible(live({ type: "flat", discountAmount: fromRupees("1000") }), cart, products, ctx())).toBe(fromRupees("198"));
  });

  it("ranks the biggest saving first", () => {
    const ranked = rankEligible([live({ discountBps: bps(10) }), live({ type: "flat", discountAmount: fromRupees("50") })], cart, products, ctx());
    expect(ranked.map((entry) => formatINR(entry.saving))).toEqual(["₹50", "₹19.80"]);
  });
});

describe("codes", () => {
  it("generates FRY + 4 unambiguous characters", () => {
    expect(generateCode(() => 0)).toBe("FRYAAAA");
    expect(generateCode()).toMatch(/^FRY[A-HJ-NP-Z2-9]{4}$/);
  });

  it("blank defaults match the design", () => {
    const b = blankPromo("percent");
    expect(b.discountBps).toBe(1000);
    expect(b.discountAmount).toBe(paise(10000));
    expect(b.comboPrice).toBe(paise(29900));
    expect(b.getDiscountBps).toBe(10000);
    expect(b.days.every(Boolean)).toBe(true);
    expect(b.channels).toEqual({ pos: false, web: false });
  });
});
