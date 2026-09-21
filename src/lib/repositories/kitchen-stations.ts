import "server-only";

/**
 * Kitchen stations against the database (roadmap 4.2).
 *
 * An order line becomes one or more station tasks (`resolveTasks`): a simple
 * product goes to its override, else its category's default, else ASSEMBLY; a
 * combo is expanded into its `combo_items` components, each at its own
 * station, or FRY and ASSEMBLY both when none are defined; sauces and dips go
 * to PACK (ASSEMBLY on dine-in). A station marking a task done writes one
 * `kitchen_line_status` row per (order item, station) and starts the order
 * (ACCEPTED to PREPARING) through `advanceOrder`. PACK's "Packed" completes the
 * order's PACK tasks and the order-level `kitchen_order_pack` row together.
 * EXPO marks the order READY only when every task is done and, for takeaway
 * and delivery, it is packed. Every status change goes through `advanceOrder`;
 * this file never sets one itself.
 *
 * Every query filters `org_id` itself, on the order, item, product, category
 * and, for combos, both the combo and its component (`combo_items` has no
 * org_id of its own).
 */

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { categories, comboItems, kitchenLineStatus, kitchenOrderPack, orderItemModifiers, orderItems, orders, products, tables } from "@/db/schema";
import type { FulfilmentType } from "@/domain/order-status";
import {
  type LineStation,
  type ProductRouting,
  type ProductStation,
  type StationLine,
  type StationOrder,
  packRequired,
  productStationList,
  resolveTasks,
  visibleStations,
} from "@/lib/kitchen/stations";
import { getPrepTargets } from "@/lib/repositories/kitchen-targets";
import { advanceOrder } from "@/lib/repositories/orders";

const IN_WORK = ["ACCEPTED", "PREPARING"] as const;

/** Routing facts for products of this org: override, category, and, for a combo, its stored components. */
async function loadRouting(orgId: string, productIds: readonly string[]): Promise<ReadonlyMap<string, ProductRouting>> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return new Map();
  const database = db();

  const rows = await database
    .select({ id: products.id, override: products.kdsStation, type: products.productType, categoryName: categories.name })
    .from(products)
    .leftJoin(categories, and(eq(categories.id, products.categoryId), eq(categories.orgId, orgId)))
    .where(and(eq(products.orgId, orgId), inArray(products.id, ids)));

  const comboIds = rows.filter((row) => row.type === "COMBO").map((row) => row.id);
  const components = new Map<string, { override: string | null; categoryName: string | null }[]>();
  if (comboIds.length > 0) {
    const component = products; // the component side of the join, org-scoped like the combo side
    const parts = await database
      .select({ comboId: comboItems.comboProductId, override: component.kdsStation, categoryName: categories.name })
      .from(comboItems)
      .innerJoin(component, and(eq(component.id, comboItems.productId), eq(component.orgId, orgId)))
      .leftJoin(categories, and(eq(categories.id, component.categoryId), eq(categories.orgId, orgId)))
      .where(inArray(comboItems.comboProductId, comboIds));
    for (const part of parts) components.set(part.comboId, [...(components.get(part.comboId) ?? []), { override: part.override, categoryName: part.categoryName }]);
  }

  return new Map(rows.map((row) => [row.id, { override: row.override, categoryName: row.categoryName, isCombo: row.type === "COMBO", components: components.get(row.id) ?? [] }]));
}

const DEFAULT_ROUTING: ProductRouting = { override: null, categoryName: null, isCombo: false, components: [] };

interface TaskItem {
  readonly id: string;
  readonly orderId: string;
  readonly name: string;
  readonly quantity: number;
  readonly position: number;
  readonly stations: readonly LineStation[];
}

/**
 * The tasks of every item of the given orders, and which are done. A task is
 * done when its (item, station) row exists; a line with a single task also
 * counts as done if it was marked at any station, so changing a product's
 * station mid-service leaves already-marked lines done where they were.
 */
