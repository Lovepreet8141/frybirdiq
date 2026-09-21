import type { OrderStatus } from "@/domain/order-status";

/** A rider may hold at most this many active deliveries (READY or on the road) at once (owner decision, 2026-09-21). */
export const MAX_ACTIVE_DELIVERIES = 2;

/** A delivery a rider holds that has not moved for this long is flagged to the manager (flag only, never an automatic reassignment). */
export const STALE_HOLD_MINUTES = 15;

/** Whole minutes since `since`, never negative. */
export const heldMinutes = (since: Date, now: Date): number => Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60_000));

/**
 * A delivery is "stale" when a rider holds it, it is still open (ready or on the road), and it has not changed for
 * STALE_HOLD_MINUTES. `lastMovedAt` is the order's last update: taking, releasing and every status change all move it.
 */
export function isStaleHold(order: { readonly riderUserId: string | null; readonly status: OrderStatus; readonly lastMovedAt: Date }, now: Date): boolean {
  if (order.riderUserId === null) return false;
  if (order.status !== "READY" && order.status !== "OUT_FOR_DELIVERY") return false;
  return heldMinutes(order.lastMovedAt, now) >= STALE_HOLD_MINUTES;
}
