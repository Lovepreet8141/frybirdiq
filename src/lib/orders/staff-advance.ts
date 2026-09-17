import type { OrderStatus } from "@/domain/order-status";

/**
 * The statuses a staff member may ask `advanceOrderAction` to set.
 *
 * An allowlist, not a denylist: the action is guarded by `kitchen.update`,
 * which CASHIER and KITCHEN both hold, so anything not named here is refused
 * before the order is touched. It covers every move the orders board, the
 * order card and the KDS make (`nextStep`, `nextKitchenStatus`), plus
 * CANCELLED, which the action gates behind `orders.cancel`.
 *
 * Deliberately absent:
 * - PAID: only a recorded payment sets it (`recordCashPayment`, settlement).
 * - REFUNDED: only `refundPayment` sets it, after money has moved. Marking an
 *   order refunded also reverses its loyalty stamp and points.
 * - DRAFT, PENDING_PAYMENT, FAILED: set at placement or by payment/delivery
 *   flows, never by a staff button.
 */
export const STAFF_ADVANCE_STATUSES = [
  "ACCEPTED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
  "COMPLETED",
  "CANCELLED",
] as const satisfies readonly OrderStatus[];

export function staffMayAdvanceTo(to: OrderStatus): boolean {
  return (STAFF_ADVANCE_STATUSES as readonly OrderStatus[]).includes(to);
}