async function loadTasks(orgId: string, orders_: readonly { id: string; fulfilment: FulfilmentType }[]) {
  const database = db();
  const ids = orders_.map((order) => order.id);
  const fulfilmentOf = new Map(orders_.map((order) => [order.id, order.fulfilment]));
  const itemRows = ids.length
    ? await database
        .select({ id: orderItems.id, orderId: orderItems.orderId, productId: orderItems.productId, name: orderItems.productName, quantity: orderItems.quantity, position: orderItems.position })
        .from(orderItems)
        .where(and(eq(orderItems.orgId, orgId), inArray(orderItems.orderId, ids)))
    : [];
  const routing = await loadRouting(orgId, itemRows.map((item) => item.productId).filter((id): id is string => id !== null));
  const doneRows = ids.length
    ? await database.select({ orderItemId: kitchenLineStatus.orderItemId, station: kitchenLineStatus.station }).from(kitchenLineStatus).where(and(eq(kitchenLineStatus.orgId, orgId), inArray(kitchenLineStatus.orderId, ids)))
    : [];
  const marked = new Map<string, Set<string>>();
  for (const row of doneRows) marked.set(row.orderItemId, (marked.get(row.orderItemId) ?? new Set()).add(row.station));

  const items: TaskItem[] = itemRows.map((item) => ({
    id: item.id,
    orderId: item.orderId,
    name: item.name,
    quantity: item.quantity,
    position: item.position,
    stations: resolveTasks((item.productId && routing.get(item.productId)) || DEFAULT_ROUTING, fulfilmentOf.get(item.orderId) ?? "TAKEAWAY").map((task) => task.station),
  }));
  const isDone = (item: TaskItem, station: LineStation): boolean => {
    const stations = marked.get(item.id);
    return !!stations && (stations.has(station) || item.stations.length === 1);
  };
  return { items, isDone };
}

/** Every order the kitchen is working on, with its lines expanded into station tasks and their done state. */
export async function loadStationOrders(orgId: string): Promise<readonly StationOrder[]> {
  const database = db();
  const orderRows = await database
    .select()
    .from(orders)
    .where(and(eq(orders.orgId, orgId), inArray(orders.status, [...IN_WORK])))
    // Oldest first, so if more than 100 are in work the ones shown are the ones waiting longest, not an arbitrary subset.
    .orderBy(asc(orders.placedAt), asc(orders.createdAt))
    .limit(100);
  if (orderRows.length === 0) return [];

  const ids = orderRows.map((row) => row.id);
  const { items, isDone } = await loadTasks(orgId, orderRows);

  const itemIds = items.map((item) => item.id);
  const modifierRows = itemIds.length
    ? await database
        .select({ orderItemId: orderItemModifiers.orderItemId, name: orderItemModifiers.modifierName })
        .from(orderItemModifiers)
        .where(and(eq(orderItemModifiers.orgId, orgId), inArray(orderItemModifiers.orderItemId, itemIds)))
    : [];
  const packRows = await database.select({ orderId: kitchenOrderPack.orderId }).from(kitchenOrderPack).where(and(eq(kitchenOrderPack.orgId, orgId), inArray(kitchenOrderPack.orderId, ids)));
  const packed = new Set(packRows.map((row) => row.orderId));

  const tableIds = orderRows.map((row) => row.tableId).filter((id): id is string => id !== null);
  const tableRows = tableIds.length ? await database.select({ id: tables.id, name: tables.name }).from(tables).where(and(eq(tables.orgId, orgId), inArray(tables.id, tableIds))) : [];
  const tableNames = new Map(tableRows.map((table) => [table.id, table.name]));
  const targets = await getPrepTargets(orgId, ids);

  const modsByItem = new Map<string, string[]>();
  for (const mod of modifierRows) modsByItem.set(mod.orderItemId, [...(modsByItem.get(mod.orderItemId) ?? []), mod.name]);
  const linesByOrder = new Map<string, { position: number; line: StationLine }[]>();
  for (const item of items) {
    const list = linesByOrder.get(item.orderId) ?? [];
    for (const station of item.stations) {
      list.push({ position: item.position, line: { id: item.id, name: item.name, quantity: item.quantity, modifiers: modsByItem.get(item.id) ?? [], station, done: isDone(item, station) } });
    }
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
    lines: (linesByOrder.get(row.id) ?? []).sort((a, b) => a.position - b.position).map((entry) => entry.line),
  }));
}

