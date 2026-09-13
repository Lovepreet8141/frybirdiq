/**
 * The promotions engine — types, fields, summarize(), validate() and
 * eligible(), ported from the design's `promo-engine.js` and extended with
 * the rules the shop already had: usage limits, per-customer limits, and
 * "never negative". The website's coupon path (`applyPromotion` in
 * ./index.ts) is the same family; this file is the product-aware superset
 * the editor, the POS and the website all evaluate through — on the
 * server. The client only displays.
 *
 * Money is integer paise throughout. The design's engine worked in rupee
 * floats; every branch here does the same arithmetic in `src/lib/money`.
 * Dates and times are Asia/Kolkata; empty times mean all day.
 */

import { BUSINESS_TIMEZONE } from "@/lib/dates";
import { type Bps, type Paise, ZERO, add, formatBps, formatINR, multiply, paise, percentOf } from "@/lib/money";

/* ------------------------------------------------------------------ */
/* Types and fields                                                    */
/* ------------------------------------------------------------------ */

export const PROMO_TYPES = [
  ["percent", "Percentage discount"],
  ["flat", "Flat discount"],
  ["bogo", "Buy one get one"],
  ["bxgy", "Buy X get Y"],
  ["combo", "Combo / bundle"],
  ["freeitem", "Free item"],
  ["happyhour", "Happy hour"],
  ["coupon", "Coupon code"],
] as const;
export type PromoType = (typeof PROMO_TYPES)[number][0];

export const PROMO_STATUSES = ["draft", "live", "paused"] as const;
export type PromoStatus = (typeof PROMO_STATUSES)[number];

export const CUSTOMER_SEGMENTS = ["everyone", "new", "returning", "members"] as const;
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];

export const STACKING = ["none", "allow"] as const;
export type Stacking = (typeof STACKING)[number];

/** Channels are POS and Website only — there is no app and no QR ordering. */
export interface PromoChannels {
  readonly pos: boolean;
  readonly web: boolean;
}

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** A promotion as the engine sees it. Money in paise; dates as YYYY-MM-DD and HH:MM in Asia/Kolkata. */
export interface Promo {
  readonly id: string | null;
  readonly name: string;
  readonly type: PromoType;
  readonly description: string;
  readonly code: string;
  readonly buyQty: number;
  readonly buyProducts: readonly string[];
  readonly getQty: number;
  readonly getProducts: readonly string[];
  /** Discount on the "get" items, in basis points. 10000 is free. */
  readonly getDiscountBps: Bps;
  readonly products: readonly string[];
  readonly discountBps: Bps | null;
  readonly discountAmount: Paise | null;
  readonly minOrder: Paise | null;
  readonly maxDiscount: Paise | null;
  readonly comboPrice: Paise | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly startTime: string | null;
  readonly endTime: string | null;
  /** Monday first. */
  readonly days: readonly [boolean, boolean, boolean, boolean, boolean, boolean, boolean];
  readonly customer: CustomerSegment;
  readonly stacking: Stacking;
  readonly channels: PromoChannels;
  readonly usageLimit: number | null;
  readonly perCustomer: number | null;
  readonly usageCount: number;
  readonly status: PromoStatus;
  readonly liveSince: Date | null;
}

export interface PromoProduct {
  readonly slug: string;
  readonly name: string;
  readonly price: Paise;
  readonly category: string;
}

export const ALL_DAYS: Promo["days"] = [true, true, true, true, true, true, true];

/** The design's `blank()`: a new promotion of a type, with its defaults. */
export function blankPromo(type: PromoType = "percent"): Promo {
  return {
    id: null,
    name: "",
    type,
    description: "",
    code: "",
    buyQty: 1,
    buyProducts: [],
    getQty: 1,
    getProducts: [],
    getDiscountBps: 10000,
    products: [],
    discountBps: 1000,
    discountAmount: paise(10000),
    minOrder: null,
    maxDiscount: null,
    comboPrice: paise(29900),
    startDate: null,
    endDate: null,
    startTime: null,
    endTime: null,
    days: ALL_DAYS,
    customer: "everyone",
    stacking: "none",
    channels: { pos: false, web: false },
    usageLimit: null,
    perCustomer: null,
    usageCount: 0,
    status: "draft",
    liveSince: null,
  };
}

