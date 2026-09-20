import "server-only";

/**
 * Kitchen stations against the database (roadmap 4.2).
 *
 * A line's station comes from its product's `kds_station` (configured data,
 * no default); the routing rules are in `src/lib/kitchen/stations.ts`. A
 * station marking a line done writes one `kitchen_line_status` row. EXPO marks
 * the whole order READY, but only once every line is done, through the same
 * `advanceOrder` every other status change uses — this file never sets an
 * order's status itself.
 *
 * Every query filters `org_id` itself, on the order, the item and the product.
 */

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { kitchenLineStatus, orderItemModifiers, orderItems, orders, products, tables } from "@/db/schema";
import { type LineStation, type Station, type StationLine, type StationOrder, stationOfLine } from "@/lib/kitchen/stations";
import { getPrepTargets } from "@/lib/repositories/kitchen-targets";
import { advanceOrder } from "@/lib/repositories/orders";

const IN_WORK = ["ACCEPTED", "PREPARING"] as const;

/** Every order the kitchen is working on, with its lines routed and their done state. */
export async function loadStationOrders(orgId: string): Promise<readonly StationOrder[]> {
  const database = db();
  const orderRows = await database
    .select()
    .from(orders)
    .where(and(eq(orders.orgId, orgId), inArray(orders.status, [...IN_WORK])))
    .limit(100);
  if (orderRows.length === 0) return [];

  const ids = orderRows.map((row) => row.id);
  const itemRows = await database
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      name: orderItems.productName,
      quantity: orderItems.quantity,
      position: orderItems.position,
      station: products.kdsStation,
    })
    .from(orderItems)
    .leftJoin(products, and(eq(products.id, orderItems.productId), eq(products.orgId, orgId)))
    .where(and(eq(orderItems.orgId, orgId), inArray(orderItems.orderId, ids)));

  const itemIds = itemRows.map((item) => item.id);
  const modifierRows = itemIds.length
    ? await database
        .select({ orderItemId: orderItemModifiers.orderItemId, name: orderItemModifiers.modifierName })
        .from(orderItemModifiers)
        .where(and(eq(orderItemModifiers.orgId, orgId), inArray(orderItemModifiers.orderItemId, itemIds)))
    : [];
  const doneRows = await database
    .select({ orderItemId: kitchenLineStatus.orderItemId })
    .from(kitchenLineStatus)
    .where(and(eq(kitchenLineStatus.orgId, orgId), inArray(kitchenLineStatus.orderId, ids)));
  const done = new Set(doneRows.map((row) => row.orderItemId));

  const tableIds = orderRows.map((row) => row.tableId).filter((id): id is string => id !== null);
  const tableRows = tableIds.length ? await database.select({ id: tables.id, name: tables.name }).from(tables).where(and(eq(tables.orgId, orgId), inArray(tables.id, tableIds))) : [];
  const tableNames = new Map(tableRows.map((table) => [table.id, table.name]));
  const targets = await getPrepTargets(orgId, ids);

  const modsByItem = new Map<string, string[]>();
  for (const mod of modifierRows) modsByItem.set(mod.orderItemId, [...(modsByItem.get(mod.orderItemId) ?? []), mod.name]);
  const linesByOrder = new Map<string, (StationLine & { position: number })[]>();
  for (const item of itemRows) {
    const list = linesByOrder.get(item.orderId) ?? [];
    list.push({ id: item.id, name: item.name, quantity: item.quantity, modifiers: modsByItem.get(item.id) ?? [], station: stationOfLine(item.station), done: done.has(item.id), position: item.position });
    linesByOrder.set(item.orderId, list);
  }

  return orderRows.map((row) => ({
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    fulfilment: row.fulfilment,
    tableName: row.tableId ? (tableNames.get(row.tableId) ?? null) : null,
    customerName: row.customerName,
    notes: row.notes,
    placedAt: row.placedAt?.toISOString() ?? null,
    promisedAt: row.estimatedReadyAt?.toISOString() ?? null,
    prepTargetMinutes: targets.get(row.id) ?? null,
    lines: (linesByOrder.get(row.id) ?? []).sort((a, b) => a.position - b.position).map((line) => ({ id: line.id, name: line.name, quantity: line.quantity, modifiers: line.modifiers, station: line.station, done: line.done })),
  }));
}

