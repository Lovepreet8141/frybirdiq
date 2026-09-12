import "server-only";

/**
 * The order activity feed — read straight from `order_events`, the
 * append-only history every status change already writes (§18). This is
 * not a second event system: nothing here writes, and the rows are the
 * same ones realtime and "who cancelled this" already rely on.
 *
 * Deliberately carries no customer name or phone — an activity feed is
 * about what staff did, and the order number is enough to find the rest on
 * the Orders screen. `metadata` is not surfaced: nothing writes it today.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { memberships, orderEvents, orders } from "@/db/schema";
import type { FulfilmentType, OrderStatus } from "@/domain/order-status";

export interface OrderActivity {
  readonly id: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly fulfilment: FulfilmentType;
  readonly from: OrderStatus | null;
  readonly to: OrderStatus;
  /** Display name; null means the system moved it (a webhook, a timeout). */
  readonly actorName: string | null;
  readonly reason: string | null;
  readonly at: Date;
}

export async function listRecentOrderEvents(orgId: string, limit = 150): Promise<readonly OrderActivity[]> {
  const database = db();
  const rows = await database
    .select({
      id: orderEvents.id,
      orderId: orderEvents.orderId,
      orderNumber: orders.orderNumber,
      fulfilment: orders.fulfilment,
      from: orderEvents.fromStatus,
      to: orderEvents.toStatus,
      actorUserId: orderEvents.actorUserId,
      reason: orderEvents.reason,
      at: orderEvents.createdAt,
    })
    .from(orderEvents)
    .innerJoin(orders, eq(orders.id, orderEvents.orderId))
    .where(and(eq(orderEvents.orgId, orgId), eq(orders.orgId, orgId)))
    .orderBy(desc(orderEvents.createdAt))
    .limit(limit);

  const actorIds = [...new Set(rows.map((row) => row.actorUserId).filter((id): id is string => id !== null))];
  const staffRows =
    actorIds.length > 0
      ? await database
          .select({ userId: memberships.userId, displayName: memberships.displayName })
          .from(memberships)
          .where(and(eq(memberships.orgId, orgId), inArray(memberships.userId, actorIds)))
      : [];
  const nameByUser = new Map(staffRows.map((row) => [row.userId, row.displayName]));

  return rows.map((row) => ({
    id: row.id,
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    fulfilment: row.fulfilment,
    from: row.from,
    to: row.to,
    actorName: row.actorUserId ? (nameByUser.get(row.actorUserId) ?? "Former staff member") : null,
    reason: row.reason,
    at: row.at,
  }));
}