/** The design's `t` flags — which editor sections a type shows. */
export function typeFlags(type: PromoType) {
  return {
    isBuyGet: type === "bogo" || type === "bxgy",
    hasProducts: type === "combo" || type === "freeitem",
    isCombo: type === "combo",
    productsTitle: type === "combo" ? "PRODUCTS IN THIS COMBO" : "FREE PRODUCT",
    isPct: type === "percent" || type === "coupon" || type === "happyhour",
    isFlat: type === "flat",
    isCoupon: type === "coupon",
    isHappy: type === "happyhour",
    isFree: type === "freeitem",
    hasMinMax: type === "percent" || type === "coupon" || type === "happyhour" || type === "flat",
    showDiscount: !(type === "bogo" || type === "bxgy" || type === "combo"),
  } as const;
}

/* ------------------------------------------------------------------ */
/* summarize()                                                         */
/* ------------------------------------------------------------------ */

export interface PromoSummary {
  readonly headline: string;
  readonly lines: readonly string[];
  readonly short: string;
  /** Combo only: what the products list for, and what the combo saves. */
  readonly orig?: Paise;
  readonly saves?: Paise;
}

const money = (value: Paise | null | undefined): string => formatINR(value ?? ZERO, "whole");

function namesOf(slugs: readonly string[], products: readonly PromoProduct[]): string[] {
  return slugs.map((slug) => products.find((product) => product.slug === slug)?.name).filter((name): name is string => Boolean(name));
}

function list(names: readonly string[]): string {
  return names.length ? names.join(names.length > 2 ? ", " : " or ") : "—";
}

export function dayRange(days: Promo["days"]): string {
  const on = DAYS.filter((_, i) => days[i]);
  if (on.length === 7) return "Every day";
  if (on.length === 0) return "No days";
  const idx = DAYS.map((_, i) => i).filter((i) => days[i]);
  const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1]! + 1);
  return contiguous && on.length > 2 ? `${on[0]}–${on[on.length - 1]}` : on.join(" ");
}

const pctText = (bps: Bps | null): string => formatBps(bps ?? 0, 0);

export function summarize(p: Promo, products: readonly PromoProduct[]): PromoSummary {
  const minTxt = p.minOrder && p.minOrder > ZERO ? `min ${money(p.minOrder)}` : "";
  const maxTxt = p.maxDiscount && p.maxDiscount > ZERO ? `up to ${money(p.maxDiscount)}` : "";
  const cond = [minTxt, maxTxt].filter(Boolean).join(" · ");
  const getTxt = p.getDiscountBps >= 10000 ? "FREE" : `${pctText(p.getDiscountBps)} off`;

  switch (p.type) {
    case "percent":
      return { headline: `${pctText(p.discountBps)} OFF`, lines: [cond || "Any order"], short: `${pctText(p.discountBps)} off` };
    case "coupon":
      return {
        headline: `${pctText(p.discountBps)} OFF`,
        lines: [`Use code ${p.code || "—"}`, cond].filter(Boolean),
        short: `${pctText(p.discountBps)} off · ${p.code || "no code"}`,
      };
    case "flat":
      return { headline: `${money(p.discountAmount)} OFF`, lines: [cond || "Any order"], short: `${money(p.discountAmount)} off` };
    case "bogo":
    case "bxgy": {
      const b = list(namesOf(p.buyProducts, products));
      const g = list(namesOf(p.getProducts, products));
      return {
        headline: `Buy ${p.buyQty} ${b}`,
        lines: [`Get ${p.getQty} ${g} ${getTxt}`],
        short: `Buy ${p.buyQty} ${b} → Get ${p.getQty} ${g} ${getTxt}`,
      };
    }
    case "combo": {
      const names = namesOf(p.products, products);
      const orig = p.products.reduce<Paise>((sum, slug) => add(sum, products.find((product) => product.slug === slug)?.price ?? ZERO), ZERO);
      const price = p.comboPrice ?? ZERO;
      return {
        headline: names.join(" + ") || "No products",
        lines: [money(price), orig > ZERO ? `was ${money(orig)}` : ""].filter(Boolean),
        short: `${names.join(" + ") || "No products"} ${money(price)}`,
        orig,
        saves: (orig - price) as Paise,
      };
    }
    case "freeitem": {
      const names = list(namesOf(p.products, products));
      return { headline: `FREE ${names}`, lines: [`on orders over ${money(p.minOrder)}`], short: `Free ${names} over ${money(p.minOrder)}` };
    }
    case "happyhour":
      return {
        headline: `${pctText(p.discountBps)} OFF`,
        lines: [dayRange(p.days), `${p.startTime || "—"} → ${p.endTime || "—"}`],
        short: `${pctText(p.discountBps)} off · ${dayRange(p.days)} ${p.startTime || ""}–${p.endTime || ""}`,
      };
  }
}

