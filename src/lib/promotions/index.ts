/**
 * Promotion codes.
 *
 * A discount is money coming off a bill, so it obeys the money rules: exact
 * integer paise, computed by a pure function, never assembled in a component.
 *
 * Every refusal has its own reason. "Invalid code" for an expired code, a code
 * that needs a bigger basket, and a typo are three different problems, and a
 * customer who is told the same thing for all three retypes the same code.
 */

import { type Bps, type Paise, ZERO, formatINR, percentOf, subtract } from "@/lib/money";

export interface Promotion {
  readonly code: string;
  readonly name: string;
  /** Percentage off, in basis points. Exactly one of these two is set. */
  readonly discountBps: Bps | null;
  readonly discountAmount: Paise | null;
  readonly minOrderAmount: Paise | null;
  /** Ceiling on a percentage discount. */
  readonly maxDiscountAmount: Paise | null;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly usageLimit: number | null;
  readonly usageCount: number;
  readonly isActive: boolean;
}

export type PromotionRefusal =
  | "unknown"
  | "inactive"
  | "not-started"
  | "expired"
  | "used-up"
  | "below-minimum"
  | "nothing-to-discount";

export type PromotionResult =
  | { readonly ok: true; readonly discount: Paise; readonly code: string; readonly name: string }
  | { readonly ok: false; readonly reason: PromotionRefusal; readonly message: string };

/** Refusals a customer sees. Specific, so they know what to do next. */
export function refusalMessage(reason: PromotionRefusal, minimum?: string): string {
  switch (reason) {
    case "unknown":
      return "We don't recognise that code.";
    case "inactive":
      return "That code isn't active.";
    case "not-started":
      return "That code isn't live yet.";
    case "expired":
      return "That code has expired.";
    case "used-up":
      return "That code has been fully used.";
    case "below-minimum":
      return minimum ? `That code needs an order of at least ${minimum}.` : "Your order is too small for that code.";
    case "nothing-to-discount":
      return "There's nothing to discount.";
  }
}

/**
 * Works out what a code takes off.
 *
 * The discount applies to the food, not to a delivery fee — a promotion is the
 * shop giving away margin on what it sells, not paying a rider's petrol on the
 * customer's behalf.
 *
 * Capped at the order value. A code can make an order free but must never make
 * it negative, which would have the shop paying the customer to eat.
 */
export function applyPromotion({
  promotion,
  orderValue,
  now = new Date(),
}: {
  promotion: Promotion | null;
  orderValue: Paise;
  now?: Date;
}): PromotionResult {
  if (!promotion) return { ok: false, reason: "unknown", message: refusalMessage("unknown") };
  if (!promotion.isActive) return { ok: false, reason: "inactive", message: refusalMessage("inactive") };

  if (promotion.startsAt && now < promotion.startsAt) {
    return { ok: false, reason: "not-started", message: refusalMessage("not-started") };
  }
  if (promotion.endsAt && now >= promotion.endsAt) {
    return { ok: false, reason: "expired", message: refusalMessage("expired") };
  }
  if (promotion.usageLimit !== null && promotion.usageCount >= promotion.usageLimit) {
    return { ok: false, reason: "used-up", message: refusalMessage("used-up") };
  }
  if (orderValue <= ZERO) {
    return { ok: false, reason: "nothing-to-discount", message: refusalMessage("nothing-to-discount") };
  }
  if (promotion.minOrderAmount !== null && orderValue < promotion.minOrderAmount) {
    // The minimum is named. "Your order is too small" leaves the customer
    // guessing how much more to add, which is the same dead end as telling
    // them the code is simply invalid.
    return {
      ok: false,
      reason: "below-minimum",
      message: refusalMessage("below-minimum", formatINR(promotion.minOrderAmount)),
    };
  }

  let discount =
    promotion.discountBps !== null ? percentOf(orderValue, promotion.discountBps) : (promotion.discountAmount ?? ZERO);

  // A percentage cap, where one is set.
  if (promotion.maxDiscountAmount !== null && discount > promotion.maxDiscountAmount) {
    discount = promotion.maxDiscountAmount;
  }

  // Never more than the order is worth.
  if (discount > orderValue) discount = orderValue;

  if (discount <= ZERO) {
    return { ok: false, reason: "nothing-to-discount", message: refusalMessage("nothing-to-discount") };
  }

  return { ok: true, discount, code: promotion.code, name: promotion.name };
}

/** What is left after a discount. */
export function afterDiscount(orderValue: Paise, result: PromotionResult): Paise {
  return result.ok ? subtract(orderValue, result.discount) : orderValue;
}

/** Codes are compared upper-case and trimmed, so "  frybird10 " works. */
export function normaliseCode(input: string): string {
  return input.trim().toUpperCase().slice(0, 40);
}
