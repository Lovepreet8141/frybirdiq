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

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, memberships, orders, organizations, payments } from "@/db/schema";
import { isTerminal, type OrderStatus } from "@/domain/order-status";
import { type Role, seesOnlyOwnDeliveries } from "@/domain/permissions";
import { MAX_ACTIVE_DELIVERIES, MAX_TAKES_PER_HOUR, type RiderLimits } from "@/lib/delivery/hold";
import { toOffer, type DeliveryOffer } from "@/lib/delivery/offer";
import { advanceOrder, listActiveOrders, type StaffOrderView } from "./orders";

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
 * effect of a rider's tap. The read here is only for a friendly message; the
 * guard that cannot be raced is inside `advanceOrder`, under the order's lock. The food is already consumed from stock at ACCEPTED
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
    .where(and(eq(payments.orderId, order.id), eq(payments.orgId, input.orgId), inArray(payments.status, ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"])))
    .limit(1);
  if (captured) return { ok: false, code: "ALREADY_PAID", error: "This order is already paid. Ask a manager to refund it." };

  // A rider fails only their own delivery, re-checked under the order's lock: a reassignment landing after the read above must not let the old rider fail it.
  const moved = await advanceOrder({ orderId: order.id, to: "FAILED", actorUserId: input.actorUserId, orgId: input.orgId, reason, ...(seesOnlyOwnDeliveries(input.actorRoles) ? { onlyIfRiderUserId: input.actorUserId } : {}) });
  if (!moved.ok) {
    if (seesOnlyOwnDeliveries(input.actorRoles)) {
      const [now] = await db().select({ riderId: orders.riderId }).from(orders).where(and(eq(orders.id, order.id), eq(orders.orgId, input.orgId))).limit(1);
      if (now && now.riderId !== input.actorUserId) return { ok: false, code: "NOT_YOUR_DELIVERY", error: "That delivery is assigned to someone else." };
    }
    return { ok: false, code: "TRANSITION_REFUSED", error: moved.error };
  }

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


/** The statuses a delivery is on a rider's list in: ready to go, or already on the road. */
const OFFERED_STATUSES = ["READY", "OUT_FOR_DELIVERY"] as const;

type Reader = Pick<ReturnType<typeof db>, "select">;

/**
 * The rider limits in force for this org (`organizations.rider_max_active`, `rider_max_takes_per_hour`, editable in Admin,
 * bounded by CHECKs). If the org row cannot be read, the accepted defaults apply: never "no limit".
 */
export async function getRiderLimits(orgId: string, reader: Reader = db()): Promise<RiderLimits> {
  const [row] = await reader.select({ maxActive: organizations.riderMaxActive, maxTakesPerHour: organizations.riderMaxTakesPerHour }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  return row ?? { maxActive: MAX_ACTIVE_DELIVERIES, maxTakesPerHour: MAX_TAKES_PER_HOUR };
}

export type TakeDeliveryCode = "NOT_FOUND" | "NOT_A_DELIVERY" | "NOT_A_RIDER" | "NOT_AVAILABLE" | "ALREADY_TAKEN" | "AT_LIMIT" | "TOO_MANY_TAKES";
export type TakeDeliveryResult = { readonly ok: true; readonly changed: boolean } | { readonly ok: false; readonly code: TakeDeliveryCode; readonly error: string };

/**
 * A rider takes an unassigned delivery ("Take it"). ONE conditional UPDATE decides it: the row is
 * claimed only where nobody holds it yet, so however many riders tap at once exactly one wins and the
 * others are told it is taken. The rider comes from the session, never the form, and must be an active
 * RIDER of this org. Taking a delivery that is already yours is a no-op, not an error.
 */
export async function takeDelivery(input: { readonly orgId: string; readonly orderId: string; readonly riderUserId: string }): Promise<TakeDeliveryResult> {
  return db().transaction(async (tx) => {
    const [rider] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.orgId, input.orgId), eq(memberships.userId, input.riderUserId), eq(memberships.role, "RIDER"), eq(memberships.isActive, true)))
      .limit(1);
    if (!rider) return { ok: false, code: "NOT_A_RIDER", error: "Only an active rider can take a delivery." } as const;

    // One rider's takes are serialized, so a burst of taps cannot beat the limit (the count and the claim below are then
    // one atomic step for this rider). Other riders are not affected.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`take:${input.orgId}:${input.riderUserId}`}))`);
    const limits = await getRiderLimits(input.orgId, tx);
    const [held] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.orgId, input.orgId), eq(orders.riderId, input.riderUserId), inArray(orders.status, [...OFFERED_STATUSES])));
    const atLimit = (held?.n ?? 0) >= limits.maxActive;
    // Taking reveals the customer's details, so takes are bounded per rolling hour whatever is released (audit rows are the count).
    const [recent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(and(eq(auditLogs.orgId, input.orgId), eq(auditLogs.actorUserId, input.riderUserId), eq(auditLogs.action, "rider_took_delivery"), sql`${auditLogs.createdAt} > now() - interval '1 hour'`));
    const tooManyTakes = (recent?.n ?? 0) >= limits.maxTakesPerHour;

    const claimed = atLimit || tooManyTakes ? [] : await tx
      .update(orders)
      .set({ riderId: input.riderUserId, riderAssignedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(orders.id, input.orderId),
          eq(orders.orgId, input.orgId),
          eq(orders.fulfilment, "DELIVERY"),
          inArray(orders.status, [...OFFERED_STATUSES]),
          isNull(orders.riderId),
        ),
      )
      .returning({ id: orders.id, locationId: orders.locationId });

    const [won] = claimed;
    if (won) {
      await tx.insert(auditLogs).values({
        orgId: input.orgId,
        locationId: won.locationId,
        actorUserId: input.riderUserId,
        action: "rider_took_delivery",
        entity: "orders",
        entityId: won.id,
        before: { riderId: null },
        after: { riderId: input.riderUserId },
      });
      return { ok: true, changed: true } as const;
    }

    // Not claimed: say why, from what is there now.
    const [order] = await tx
      .select({ status: orders.status, fulfilment: orders.fulfilment, riderId: orders.riderId })
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.orgId, input.orgId)))
      .limit(1);
    if (!order) return { ok: false, code: "NOT_FOUND", error: "That delivery does not exist." } as const;
    if (order.fulfilment !== "DELIVERY") return { ok: false, code: "NOT_A_DELIVERY", error: "That order is not a delivery." } as const;
    if (order.riderId === input.riderUserId) return { ok: true, changed: false } as const;
    if (order.riderId !== null) return { ok: false, code: "ALREADY_TAKEN", error: "Someone else has just taken that delivery." } as const;
    if (tooManyTakes && (OFFERED_STATUSES as readonly string[]).includes(order.status)) {
      return { ok: false, code: "TOO_MANY_TAKES", error: "You have taken several deliveries in the last hour. Ask the shop to assign this one." } as const;
    }
    if (atLimit && (OFFERED_STATUSES as readonly string[]).includes(order.status)) {
      return { ok: false, code: "AT_LIMIT", error: `You already hold ${limits.maxActive} ${limits.maxActive === 1 ? "delivery" : "deliveries"}. Finish or release one first.` } as const;
    }
    return { ok: false, code: "NOT_AVAILABLE", error: "That delivery is not ready to be taken." } as const;
  });
}