/* ------------------------------------------------------------------ */
/* validate()                                                          */
/* ------------------------------------------------------------------ */

export const COUPON_CODE = /^[A-Z0-9]{3,20}$/;

/** Everything that must be true before a promotion may be pushed. Saving a draft never needs it. */
export function validate(p: Promo): readonly string[] {
  const errors: string[] = [];
  const pct = p.discountBps ?? 0;
  const amt = p.discountAmount ?? ZERO;
  const min = p.minOrder;

  if (!p.name.trim()) errors.push("Give the promotion a name.");
  if ((p.type === "bogo" || p.type === "bxgy") && (p.buyProducts.length === 0 || p.getProducts.length === 0)) errors.push("Select at least one product to buy and one to get.");
  if ((p.type === "combo" || p.type === "freeitem") && p.products.length === 0) errors.push("Select at least one product.");
  if (p.type === "combo" && p.products.length < 2) errors.push("A combo needs at least two products.");
  if ((p.type === "percent" || p.type === "coupon" || p.type === "happyhour") && !(pct > 0)) errors.push("Enter a discount.");
  if (p.type === "flat" && !(amt > ZERO)) errors.push("Enter a discount.");
  if (p.type === "combo" && !(p.comboPrice !== null && p.comboPrice > ZERO)) errors.push("Enter a combo price.");
  if (p.type === "coupon" && !p.code.trim()) errors.push("Enter a coupon code.");
  else if (p.type === "coupon" && !COUPON_CODE.test(p.code)) errors.push("A coupon code is 3–20 capital letters and digits.");
  if (p.type === "freeitem" && !(min !== null && min > ZERO)) errors.push("Minimum order must be greater than ₹0.");
  if (min !== null && min < ZERO) errors.push("Minimum order must be greater than ₹0.");
  if (!p.startDate || !p.endDate) errors.push("Add a start and end date.");
  else if (p.endDate < p.startDate) errors.push("End date must be after the start date.");
  if (p.type === "happyhour" && (!p.startTime || !p.endTime)) errors.push("Add a start and end time.");
  if (!p.days.some(Boolean)) errors.push("Pick at least one day.");
  if (pct > 10000) errors.push("A discount can't be more than 100%.");
  return errors;
}

/* ------------------------------------------------------------------ */
/* eligible()                                                          */
/* ------------------------------------------------------------------ */

export interface CartLine {
  readonly slug: string;
  readonly quantity: number;
  /** Per unit, as priced — base plus modifiers. */
  readonly unitPrice: Paise;
}

export type PromoChannel = "pos" | "web";

export interface EligibilityContext {
  readonly channel: PromoChannel;
  /** The customer's segment when known; null when nobody is attached. */
  readonly segment: CustomerSegment | null;
  /** How many times this customer has used this promotion already; null when nobody is attached. */
  readonly customerUses: number | null;
  readonly now: Date;
}

/** "Mon"→0 … "Sun"→6 and "HH:MM", both in Asia/Kolkata, for `now`. */
export function localDayAndTime(now: Date): { day: number; hm: string; date: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIMEZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = get("weekday").slice(0, 3) as (typeof DAYS)[number];
  const hour = get("hour") === "24" ? "00" : get("hour");
  return { day: Math.max(0, DAYS.indexOf(weekday)), hm: `${hour}:${get("minute")}`, date: `${get("year")}-${get("month")}-${get("day")}` };
}

export function cartSubtotal(cart: readonly CartLine[]): Paise {
  return cart.reduce<Paise>((sum, line) => add(sum, multiply(line.unitPrice, line.quantity)), ZERO);
}

