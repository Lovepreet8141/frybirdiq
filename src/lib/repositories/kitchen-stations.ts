import "server-only";

/**
 * Kitchen stations against the database (roadmap 4.2).
 *
 * A line's station is its product's override, else its category's default,
 * else ASSEMBLY (`src/lib/kitchen/stations.ts`). A station marking a line done
 * writes one `kitchen_line_status` row, and starts the order (ACCEPTED to
 * PREPARING) through `advanceOrder`. PACK marks a takeaway or delivery order
 * packed (`kitchen_order_pack`). EXPO marks the order READY, but only once
 * every line is done and, where there is a PACK step, packed. Every status
 * change goes through `advanceOrder`; this file never sets one itself.
 *
 * Every query filters `org_id` itself, on the order, the item and the product.
 */

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { categories, kitchenLineStatus, kitchenOrderPack, orderItemModifiers, orderItems, orders, products, tables } from "@/db/schema";
import { type LineStation, type ProductStation, type StationLine, type StationOrder, packRequired, productStationList, resolveLineStation } from "@/lib/kitchen/stations";
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
      override: products.kdsStation,
      categoryName: categories.name,
    })
    .from(orderItems)
    .leftJoin(products, and(eq(products.id, orderItems.productId), eq(products.orgId, orgId)))
    .leftJoin(categories, and(eq(categories.id, products.categoryId), eq(categories.orgId, orgId)))
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
  const packRows = await database.select({ orderId: kitchenOrderPack.orderId }).from(kitchenOrderPack).where(and(eq(kitchenOrderPack.orgId, orgId), inArray(kitchenOrderPack.orderId, ids)));
  const packed = new Set(packRows.map((row) => row.orderId));

  const tableIds = orderRows.map((row) => row.tableId).filter((id): id is string => id !== null);
  const tableRows = tableIds.length ? await database.select({ id: tables.id, name: tables.name }).from(tables).where(and(eq(tables.orgId, orgId), inArray(tables.id, tableIds))) : [];
  const tableNames = new Map(tableRows.map((table) => [table.id, table.name]));
  const targets = await getPrepTargets(orgId, ids);

  const modsByItem = new Map<string, string[]>();
  for (const mod of modifierRows) modsByItem.set(mod.orderItemId, [...(modsByItem.get(mod.orderItemId) ?? []), mod.name]);
  const linesByOrder = new Map<string, (StationLine & { position: number })[]>();
  for (const item of itemRows) {
    const list = linesByOrder.get(item.orderId) ?? [];
    list.push({ id: item.id, name: item.name, quantity: item.quantity, modifiers: modsByItem.get(item.id) ?? [], station: resolveLineStation({ override: item.override, categoryName: item.categoryName }).station, done: done.has(item.id), position: item.position });
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
    packed: packRequired(row.fulfilment) && packed.has(row.id),
    lines: (linesByOrder.get(row.id) ?? []).sort((a, b) => a.position - b.position).map((line) => ({ id: line.id, name: line.name, quantity: line.quantity, modifiers: line.modifiers, station: line.station, done: line.done })),
  }));
}

export type SetLineDoneResult = { ok: true } | { ok: false; error: string };

/**
 * Mark a line done, or undo it. Idempotent both ways: marking twice keeps the
 * first row, undoing twice is a no-op. `onlyStation` is a station screen's own
 * scope — it may only touch its own lines — and is checked here, on the server,
 * against the line's current station. EXPO passes none and may mark any line.
 *
 * Marking a line done also starts the order: if it is still ACCEPTED it moves
 * to PREPARING through `advanceOrder` (a normal order event by the marking
 * user). Already PREPARING, nothing happens, so any number of marks makes one
 * event. Undo never moves the order back. An order that is not ACCEPTED or
 * PREPARING is refused before anything is written.
 */
export async function setLineDone(input: {
  orgId: string;
  orderItemId: string;
  done: boolean;
  actorUserId: string;
  onlyStation?: LineStation;
}): Promise<SetLineDoneResult> {
  const database = db();
  const [line] = await database
    .select({ id: orderItems.id, orderId: orderItems.orderId, override: products.kdsStation, categoryName: categories.name, status: orders.status })
    .from(orderItems)
    .innerJoin(orders, and(eq(orders.id, orderItems.orderId), eq(orders.orgId, input.orgId)))
    .leftJoin(products, and(eq(products.id, orderItems.productId), eq(products.orgId, input.orgId)))
    .leftJoin(categories, and(eq(categories.id, products.categoryId), eq(categories.orgId, input.orgId)))
    .where(and(eq(orderItems.id, input.orderItemId), eq(orderItems.orgId, input.orgId)))
    .limit(1);
  if (!line) return { ok: false, error: "That line was not found." };
  if (line.status !== "ACCEPTED" && line.status !== "PREPARING") return { ok: false, error: "That order is no longer in the kitchen." };

  const station = resolveLineStation({ override: line.override, categoryName: line.categoryName }).station;
  if (input.onlyStation && station !== input.onlyStation) return { ok: false, error: "That line belongs to another station." };

  if (!input.done) {
    await database.delete(kitchenLineStatus).where(and(eq(kitchenLineStatus.orgId, input.orgId), eq(kitchenLineStatus.orderItemId, line.id)));
    return { ok: true };
  }

  await database
    .insert(kitchenLineStatus)
    .values({ orgId: input.orgId, orderId: line.orderId, orderItemId: line.id, station, doneBy: input.actorUserId })
    .onConflictDoNothing({ target: kitchenLineStatus.orderItemId });

  if (line.status === "ACCEPTED") {
    const started = await advanceOrder({ orderId: line.orderId, to: "PREPARING", actorUserId: input.actorUserId, orgId: input.orgId });
    if (!started.ok) {
      // A concurrent mark may have started it already; that is the goal.
      const [after] = await database.select({ status: orders.status }).from(orders).where(and(eq(orders.id, line.orderId), eq(orders.orgId, input.orgId))).limit(1);
      if (after?.status !== "PREPARING" && after?.status !== "READY") return { ok: false, error: `Line marked done, but the order could not be started: ${started.error}` };
    }
  }
  return { ok: true };
}