export type ReleaseDeliveryCode = "NOT_FOUND" | "NOT_YOUR_DELIVERY" | "NOT_RELEASABLE";
export type ReleaseDeliveryResult = { readonly ok: true } | { readonly ok: false; readonly code: ReleaseDeliveryCode; readonly error: string };

/**
 * A rider gives a delivery they hold back to Available (owner decision, 2026-09-21). One conditional UPDATE: it only
 * releases a delivery THIS rider holds that is still READY (not yet on the road: once it is out, the rider uses "Couldn't deliver",
 * which needs a reason, or the manager reassigns). Audited. Releasing again, or someone
 * else's delivery, changes nothing.
 */
export async function releaseDelivery(input: { readonly orgId: string; readonly orderId: string; readonly riderUserId: string }): Promise<ReleaseDeliveryResult> {
  return db().transaction(async (tx) => {
    const released = await tx
      .update(orders)
      .set({ riderId: null, riderAssignedAt: null, updatedAt: new Date() })
      .where(and(eq(orders.id, input.orderId), eq(orders.orgId, input.orgId), eq(orders.riderId, input.riderUserId), eq(orders.status, "READY")))
      .returning({ id: orders.id, locationId: orders.locationId });
    const [gone] = released;
    if (gone) {
      await tx.insert(auditLogs).values({
        orgId: input.orgId,
        locationId: gone.locationId,
        actorUserId: input.riderUserId,
        action: "rider_released_delivery",
        entity: "orders",
        entityId: gone.id,
        before: { riderId: input.riderUserId },
        after: { riderId: null },
      });
      return { ok: true } as const;
    }
    const [order] = await tx.select({ status: orders.status, riderId: orders.riderId }).from(orders).where(and(eq(orders.id, input.orderId), eq(orders.orgId, input.orgId))).limit(1);
    if (!order) return { ok: false, code: "NOT_FOUND", error: "That delivery does not exist." } as const;
    if (order.riderId !== input.riderUserId) return { ok: false, code: "NOT_YOUR_DELIVERY", error: "That delivery is not yours." } as const;
    return { ok: false, code: "NOT_RELEASABLE", error: order.status === "OUT_FOR_DELIVERY" ? "It is already on the road. Use Couldn’t deliver, or ask the shop to reassign it." : "That delivery can no longer be released." } as const;
  });
}

export interface RiderDeliveries {
  /** The rider already holds the most active deliveries they may: "Take it" is refused until one is finished or released. */
  readonly atLimit: boolean;
  /** Deliveries assigned to this rider, with every detail needed to deliver them. */
  readonly mine: readonly StaffOrderView[];
  /** Unassigned deliveries any active rider may take: pickup-level facts only. */
  readonly offers: readonly DeliveryOffer[];
}

/** What a rider's Deliveries screen shows: their own deliveries in full, and the available ones as offers. */
export async function listRiderDeliveries(orgId: string, riderUserId: string): Promise<RiderDeliveries> {
  const active = (await listActiveOrders(orgId)).filter((order) => order.fulfilment === "DELIVERY" && (OFFERED_STATUSES as readonly string[]).includes(order.status));
  const mine = active.filter((order) => order.riderUserId === riderUserId);
  const limits = await getRiderLimits(orgId);
  return {
    atLimit: mine.length >= limits.maxActive,
    mine,
    offers: active.filter((order) => order.riderUserId === null).map(toOffer),
  };
}
