import "server-only";

/**
 * Finished orders — the other half of the orders board, which deliberately
 * hides terminal orders so the counter's list stays readable. Read-only:
 * every figure is the row as it was stored at sale time (§51 snapshots),
 * nothing is repriced, and paid means a captured payment exists, the same
 * rule the ledger and the dashboard use.
 */

import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { orderItemModifiers, orderItems, orders, payments } from "@/db/schema";
import type { OrderChannel } from "@/domain/order-channel";
import { type FulfilmentType, type OrderStatus, TERMINAL_STATUSES } from "@/domain/order-status";
import type { DateRange } from "@/lib/dates";
import { type Paise, paise } from "@/lib/money";

export interface OrderHistoryLine {
  readonly name: string;
  readonly quantity: number;
  readonly modifiers: readonly string[];
  /** The stored line subtotal, before discount and tax — what the ticket said at the time. */
  readonly lineSubtotal: Paise;
}

export interface OrderHistoryRow {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly fulfilment: FulfilmentType;
  readonly channel: OrderChannel;
  readonly customerName: string | null;
  readonly grandTotal: Paise;
  readonly isPaid: boolean;
  readonly placedAt: Date | null;
  readonly closedAt: Date;
  readonly cancellationReason: string | null;
  readonly items: readonly OrderHistoryLine[];
}

export async function listOrderHistory(orgId: string, range: DateRange, limit = 300): Promise<readonly OrderHistoryRow[]> {
  const database = db();
  const rows = await database
    .select()
    .from(orders)
    .where(and(eq(orders.orgId, orgId), inArray(orders.status, [...TERMINAL_STATUSES]), gte(orders.createdAt, range.from), lt(orders.createdAt, range.to)))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const [items, paid] = await Promise.all([
    database.select().from(orderItems).where(inArray(orderItems.orderId, ids)),
    database.select({ orderId: payments.orderId }).from(payments).where(and(inArray(payments.orderId, ids), eq(payments.status, "CAPTURED"))),
  ]);
  const itemIds = items.map((item) => item.id);
  const mods = itemIds.length > 0 ? await database.select().from(orderItemModifiers).where(inArray(orderItemModifiers.orderItemId, itemIds)) : [];
  const paidOrderIds = new Set(paid.map((payment) => payment.orderId));

  return rows.map((row) => ({
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    fulfilment: row.fulfilment,
    channel: row.channel,
    customerName: row.customerName,
    grandTotal: paise(row.grandTotal),
    isPaid: paidOrderIds.has(row.id),
    placedAt: row.placedAt,
    closedAt: row.completedAt ?? row.updatedAt,
    cancellationReason: row.cancellationReason,
    items: items
      .filter((item) => item.orderId === row.id)
      .map((item) => ({
        name: item.productName,
        quantity: item.quantity,
        modifiers: mods.filter((mod) => mod.orderItemId === item.id).map((mod) => mod.modifierName),
        lineSubtotal: paise(item.lineSubtotal),
      })),
  }));
}
