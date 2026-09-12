import "server-only";

/**
 * Dine-in tables. BUILD-PLAN.md §22.
 *
 * A table's occupied/available status is never stored — it is derived by
 * asking whether a non-terminal order currently references it, the same
 * reasoning `price_basis` and `foodCostTargetBps` already follow elsewhere
 * in this codebase: one fact, one place, so it cannot drift from the orders
 * that actually define it.
 */

import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { locations, orders, tables } from "@/db/schema";
import { ORDER_STATUSES, isTerminal, type OrderStatus } from "@/domain/order-status";
import { type Paise, paise } from "@/lib/money";

/** Every status that isn't terminal — "still at the table" in one place, derived from the domain module, not re-listed by hand. */
const OPEN_STATUSES: readonly OrderStatus[] = ORDER_STATUSES.filter((status) => !isTerminal(status));

export interface OpenTableOrder {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly grandTotal: Paise;
  readonly placedAt: Date | null;
}

export interface TableRow {
  readonly id: string;
  readonly name: string;
  readonly category: string | null;
  readonly capacity: number | null;
  /** Null when the table is available. Never a stored status — see file comment. */
  readonly openOrder: OpenTableOrder | null;
}

/** Every active table for the org, with whichever open order (if any) currently sits at it. */
export async function listTables(orgId: string): Promise<readonly TableRow[]> {
  const database = db();

  const rows = await database
    .select()
    .from(tables)
    .where(and(eq(tables.orgId, orgId), eq(tables.isActive, true)))
    .orderBy(tables.name);

  if (rows.length === 0) return [];

  const openOrders = await database
    .select({
      id: orders.id,
      tableId: orders.tableId,
      orderNumber: orders.orderNumber,
      status: orders.status,
      grandTotal: orders.grandTotal,
      placedAt: orders.placedAt,
    })
    .from(orders)
    .where(
      and(
        eq(orders.orgId, orgId),
        isNotNull(orders.tableId),
        inArray(orders.status, OPEN_STATUSES),
      ),
    )
    .orderBy(desc(orders.createdAt));

  // A table should only ever have one open order at a time — the assignment
  // flow enforces that — but if two somehow exist, the most recent wins
  // rather than the query throwing.
  const byTable = new Map<string, (typeof openOrders)[number]>();
  for (const order of openOrders) {
    if (order.tableId && !byTable.has(order.tableId)) byTable.set(order.tableId, order);
  }

  return rows.map((row) => {
    const open = byTable.get(row.id);
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      capacity: row.capacity,
      openOrder: open
        ? {
            id: open.id,
            orderNumber: open.orderNumber,
            status: open.status,
            grandTotal: paise(open.grandTotal),
            placedAt: open.placedAt,
          }
        : null,
    };
  });
}

export interface UnassignedDineInOrder {
  readonly id: string;
  readonly orderNumber: string;
  readonly customerName: string | null;
  readonly grandTotal: Paise;
}

/**
 * Live dine-in orders with nowhere to sit yet — what "assign to table"
 * actually picks from. Real data: until orders are placed from the counter
 * as DINE_IN, this is an honest empty list, not a placeholder.
 */
export async function listUnassignedDineInOrders(orgId: string): Promise<readonly UnassignedDineInOrder[]> {
  const database = db();
  const rows = await database
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      customerName: orders.customerName,
      grandTotal: orders.grandTotal,
    })
    .from(orders)
    .where(
      and(
        eq(orders.orgId, orgId),
        eq(orders.fulfilment, "DINE_IN"),
        isNull(orders.tableId),
        inArray(orders.status, OPEN_STATUSES),
      ),
    )
    .orderBy(desc(orders.createdAt));

  return rows.map((row) => ({ ...row, grandTotal: paise(row.grandTotal) }));
}

/** `settings.manage`-gated at the call site — creating a table is a floor-plan change, not an order action. */
export async function createTable(
  orgId: string,
  input: { name: string; category: string | null; capacity: number | null },
): Promise<{ id: string }> {
  const database = db();

  const [location] = await database.select({ id: locations.id }).from(locations).where(eq(locations.orgId, orgId)).limit(1);
  if (!location) throw new Error("tables: no location exists for this org yet");

  const [row] = await database
    .insert(tables)
    .values({
      orgId,
      locationId: location.id,
      name: input.name,
      category: input.category,
      capacity: input.capacity,
    })
    .returning({ id: tables.id });

  if (!row) throw new Error("tables: insert returned no row");
  return row;
}

/**
 * Points a dine-in order at a table.
 *
 * Only the two things the caller must prove: the order is org-scoped and
 * actually DINE_IN — the database's own check constraint
 * (`orders_table_id_only_when_dine_in`) is the real backstop, this is the
 * honest error message in front of it.
 */
export async function assignOrderToTable(orgId: string, orderId: string, tableId: string): Promise<void> {
  const database = db();

  const [order] = await database
    .select({ id: orders.id, fulfilment: orders.fulfilment })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)))
    .limit(1);
  if (!order) throw new Error("tables: order not found for this org");
  if (order.fulfilment !== "DINE_IN") throw new Error("tables: only a dine-in order can be assigned to a table");

  const [table] = await database.select({ id: tables.id }).from(tables).where(and(eq(tables.id, tableId), eq(tables.orgId, orgId))).limit(1);
  if (!table) throw new Error("tables: table not found for this org");

  await database.update(orders).set({ tableId }).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)));
}

/** Clears whichever order currently sits at a table — not a delete, just the reassignment. */
export async function clearTable(orgId: string, tableId: string): Promise<void> {
  const database = db();
  await database
    .update(orders)
    .set({ tableId: null })
    .where(and(eq(orders.tableId, tableId), eq(orders.orgId, orgId)));
}