/**
 * PACK: mark a takeaway or delivery order packed (or undo it). Refused for
 * dine-in, for an order not in the kitchen, and while any line is open.
 * Idempotent: packing twice keeps the first row.
 */
export async function setOrderPacked(input: { orgId: string; orderId: string; packed: boolean; actorUserId: string }): Promise<SetLineDoneResult> {
  const database = db();
  const [order] = await database.select({ status: orders.status, fulfilment: orders.fulfilment }).from(orders).where(and(eq(orders.id, input.orderId), eq(orders.orgId, input.orgId))).limit(1);
  if (!order) return { ok: false, error: "That order was not found." };
  if (!packRequired(order.fulfilment)) return { ok: false, error: "Dine-in orders are not packed." };
  if (order.status !== "ACCEPTED" && order.status !== "PREPARING") return { ok: false, error: "That order is no longer in the kitchen." };

  if (!input.packed) {
    await database.delete(kitchenOrderPack).where(and(eq(kitchenOrderPack.orgId, input.orgId), eq(kitchenOrderPack.orderId, input.orderId)));
    return { ok: true };
  }

  const open = await countOpenLines(input.orgId, input.orderId);
  if (open === null) return { ok: false, error: "That order has no lines." };
  if (open > 0) return { ok: false, error: `${open} ${open === 1 ? "line is" : "lines are"} not done yet.` };

  await database.insert(kitchenOrderPack).values({ orgId: input.orgId, orderId: input.orderId, packedBy: input.actorUserId }).onConflictDoNothing({ target: kitchenOrderPack.orderId });
  return { ok: true };
}

/** Lines of the order with no done row; null when the order has no lines. */
async function countOpenLines(orgId: string, orderId: string): Promise<number | null> {
  const lines = await db()
    .select({ id: orderItems.id, done: kitchenLineStatus.id })
    .from(orderItems)
    .leftJoin(kitchenLineStatus, and(eq(kitchenLineStatus.orderItemId, orderItems.id), eq(kitchenLineStatus.orgId, orgId)))
    .where(and(eq(orderItems.orgId, orgId), eq(orderItems.orderId, orderId)));
  return lines.length === 0 ? null : lines.filter((line) => line.done === null).length;
}

/** The full product-to-station list for the org's menu, for showing the owner. Read-only. */
export async function listProductStations(orgId: string): Promise<readonly ProductStation[]> {
  const rows = await db()
    .select({ product: products.name, override: products.kdsStation, category: categories.name })
    .from(products)
    .leftJoin(categories, and(eq(categories.id, products.categoryId), eq(categories.orgId, orgId)))
    .where(eq(products.orgId, orgId));
  return productStationList(rows);
}

/**
 * EXPO's hand-off: the order goes READY only when every line is done and, for takeaway and delivery, it is packed. Walks
 * ACCEPTED -> PREPARING -> READY through `advanceOrder`, so the state machine,
 * its events and its consumption rules stay exactly where they were. Already
 * READY is success, so a retry or double tap changes nothing.
 */
export async function markOrderReadyFromExpo(input: { orgId: string; orderId: string; actorUserId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const [order] = await db().select({ status: orders.status, fulfilment: orders.fulfilment }).from(orders).where(and(eq(orders.id, input.orderId), eq(orders.orgId, input.orgId))).limit(1);
  if (!order) return { ok: false, error: "That order was not found." };
  if (order.status === "READY") return { ok: true };
  if (order.status !== "ACCEPTED" && order.status !== "PREPARING") return { ok: false, error: "That order is not in the kitchen." };

  const open = await countOpenLines(input.orgId, input.orderId);
  if (open === null) return { ok: false, error: "That order has no lines." };
  if (open > 0) return { ok: false, error: `${open} ${open === 1 ? "line is" : "lines are"} not done yet.` };
  if (packRequired(order.fulfilment)) {
    const [pack] = await db().select({ id: kitchenOrderPack.id }).from(kitchenOrderPack).where(and(eq(kitchenOrderPack.orgId, input.orgId), eq(kitchenOrderPack.orderId, input.orderId))).limit(1);
    if (!pack) return { ok: false, error: "This order has to be packed first." };
  }

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
