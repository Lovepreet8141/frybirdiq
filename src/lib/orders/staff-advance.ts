import type { OrderStatus } from "@/domain/order-status";

/**
 * The statuses a staff member may ask `advanceOrderAction` to set.
 *
 * An allowlist, not a denylist: the action is guarded by `kitchen.update`,
 * which CASHIER and KITCHEN both hold, so anything not named here is refused
 * before the order is touched. It covers exactly the moves the orders board,
 * the order card and the KDS make (`nextStep` in
 * src/components/staff/order-card.tsx, `nextKitchenStatus` in
 * src/lib/kitchen/tickets.ts); staff-advance.test.ts fails if they drift.
 *
 * Deliberately absent:
 * - CANCELLED: turning an order down goes only through `rejectOrderAction`
 *   (`orders.cancel`, a structured reason). No screen asks this action for it,
 *   and a paid order is never cancelled at all (`advanceOrder` refuses it).
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
] as const satisfies readonly OrderStatus[];

export function staffMayAdvanceTo(to: OrderStatus): boolean {
  return (STAFF_ADVANCE_STATUSES as readonly OrderStatus[]).includes(to);
}
