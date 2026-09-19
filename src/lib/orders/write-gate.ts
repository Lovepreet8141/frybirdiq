/**
 * The ordering gate as it must be applied AT THE MOMENT OF WRITING an order.
 *
 * `placeOrder` checks the shop once at the top, on the request's first read of
 * the organization. Between that and the insert come the delivery quote, the
 * pricing, the customer and promo writes, so a pause pressed (or a closing time
 * reached) in that gap used to let one order through. The write path now asks
 * this again, on a fresh read of the organization taken under a row lock in the
 * same transaction as the order insert.
 *
 * Pure: the decision from a shop status, a clock and what the customer chose.
 * It is the same rule as the top-of-request gate (`orderingRefusal`) plus, for a
 * scheduled order, whether the chosen time is still inside the hours and the
 * lead window on the fresh clock and the fresh hours.
 */

import { isValidScheduledTime } from "@/lib/cart/scheduled-time";
import { type OrderingRefusal, type ShopStatus, orderingRefusal } from "./opening-hours";

export type WriteRefusal = OrderingRefusal | { readonly kind: "SCHEDULE_SLIPPED" };

export function writeGate(input: {
  readonly now: Date;
  readonly shop: ShopStatus;
  readonly when: "ASAP" | "SCHEDULED";
  readonly scheduledFor: Date | null;
}): WriteRefusal | null {
  const refusal = orderingRefusal(input.now, input.shop, input.when);
  if (refusal) return refusal;
  if (input.when === "SCHEDULED") {
    const stillValid = input.scheduledFor !== null && isValidScheduledTime(input.scheduledFor, input.now, input.shop.openingTime, input.shop.closingTime, input.shop.closures);
    if (!stillValid) return { kind: "SCHEDULE_SLIPPED" };
  }
  return null;
}

/**
 * Thrown from inside the order's own transaction when the promo code's last slot went to someone else between
 * pricing and the write. Thrown (not returned) so the transaction rolls back and the idempotency claim is released.
 */
export class PromoLimitReached extends Error {
  constructor() {
    super("promo usage limit reached at write");
    this.name = "PromoLimitReached";
  }
}

/** Thrown from inside the write so `withIdempotency` releases its claim (a refusal must never be stored as the key's result). */
export class OrderingRefusedAtWrite extends Error {
  /** `at` and `shop` are the clock and the fresh read the decision was made on, so the customer's message is worded from the same facts. */
  constructor(
    readonly refusal: WriteRefusal,
    readonly at: Date,
    readonly shop: ShopStatus,
  ) {
    super(`ordering refused at write: ${refusal.kind}`);
    this.name = "OrderingRefusedAtWrite";
  }
}
