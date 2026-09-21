import type { OrderStatus } from "@/domain/order-status";

/**
 * DEFAULT: a rider may hold at most this many active deliveries (READY or on the road) at once (owner decision, 2026-09-21).
 * The value in force is `organizations.rider_max_active` (editable in Admin, bounded by `RIDER_LIMIT_BOUNDS`); this is what a new org starts with.
 */
export const MAX_ACTIVE_DELIVERIES = 2;

/**
 * A rider may take at most this many deliveries in any rolling hour, however many they release. Taking reveals a customer's
 * name, phone and address, so without a bound "take, read, release, repeat" would let one login read every customer's details
 * (found in the red-team review). A bound on abuse, not an owner figure: raise it if real shifts hit it. A manager can still assign.
 * The count is read from `audit_logs` (action `rider_took_delivery`): never prune or archive audit rows younger than an hour.
 */
export const MAX_TAKES_PER_HOUR = 6;

/**
 * What an owner may set in Admin. The upper bounds keep the take cap meaningful (it stops "take, read, release, repeat"
 * from reading every customer's details), the lower bound of 1 keeps riders able to work at all. The database CHECKs
 * (migration 0054) say the same, so a hand edit cannot go outside them either.
 */
export const RIDER_LIMIT_BOUNDS = { activeMin: 1, activeMax: 5, takesMin: 1, takesMax: 20 } as const;

export interface RiderLimits {
  readonly maxActive: number;
  readonly maxTakesPerHour: number;
}

/** Validates a pair of limits against the bounds; whole numbers only. Returns the first problem in plain words, or null. */
export function riderLimitsError(limits: RiderLimits): string | null {
  const b = RIDER_LIMIT_BOUNDS;
  if (!Number.isInteger(limits.maxActive) || limits.maxActive < b.activeMin || limits.maxActive > b.activeMax) return `Active deliveries per rider must be a whole number from ${b.activeMin} to ${b.activeMax}.`;
  if (!Number.isInteger(limits.maxTakesPerHour) || limits.maxTakesPerHour < b.takesMin || limits.maxTakesPerHour > b.takesMax) return `Takes per hour must be a whole number from ${b.takesMin} to ${b.takesMax}.`;
  return null;
}

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