export type SetLineDoneResult = { ok: true } | { ok: false; error: string };

/**
 * Mark a line done, or undo it. Idempotent both ways: marking twice keeps the
 * first row, undoing twice is a no-op. `onlyStation` is a station screen's own
 * scope — it may only touch its own lines — and is checked here, on the server,
 * against the product's current station. EXPO passes none and may mark any line,
 * which is how an unassigned line gets cleared.
 */
export async function setLineDone(input: {
  orgId: string;
  orderItemId: string;
  done: boolean;
  actorUserId: string;
  onlyStation?: Station;
}): Promise<SetLineDoneResult> {
  const database = db();
  const [line] = await database
    .select({ id: orderItems.id, orderId: orderItems.orderId, station: products.kdsStation, status: orders.status })
    .from(orderItems)
    .innerJoin(orders, and(eq(orders.id, orderItems.orderId), eq(orders.orgId, input.orgId)))
    .leftJoin(products, and(eq(products.id, orderItems.productId), eq(products.orgId, input.orgId)))
    .where(and(eq(orderItems.id, input.orderItemId), eq(orderItems.orgId, input.orgId)))
    .limit(1);
  if (!line) return { ok: false, error: "That line was not found." };
  if (line.status !== "ACCEPTED" && line.status !== "PREPARING") return { ok: false, error: "That order is no longer in the kitchen." };

  const station: LineStation = stationOfLine(line.station);
  if (input.onlyStation && station !== input.onlyStation) return { ok: false, error: "That line belongs to another station." };

  if (input.done) {
    await database
      .insert(kitchenLineStatus)
      .values({ orgId: input.orgId, orderId: line.orderId, orderItemId: line.id, station, doneBy: input.actorUserId })
      .onConflictDoNothing({ target: kitchenLineStatus.orderItemId });
  } else {
    await database.delete(kitchenLineStatus).where(and(eq(kitchenLineStatus.orgId, input.orgId), eq(kitchenLineStatus.orderItemId, line.id)));
  }
  return { ok: true };
}

/**
 * EXPO's hand-off: the order goes READY only when every line is done. Walks
 * ACCEPTED -> PREPARING -> READY through `advanceOrder`, so the state machine,
 * its events and its consumption rules stay exactly where they were. Already
 * READY is success, so a retry or double tap changes nothing.
 */
export async function markOrderReadyFromExpo(input: { orgId: string; orderId: string; actorUserId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const [order] = await db().select({ status: orders.status }).from(orders).where(and(eq(orders.id, input.orderId), eq(orders.orgId, input.orgId))).limit(1);
  if (!order) return { ok: false, error: "That order was not found." };
  if (order.status === "READY") return { ok: true };
  if (order.status !== "ACCEPTED" && order.status !== "PREPARING") return { ok: false, error: "That order is not in the kitchen." };

  const lines = await db()
    .select({ id: orderItems.id, done: kitchenLineStatus.id })
    .from(orderItems)
    .leftJoin(kitchenLineStatus, and(eq(kitchenLineStatus.orderItemId, orderItems.id), eq(kitchenLineStatus.orgId, input.orgId)))
    .where(and(eq(orderItems.orgId, input.orgId), eq(orderItems.orderId, input.orderId)));
  if (lines.length === 0) return { ok: false, error: "That order has no lines." };
  const open = lines.filter((line) => line.done === null).length;
  if (open > 0) return { ok: false, error: `${open} ${open === 1 ? "line is" : "lines are"} not done yet.` };

  if (order.status === "ACCEPTED") {
    const started = await advanceOrder({ orderId: input.orderId, to: "PREPARING", actorUserId: input.actorUserId, orgId: input.orgId });
    if (!started.ok) return started;
  }
  const ready = await advanceOrder({ orderId: input.orderId, to: "READY", actorUserId: input.actorUserId, orgId: input.orgId });
  if (ready.ok) return ready;
  // A concurrent double tap: the other one won. READY is what was asked for.
  const [after] = await db().select({ status: orders.status }).from(orders).where(and(eq(orders.id, input.orderId), eq(orders.orgId, input.orgId))).limit(1);
  return after?.status === "READY" ? { ok: true } : ready;
}