/**
 * What a promotion would take off this cart, or null when it does not
 * apply. Mirrors the design's `eligible()` branch for branch, then the
 * shop's own rules: dates, usage limits, per-customer limits, the segment,
 * and never more than the cart is worth.
 */
export function eligible(p: Promo, cart: readonly CartLine[], products: readonly PromoProduct[], ctx: EligibilityContext): Paise | null {
  if (p.status !== "live") return null;
  if (!(ctx.channel === "pos" ? p.channels.pos : p.channels.web)) return null;

  const local = localDayAndTime(ctx.now);
  if (p.startDate && local.date < p.startDate) return null;
  if (p.endDate && local.date > p.endDate) return null;
  if (!p.days[local.day]) return null;
  if (p.startTime && p.endTime && (local.hm < p.startTime || local.hm > p.endTime)) return null;

  if (p.usageLimit !== null && p.usageCount >= p.usageLimit) return null;
  if (p.perCustomer !== null) {
    if (ctx.customerUses === null) return null; // nobody attached — cannot enforce a per-customer limit, so the offer waits.
    if (ctx.customerUses >= p.perCustomer) return null;
  }
  if (p.customer !== "everyone") {
    if (ctx.segment === null) return null;
    if (p.customer !== ctx.segment) return null;
  }

  const sub = cartSubtotal(cart);
  if (sub <= ZERO) return null;
  const min = p.minOrder ?? ZERO;
  const qtyOf = (slugs: readonly string[]) => cart.filter((line) => slugs.includes(line.slug)).reduce((sum, line) => sum + line.quantity, 0);
  const priceOf = (slug: string) => products.find((product) => product.slug === slug)?.price ?? ZERO;

  let saving: Paise | null = null;
  switch (p.type) {
    case "percent":
    case "coupon":
    case "happyhour": {
      if (sub < min) return null;
      const d = percentOf(sub, p.discountBps ?? 0);
      saving = p.maxDiscount && p.maxDiscount > ZERO && d > p.maxDiscount ? p.maxDiscount : d;
      break;
    }
    case "flat":
      if (sub < min) return null;
      saving = p.discountAmount ?? ZERO;
      break;
    case "bogo":
    case "bxgy": {
      const same = p.buyProducts.join() === p.getProducts.join();
      const ok = same ? qtyOf(p.buyProducts) >= p.buyQty + p.getQty : qtyOf(p.buyProducts) >= p.buyQty && qtyOf(p.getProducts) >= p.getQty;
      if (!ok) return null;
      const gets = cart.filter((line) => p.getProducts.includes(line.slug)).map((line) => line.unitPrice);
      if (gets.length === 0) return null;
      const cheapest = gets.reduce((low, price) => (price < low ? price : low));
      saving = percentOf(multiply(cheapest, p.getQty), p.getDiscountBps);
      break;
    }
    case "combo": {
      if (!p.products.every((slug) => cart.some((line) => line.slug === slug))) return null;
      const orig = p.products.reduce<Paise>((sum, slug) => add(sum, priceOf(slug)), ZERO);
      const diff = (orig - (p.comboPrice ?? ZERO)) as Paise;
      saving = diff > ZERO ? diff : ZERO;
      break;
    }
    case "freeitem": {
      const inCart = cart.find((line) => p.products.includes(line.slug));
      if (!(sub >= min && inCart)) return null;
      saving = inCart.unitPrice;
      break;
    }
  }

  if (saving === null) return null;
  // Never negative: a promotion can make an order free, never have the shop pay.
  if (saving > sub) saving = sub;
  return saving > ZERO ? saving : null;
}

/** Among the live promotions that apply, the biggest saving first — what the till auto-applies. */
export function rankEligible(promos: readonly Promo[], cart: readonly CartLine[], products: readonly PromoProduct[], ctx: EligibilityContext): readonly { promo: Promo; saving: Paise }[] {
  return promos
    .map((promo) => ({ promo, saving: eligible(promo, cart, products, ctx) }))
    .filter((entry): entry is { promo: Promo; saving: Paise } => entry.saving !== null)
    .sort((a, b) => (b.saving > a.saving ? 1 : b.saving < a.saving ? -1 : 0));
}

/** A coupon code the shop hands out: FRY + 4 characters. */
export function generateCode(random: () => number = Math.random): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "FRY";
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(random() * alphabet.length)];
  return code;
}
