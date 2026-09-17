/**
 * Where an order's money stands, read from its payment rows' statuses.
 *
 * Paid means a payment was ever captured: CAPTURED, PARTIALLY_REFUNDED or
 * REFUNDED, the same "ever captured" rule the IQ facts use. A refund moves a
 * payment's status on from CAPTURED, but the customer did pay, so a refunded
 * order is never "not paid". Refund state comes from the payment status,
 * which `refundPayment` sets under the payment lock only once money has gone
 * back.
 */

export type PaymentRowStatus = "PENDING" | "AUTHORIZED" | "CAPTURED" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";

export const EVER_CAPTURED_STATUSES = ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"] as const satisfies readonly PaymentRowStatus[];

/**
 * - `UNPAID`: no payment was ever captured.
 * - `PAID`: captured, nothing refunded.
 * - `PARTIALLY_REFUNDED`: some money went back and some was kept, whether one
 *   payment was partly refunded or one of several payments was refunded in full.
 * - `REFUNDED`: every captured payment was refunded in full.
 */
export type OrderPaymentState = "UNPAID" | "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED";

export function orderPaymentState(statuses: readonly PaymentRowStatus[]): OrderPaymentState {
  const captured = statuses.filter((status) => (EVER_CAPTURED_STATUSES as readonly PaymentRowStatus[]).includes(status));
  if (captured.length === 0) return "UNPAID";
  if (captured.every((status) => status === "REFUNDED")) return "REFUNDED";
  if (captured.some((status) => status !== "CAPTURED")) return "PARTIALLY_REFUNDED";
  return "PAID";
}
