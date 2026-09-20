/**
 * What the order page tells a customer whose online order is waiting on its
 * payment and cannot be paid right now (p3-order-copy).
 *
 * The truth it has to respect: an order waiting on a Razorpay payment does NOT
 * reach the kitchen until the money is recorded (pay-ready Q3,
 * `awaitsOnlinePayment`). "The shop can take payment when you collect" used to
 * be printed here, and it promised something the kitchen would not act on: the
 * food would not be started. Staff can record cash at the counter against the
 * order, which releases it, so paying at the counter is offered only while the
 * shop takes cash (`organizations.cash_enabled`). Pure: the words only.
 */

export interface PendingPaymentInput {
  /** Whether the shop takes cash at all (the owner's own switch). */
  readonly cashEnabled: boolean;
  readonly isDelivery: boolean;
}

export function pendingPaymentNotice({ cashEnabled, isDelivery }: PendingPaymentInput): string {
  const base = "Online payment isn't available right now, and the kitchen starts your order only once it is paid.";
  if (!cashEnabled) return `${base} Please call the shop.`;
  return isDelivery
    ? `${base} Please call the shop; they can take payment and start it.`
    : `${base} Call the shop, or pay at the counter and they will start it.`;
}
