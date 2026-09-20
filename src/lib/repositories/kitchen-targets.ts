import "server-only";

/**
 * Prep targets for the kitchen board (roadmap 4.1).
 *
 * The target for a ticket is the slowest line's `products.prep_minutes`
 * (`ticketPrepTarget`). It is read live from the menu, not snapshotted: it is
 * an operational setting, not a price, so a corrected prep time applies to the
 * tickets still on the board. Lines whose product was deleted, or has no prep
 * time set, contribute nothing — and an order with no target at all is simply
 * absent from the result.
 */

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { orderItems, products } from "@/db/schema";
import { ticketPrepTarget } from "@/lib/kitchen/tickets";

/** order id → prep target in minutes, for the orders (of this org) that have one. */
export async function getPrepTargets(orgId: string, orderIds: readonly string[]): Promise<ReadonlyMap<string, number | null>> {
  if (orderIds.length === 0) return new Map();

  const rows = await db()
    .select({ orderId: orderItems.orderId, prepMinutes: products.prepMinutes })
    .from(orderItems)
    .leftJoin(products, and(eq(products.id, orderItems.productId), eq(products.orgId, orgId)))
    .where(and(eq(orderItems.orgId, orgId), inArray(orderItems.orderId, [...orderIds])));

  const perOrder = new Map<string, (number | null)[]>();
  for (const row of rows) {
    const lines = perOrder.get(row.orderId) ?? [];
    lines.push(row.prepMinutes);
    perOrder.set(row.orderId, lines);
  }

  const targets = new Map<string, number | null>();
  for (const [orderId, lines] of perOrder) targets.set(orderId, ticketPrepTarget(lines));
  return targets;
}
