import "server-only";

/**
 * Rider assignment (roadmap 6.3): who carries a delivery, and a delivery that
 * could not be made.
 *
 * A delivery has at most one rider (`orders.rider_id`). A rider sees and closes
 * only their own deliveries: the listing filter is `listDeliveries`, and the
 * refusals for closing or failing someone else's delivery live in
 * `completeDelivery` and `failDelivery`, on the server, because hiding a button
 * is not authorization. Every query is scoped by org_id; every write is audited.
 */

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, memberships, orders, payments } from "@/db/schema";
import { isTerminal, type OrderStatus } from "@/domain/order-status";
import { type Role, seesOnlyOwnDeliveries } from "@/domain/permissions";
import { advanceOrder } from "./orders";

export interface AssignableRider {
  readonly userId: string;
  readonly displayName: string | null;
}

/** The org's active riders, for the assign control. */
export async function listAssignableRiders(orgId: string): Promise<readonly AssignableRider[]> {
  const rows = await db()
    .select({ userId: memberships.userId, displayName: memberships.displayName })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.role, "RIDER"), eq(memberships.isActive, true)))
    .orderBy(asc(memberships.displayName));
  const seen = new Set<string>();
  return rows.filter((row) => (seen.has(row.userId) ? false : (seen.add(row.userId), true)));
}

export type AssignRiderCode = "NOT_FOUND" | "NOT_A_DELIVERY" | "ORDER_CLOSED" | "NOT_A_RIDER";
export type AssignRiderResult = { readonly ok: true; readonly changed: boolean } | { readonly ok: false; readonly code: AssignRiderCode; readonly error: string };

/**
 * Assigns (or reassigns) a rider to a delivery. The caller has already checked
 * `delivery.assign`. The rider must be an ACTIVE RIDER of this org; the order is
 * read FOR UPDATE, org-scoped, and must be an open delivery. Assigning the rider
 * already on it changes nothing and writes nothing.
 */
export async function assignRider(input: { readonly orgId: string; readonly orderId: string; readonly riderUserId: string; readonly actorUserId: string }): Promise<AssignRiderResult> {
  return db().transaction(async (tx) => {
    const [order] = await tx
      .select({ id: orders.id, status: orders.status, fulfilment: orders.fulfilment, riderId: orders.riderId, locationId: orders.locationId })
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.orgId, input.orgId)))
      .for("update")
      .limit(1);
    if (!order) return { ok: false, code: "NOT_FOUND", error: "That order does not exist." } as const;
    if (order.fulfilment !== "DELIVERY") return { ok: false, code: "NOT_A_DELIVERY", error: "Only a delivery order has a rider." } as const;
    if (order.status === "DRAFT" || isTerminal(order.status as OrderStatus)) return { ok: false, code: "ORDER_CLOSED", error: "That delivery is already closed." } as const;

    const [rider] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.orgId, input.orgId), eq(memberships.userId, input.riderUserId), eq(memberships.role, "RIDER"), eq(memberships.isActive, true)))
      .limit(1);
    if (!rider) return { ok: false, code: "NOT_A_RIDER", error: "Pick one of your active riders." } as const;

    if (order.riderId === input.riderUserId) return { ok: true, changed: false } as const;

    await tx.update(orders).set({ riderId: input.riderUserId, riderAssignedAt: new Date(), updatedAt: new Date() }).where(and(eq(orders.id, order.id), eq(orders.orgId, input.orgId)));
    await tx.insert(auditLogs).values({
      orgId: input.orgId,
      locationId: order.locationId,
      actorUserId: input.actorUserId,
      action: "rider_assigned",
      entity: "orders",
      entityId: order.id,
      before: { riderId: order.riderId },
      after: { riderId: input.riderUserId },
    });
    return { ok: true, changed: true } as const;
  });
}

export const FAIL_REASON_MIN = 3;
export const FAIL_REASON_MAX = 200;

export type FailDeliveryCode = "NOT_FOUND" | "NOT_A_DELIVERY" | "NOT_OUT_FOR_DELIVERY" | "NOT_YOUR_DELIVERY" | "ALREADY_PAID" | "REASON_REQUIRED" | "TRANSITION_REFUSED";
export type FailDeliveryResult = { readonly ok: true } | { readonly ok: false; readonly code: FailDeliveryCode; readonly error: string };

/**
 * Records a delivery that could not be made: OUT_FOR_DELIVERY -> FAILED with the
 * reason on the order event and in the audit log. A rider may do it only for
 * their own delivery; the counter (orders.update) may do it for any.
 *
 * An order that has already taken money is refused: a paid order that failed
 * needs a refund, which is a manager's decision with its own trail, not a side
 * effect of a rider's tap. The food is already consumed from stock at ACCEPTED
 * and stays consumed (it was cooked): nothing to reverse here.
 */
export async function failDelivery(input: {
  readonly orgId: string;
  readonly orderId: string;
  readonly actorUserId: string;
  readonly actorRoles: readonly Role[];
  readonly reason: string;
}): Promise<FailDeliveryResult> {
  const reason = input.reason.trim();
  if (reason.length < FAIL_REASON_MIN || reason.length > FAIL_REASON_MAX) {
    return { ok: false, code: "REASON_REQUIRED", error: `Say why it could not be delivered (${FAIL_REASON_MIN}-${FAIL_REASON_MAX} characters).` };
  }

  const [order] = await db()
    .select({ id: orders.id, status: orders.status, fulfilment: orders.fulfilment, riderId: orders.riderId, locationId: orders.locationId })
    .from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.orgId, input.orgId)))
    .limit(1);
  if (!order) return { ok: false, code: "NOT_FOUND", error: "That delivery does not exist." };
  if (order.fulfilment !== "DELIVERY") return { ok: false, code: "NOT_A_DELIVERY", error: "That order is not a delivery." };
  if (seesOnlyOwnDeliveries(input.actorRoles) && order.riderId !== input.actorUserId) {
    return { ok: false, code: "NOT_YOUR_DELIVERY", error: "That delivery is assigned to someone else." };
  }
  if (order.status !== "OUT_FOR_DELIVERY") return { ok: false, code: "NOT_OUT_FOR_DELIVERY", error: "That order is not out for delivery." };

  const [captured] = await db()
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.orderId, order.id), eq(payments.orgId, input.orgId), eq(payments.status, "CAPTURED")))
    .limit(1);
  if (captured) return { ok: false, code: "ALREADY_PAID", error: "This order is already paid. Ask a manager to refund it." };

  const moved = await advanceOrder({ orderId: order.id, to: "FAILED", actorUserId: input.actorUserId, orgId: input.orgId, reason });
  if (!moved.ok) return { ok: false, code: "TRANSITION_REFUSED", error: moved.error };

  await db().insert(auditLogs).values({
    orgId: input.orgId,
    locationId: order.locationId,
    actorUserId: input.actorUserId,
    action: "delivery_failed",
    entity: "orders",
    entityId: order.id,
    before: { status: "OUT_FOR_DELIVERY", riderId: order.riderId },
    after: { status: "FAILED", reason },
  });
  return { ok: true };
}
