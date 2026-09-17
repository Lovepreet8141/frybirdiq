import "server-only";

/**
 * Finished orders — the other half of the orders board, which deliberately
 * hides terminal orders so the counter's list stays readable. Read-only:
 * every figure is the row as it was stored at sale time (§51 snapshots),
 * nothing is repriced. Paid means a payment was ever captured, so an order
 * refunded afterwards still reads as paid, with its refund state beside it
 * (`orderPaymentState`).
 */

import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { orderItemModifiers, orderItems, orders, payments } from "@/db/schema";
import type { OrderChannel } from "@/domain/order-channel";
import { EVER_CAPTURED_STATUSES, type OrderPaymentState, orderPaymentState } from "@/domain/order-payment-state";
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
  /** A payment was ever captured, including one refunded since. */
  readonly isPaid: boolean;
  /** UNPAID, PAID, PARTIALLY_REFUNDED or REFUNDED — see `orderPaymentState`. */
  readonly paymentState: OrderPaymentState;
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
  const [items, captured] = await Promise.all([
    database.select().from(orderItems).where(and(eq(orderItems.orgId, orgId), inArray(orderItems.orderId, ids))),
    database
      .select({ orderId: payments.orderId, status: payments.status })
      .from(payments)
      .where(and(eq(payments.orgId, orgId), inArray(payments.orderId, ids), inArray(payments.status, [...EVER_CAPTURED_STATUSES]))),
  ]);
  const itemIds = items.map((item) => item.id);
  const mods =
    itemIds.length > 0
      ? await database.select().from(orderItemModifiers).where(and(eq(orderItemModifiers.orgId, orgId), inArray(orderItemModifiers.orderItemId, itemIds)))
      : [];
  const paymentStatuses = new Map<string, (typeof captured)[number]["status"][]>();
  for (const payment of captured) paymentStatuses.set(payment.orderId, [...(paymentStatuses.get(payment.orderId) ?? []), payment.status]);

  return rows.map((row) => ({
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    fulfilment: row.fulfilment,
    channel: row.channel,
    customerName: row.customerName,
    grandTotal: paise(row.grandTotal),
    ...paymentFields(paymentStatuses.get(row.id) ?? []),
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

function paymentFields(statuses: Parameters<typeof orderPaymentState>[0]): Pick<OrderHistoryRow, "isPaid" | "paymentState"> {
  const paymentState = orderPaymentState(statuses);
  return { isPaid: paymentState !== "UNPAID", paymentState };
}