export type SetLineDoneResult = { ok: true } | { ok: false; error: string };

/**
 * Mark a task (an order line at one station) done, or undo it. `station` is
 * both the task's identity and the caller's scope: it must be one of the
 * stations the line currently resolves to, checked here on the server. Marking
 * is idempotent (one row per item and station); undoing twice is a no-op.
 *
 * Marking also starts the order: still ACCEPTED, it moves to PREPARING through
 * `advanceOrder` (a normal order event by the marking user); already PREPARING,
 * nothing happens, so any number of marks makes one event. Undo never moves
 * the order back. An order not in ACCEPTED or PREPARING is refused before
 * anything is written.
 */
export async function setLineDone(input: { orgId: string; orderItemId: string; station: LineStation; done: boolean; actorUserId: string }): Promise<SetLineDoneResult> {
  const database = db();
  const [line] = await database
    .select({ id: orderItems.id, orderId: orderItems.orderId, status: orders.status, fulfilment: orders.fulfilment })
    .from(orderItems)
    .innerJoin(orders, and(eq(orders.id, orderItems.orderId), eq(orders.orgId, input.orgId)))
    .where(and(eq(orderItems.id, input.orderItemId), eq(orderItems.orgId, input.orgId)))
    .limit(1);
  if (!line) return { ok: false, error: "That line was not found." };
  if (line.status !== "ACCEPTED" && line.status !== "PREPARING") return { ok: false, error: "That order is no longer in the kitchen." };

  const { items } = await loadTasks(input.orgId, [{ id: line.orderId, fulfilment: line.fulfilment }]);
  const item = items.find((candidate) => candidate.id === line.id);
  if (!item?.stations.includes(input.station)) return { ok: false, error: "That line belongs to another station." };

  if (!input.done) {
    await database.delete(kitchenLineStatus).where(and(eq(kitchenLineStatus.orgId, input.orgId), eq(kitchenLineStatus.orderItemId, line.id), eq(kitchenLineStatus.station, input.station)));
    return { ok: true };
  }

  await database
    .insert(kitchenLineStatus)
    .values({ orgId: input.orgId, orderId: line.orderId, orderItemId: line.id, station: input.station, doneBy: input.actorUserId })
    .onConflictDoNothing({ target: [kitchenLineStatus.orderItemId, kitchenLineStatus.station] });

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

/** Open task counts for one order: `others` are non-PACK tasks not yet done, `all` includes PACK's. Null when the order has no tasks. */
async function openTasks(orgId: string, order: { id: string; fulfilment: FulfilmentType }): Promise<{ others: number; all: number; packItems: string[] } | null> {
  const { items, isDone } = await loadTasks(orgId, [order]);
  const tasks = items.flatMap((item) => item.stations.map((station) => ({ item, station })));
  if (tasks.length === 0) return null;
  const open = tasks.filter((task) => !isDone(task.item, task.station));
  return { others: open.filter((task) => task.station !== "PACK").length, all: open.length, packItems: tasks.filter((task) => task.station === "PACK").map((task) => task.item.id) };
}

/**
 * PACK: "Packed" completes the order's PACK tasks (sauce and dip lines) and the
 * order-level packed step together, in one transaction, or undoes both. Refused
 * for dine-in (no PACK step), for an order not in the kitchen, and while any
 * non-PACK task is open. Idempotent: packing twice keeps the first rows.
 */
export async function setOrderPacked(input: { orgId: string; orderId: string; packed: boolean; actorUserId: string }): Promise<SetLineDoneResult> {
  const database = db();
  const [order] = await database.select({ id: orders.id, status: orders.status, fulfilment: orders.fulfilment }).from(orders).where(and(eq(orders.id, input.orderId), eq(orders.orgId, input.orgId))).limit(1);
  if (!order) return { ok: false, error: "That order was not found." };
  if (!packRequired(order.fulfilment)) return { ok: false, error: "Dine-in orders are not packed." };
  if (order.status !== "ACCEPTED" && order.status !== "PREPARING") return { ok: false, error: "That order is no longer in the kitchen." };

  const open = await openTasks(input.orgId, order);
  if (open === null) return { ok: false, error: "That order has no lines." };

  if (!input.packed) {
    await database.transaction(async (tx) => {
      if (open.packItems.length > 0) {
        await tx.delete(kitchenLineStatus).where(and(eq(kitchenLineStatus.orgId, input.orgId), eq(kitchenLineStatus.station, "PACK"), inArray(kitchenLineStatus.orderItemId, open.packItems)));
      }
      await tx.delete(kitchenOrderPack).where(and(eq(kitchenOrderPack.orgId, input.orgId), eq(kitchenOrderPack.orderId, input.orderId)));
    });
    return { ok: true };
  }

  if (open.others > 0) return { ok: false, error: `${open.others} ${open.others === 1 ? "line is" : "lines are"} not done yet.` };

  await database.transaction(async (tx) => {
    for (const itemId of open.packItems) {
      await tx.insert(kitchenLineStatus).values({ orgId: input.orgId, orderId: input.orderId, orderItemId: itemId, station: "PACK", doneBy: input.actorUserId }).onConflictDoNothing({ target: [kitchenLineStatus.orderItemId, kitchenLineStatus.station] });
    }
    await tx.insert(kitchenOrderPack).values({ orgId: input.orgId, orderId: input.orderId, packedBy: input.actorUserId }).onConflictDoNothing({ target: kitchenOrderPack.orderId });
  });
  return { ok: true };
}

/** The full product-to-station list for the org's menu, for showing the owner. Read-only; worked out as for a takeaway or delivery order. */
export async function listProductStations(orgId: string): Promise<readonly ProductStation[]> {
  const rows = await db().select({ id: products.id, name: products.name, category: categories.name }).from(products).leftJoin(categories, and(eq(categories.id, products.categoryId), eq(categories.orgId, orgId))).where(eq(products.orgId, orgId));
  const routing = await loadRouting(orgId, rows.map((row) => row.id));
  return productStationList(
    rows.map((row) => {
      const r = routing.get(row.id) ?? DEFAULT_ROUTING;
      return { category: row.category, product: row.name, override: r.override ?? null, isCombo: r.isCombo, components: r.components.map((c) => ({ category: c.categoryName ?? null, product: "", override: c.override ?? null })) };
    }),
  );
}

/**
 * The stations that should have a tab for this org: DRINKS only once a live
 * menu product resolves to it (through the same resolver), or an order in the
 * kitchen already has a drinks task. See `visibleStations`.
 */
export async function listVisibleStations(orgId: string): Promise<readonly LineStation[]> {
  const live = await db()
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.orgId, orgId), eq(products.isActive, true), eq(products.status, "PUBLISHED")));
  const routing = await loadRouting(orgId, live.map((row) => row.id));
  const menuStations = [...routing.values()].flatMap((r) => resolveTasks(r, "TAKEAWAY").map((task) => task.station));
  const inKitchen = await loadStationOrders(orgId);
  return visibleStations(menuStations, inKitchen.flatMap((order) => order.lines.map((line) => line.station)));
}

/**
 * EXPO's hand-off: the order goes READY only when every task is done and, for
 * takeaway and delivery, it is packed. Walks ACCEPTED -> PREPARING -> READY
 * through `advanceOrder`, so the state machine, its events and its consumption
 * rules stay exactly where they were. Already READY is success, so a retry or
 * double tap changes nothing.
 */
export async function markOrderReadyFromExpo(input: { orgId: string; orderId: string; actorUserId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const [order] = await db().select({ id: orders.id, status: orders.status, fulfilment: orders.fulfilment }).from(orders).where(and(eq(orders.id, input.orderId), eq(orders.orgId, input.orgId))).limit(1);
  if (!order) return { ok: false, error: "That order was not found." };
  if (order.status === "READY") return { ok: true };
  if (order.status !== "ACCEPTED" && order.status !== "PREPARING") return { ok: false, error: "That order is not in the kitchen." };

  const open = await openTasks(input.orgId, order);
  if (open === null) return { ok: false, error: "That order has no lines." };
  if (open.all > 0) return { ok: false, error: `${open.all} ${open.all === 1 ? "line is" : "lines are"} not done yet.` };
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
