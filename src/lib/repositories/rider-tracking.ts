import "server-only";

import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { locations, orders, riderPositions } from "@/db/schema";
import { fromMicro } from "@/lib/delivery";
import { POSITION_MIN_GAP_MS, type ParsedPosition, parsePosition, retentionCutoff, trackerState, type TrackerState } from "@/lib/delivery/tracking";

/**
 * Rider live position (Lane B). The rider's browser posts a fix while a delivery is out; the customer's tracking page reads
 * the newest one. Every function scopes by org itself (the app connects as `postgres` and bypasses RLS).
 *
 * Who may write: the rider who holds the delivery, while it is OUT_FOR_DELIVERY, checked here on every post.
 * Who may read: the caller decides that the viewer owns the order (`viewerOwnsOrder`); this only ever returns the newest fix
 * of one order, and nothing once the order is no longer out for delivery.
 */

export type RecordPositionResult =
  | { readonly ok: true; readonly stored: boolean }
  | { readonly ok: false; readonly code: "BAD_POSITION" | "NOT_FOUND" | "NOT_YOUR_DELIVERY" | "NOT_OUT_FOR_DELIVERY"; readonly error: string };

export async function recordRiderPosition(input: {
  readonly orgId: string;
  readonly orderId: string;
  readonly riderUserId: string;
  readonly position: unknown;
  readonly now?: Date;
}): Promise<RecordPositionResult> {
  const parsed: ParsedPosition = parsePosition(input.position);
  if (!parsed.ok) return { ok: false, code: "BAD_POSITION", error: parsed.error };
  const now = input.now ?? new Date();

  return db().transaction(async (tx) => {
    // Lock the order row so a reassignment or a status change cannot slip between the check and the write.
    const [order] = await tx
      .select({ id: orders.id, status: orders.status, fulfilment: orders.fulfilment, riderId: orders.riderId })
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.orgId, input.orgId)))
      .for("share")
      .limit(1);
    if (!order || order.fulfilment !== "DELIVERY") return { ok: false, code: "NOT_FOUND", error: "That delivery does not exist." } as const;
    if (order.riderId !== input.riderUserId) return { ok: false, code: "NOT_YOUR_DELIVERY", error: "That delivery is assigned to someone else." } as const;
    if (order.status !== "OUT_FOR_DELIVERY") return { ok: false, code: "NOT_OUT_FOR_DELIVERY", error: "Location is shared only while the delivery is out." } as const;

    // A retry or a second tab: keep the newest fix, drop the near-duplicate. Not an error.
    const [latest] = await tx
      .select({ recordedAt: riderPositions.recordedAt })
      .from(riderPositions)
      .where(and(eq(riderPositions.orderId, order.id), eq(riderPositions.orgId, input.orgId)))
      .orderBy(desc(riderPositions.recordedAt))
      .limit(1);
    if (latest && now.getTime() - latest.recordedAt.getTime() < POSITION_MIN_GAP_MS) return { ok: true, stored: false } as const;

    await tx.insert(riderPositions).values({
      orgId: input.orgId,
      orderId: order.id,
      riderUserId: input.riderUserId,
      latMicro: parsed.latMicro,
      lngMicro: parsed.lngMicro,
      accuracyMetres: parsed.accuracyMetres,
      recordedAt: now,
    });
    return { ok: true, stored: true } as const;
  });
}

export interface RiderTrackingView {
  readonly state: TrackerState;
  /** The newest fix, present only when the state is `live` or `stale`. */
  readonly rider: { readonly lat: number; readonly lng: number; readonly recordedAt: Date } | null;
  /** The customer's own delivery pin and the shop, for the map. Null when not known. */
  readonly destination: { readonly lat: number; readonly lng: number } | null;
  readonly shop: { readonly lat: number; readonly lng: number } | null;
}

const HIDDEN: RiderTrackingView = { state: { kind: "hidden" }, rider: null, destination: null, shop: null };

/**
 * What the customer's page may show about the rider. The caller has already decided the viewer owns this order.
 * Only while the order is a delivery that is OUT_FOR_DELIVERY; before and after, nothing about the rider leaves the server.
 */
export async function getRiderTrackingView(input: { readonly orgId: string; readonly orderId: string; readonly now?: Date }): Promise<RiderTrackingView> {
  const now = input.now ?? new Date();
  const [order] = await db()
    .select({
      status: orders.status,
      fulfilment: orders.fulfilment,
      locationId: orders.locationId,
      destLat: orders.deliveryLatMicro,
      destLng: orders.deliveryLngMicro,
    })
    .from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.orgId, input.orgId)))
    .limit(1);
  if (!order || order.fulfilment !== "DELIVERY" || order.status !== "OUT_FOR_DELIVERY") return HIDDEN;

  const [latest] = await db()
    .select({ latMicro: riderPositions.latMicro, lngMicro: riderPositions.lngMicro, recordedAt: riderPositions.recordedAt })
    .from(riderPositions)
    .where(and(eq(riderPositions.orderId, input.orderId), eq(riderPositions.orgId, input.orgId)))
    .orderBy(desc(riderPositions.recordedAt))
    .limit(1);

  const [shop] = order.locationId
    ? await db().select({ latMicro: locations.latMicro, lngMicro: locations.lngMicro }).from(locations).where(and(eq(locations.id, order.locationId), eq(locations.orgId, input.orgId))).limit(1)
    : [];

  const state = trackerState({ outForDelivery: true, latest: latest ?? null, now });
  return {
    state,
    rider: latest ? { lat: fromMicro(latest.latMicro), lng: fromMicro(latest.lngMicro), recordedAt: latest.recordedAt } : null,
    destination: order.destLat !== null && order.destLng !== null ? { lat: fromMicro(order.destLat), lng: fromMicro(order.destLng) } : null,
    shop: shop && shop.latMicro !== null && shop.lngMicro !== null ? { lat: fromMicro(shop.latMicro), lng: fromMicro(shop.lngMicro) } : null,
  };
}

/** Deletes this org's fixes older than 24 hours. Bounded so one run never holds a long lock; returns how many went. Safe to repeat. */
export const PURGE_BATCH = 5000;

export async function purgeRiderPositions(orgId: string, now: Date = new Date(), limit = PURGE_BATCH): Promise<number> {
  const cutoff = retentionCutoff(now);
  const gone = await db().execute<{ id: string }>(sql`
    DELETE FROM ${riderPositions}
    WHERE ${riderPositions.id} IN (
      SELECT ${riderPositions.id} FROM ${riderPositions}
      WHERE ${riderPositions.orgId} = ${orgId} AND ${lt(riderPositions.recordedAt, cutoff)}
      LIMIT ${limit}
    )
    RETURNING id`);
  return gone.length;
}
