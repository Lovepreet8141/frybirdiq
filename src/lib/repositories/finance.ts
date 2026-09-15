import "server-only";

/**
 * The payments ledger — money that actually moved, one row per payment.
 *
 * Read-only. This is deliberately NOT a second definition of revenue:
 * revenue stays `analytics.ts`'s (an order's `grandTotal`, once it has a
 * captured payment). What this shows is the payment records themselves —
 * amount, method, provider fee, who captured it — which is the surface a
 * manager reads to check the till, not the dashboard figure. The two are
 * labelled differently on screen for that reason ("captured", never
 * "revenue").
 *
 * "Who captured" comes from the `payment_captured` audit row
 * `recordCashPayment` already writes (`payments.ts`), resolved to a display
 * name the same way `listActiveOrders` resolves "placed by". Nothing here
 * writes a payment, a refund, or an audit row.
 */

import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, memberships, orders, payments, refunds } from "@/db/schema";
import type { OrderChannel } from "@/domain/order-channel";
import type { DateRange } from "@/lib/dates";
import { type Paise, ZERO, add, paise } from "@/lib/money";

export type PaymentMethod = (typeof payments.method.enumValues)[number];
export type PaymentStatus = (typeof payments.status.enumValues)[number];

export interface PaymentRow {
  readonly id: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly channel: OrderChannel;
  readonly status: PaymentStatus;
  readonly method: PaymentMethod;
  readonly provider: string;
  readonly amount: Paise;
  readonly feeAmount: Paise;
  readonly capturedBy: string | null;
  readonly at: Date;
  /** What has already gone back on this payment, so a second refund cannot exceed what is left. */
  readonly refunded: Paise;
  readonly providerPaymentId: string | null;
}

export interface RefundRow {
  readonly id: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly amount: Paise;
  readonly reason: string;
  readonly by: string | null;
  readonly at: Date;
}

export interface PaymentsLedger {
  readonly range: DateRange;
  readonly payments: readonly PaymentRow[];
  readonly refunds: readonly RefundRow[];
  /** Captured payments only — pending and failed are listed but never summed. */
  readonly capturedTotal: Paise;
  readonly capturedCount: number;
  readonly feeTotal: Paise;
  readonly refundedTotal: Paise;
  readonly byMethod: readonly { method: PaymentMethod; count: number; total: Paise }[];
}

async function staffNames(orgId: string, userIds: readonly string[]): Promise<Map<string, string | null>> {
  if (userIds.length === 0) return new Map();
  const rows = await db()
    .select({ userId: memberships.userId, displayName: memberships.displayName })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), inArray(memberships.userId, userIds as string[])));
  return new Map(rows.map((row) => [row.userId, row.displayName]));
}

/**
 * `limit` caps how many payment rows come back — 500 for the Payments
 * screen's own use, and a much higher figure for the reports.export CSV
 * download (roadmap 5.4), where truncating a month's payments silently
 * would make the export wrong rather than merely long.
 */
export async function getPaymentsLedger(orgId: string, range: DateRange, limit = 500): Promise<PaymentsLedger> {
  const database = db();

  const paymentRows = await database
    .select({
      id: payments.id,
      orderId: payments.orderId,
      orderNumber: orders.orderNumber,
      channel: orders.channel,
      status: payments.status,
      method: payments.method,
      provider: payments.provider,
      amount: payments.amount,
      feeAmount: payments.feeAmount,
      capturedAt: payments.capturedAt,
      createdAt: payments.createdAt,
      providerPaymentId: payments.providerPaymentId,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(and(eq(payments.orgId, orgId), gte(payments.createdAt, range.from), lt(payments.createdAt, range.to)))
    .orderBy(desc(payments.createdAt))
    .limit(limit);

  // Refunds already booked against the payments in view, whenever they were
  // made — a refund next month still reduces what this month's payment can
  // give back.
  const paymentIds = paymentRows.map((row) => row.id);
  const refundedByPayment = new Map<string, Paise>();
  if (paymentIds.length > 0) {
    const booked = await database
      .select({ paymentId: refunds.paymentId, amount: refunds.amount })
      .from(refunds)
      .where(and(eq(refunds.orgId, orgId), inArray(refunds.paymentId, paymentIds)));
    for (const row of booked) refundedByPayment.set(row.paymentId, add(refundedByPayment.get(row.paymentId) ?? ZERO, paise(row.amount)));
  }

  const refundRows = await database
    .select({
      id: refunds.id,
      orderId: refunds.orderId,
      orderNumber: orders.orderNumber,
      amount: refunds.amount,
      reason: refunds.reason,
      actorUserId: refunds.actorUserId,
      createdAt: refunds.createdAt,
    })
    .from(refunds)
    .innerJoin(orders, eq(orders.id, refunds.orderId))
    .where(and(eq(refunds.orgId, orgId), gte(refunds.createdAt, range.from), lt(refunds.createdAt, range.to)))
    .orderBy(desc(refunds.createdAt))
    .limit(200);

  // Who took the money: the capture audit row, keyed by order. Newest wins if
  // a retry wrote two.
  const orderIds = [...new Set(paymentRows.map((row) => row.orderId))];
  const captureAudits =
    orderIds.length > 0
      ? await database
          .select({ entityId: auditLogs.entityId, actorUserId: auditLogs.actorUserId, createdAt: auditLogs.createdAt })
          .from(auditLogs)
          .where(and(eq(auditLogs.orgId, orgId), eq(auditLogs.action, "payment_captured"), inArray(auditLogs.entityId, orderIds)))
          .orderBy(desc(auditLogs.createdAt))
      : [];
  const actorByOrder = new Map<string, string>();
  for (const row of captureAudits) {
    if (row.entityId && row.actorUserId && !actorByOrder.has(row.entityId)) actorByOrder.set(row.entityId, row.actorUserId);
  }

  const names = await staffNames(orgId, [
    ...new Set([...actorByOrder.values(), ...refundRows.map((row) => row.actorUserId).filter((id): id is string => id !== null)]),
  ]);
  const nameOf = (userId: string | undefined | null) => (userId ? (names.get(userId) ?? "Former staff member") : null);

  const ledger: PaymentRow[] = paymentRows.map((row) => ({
    id: row.id,
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    channel: row.channel,
    status: row.status,
    method: row.method,
    provider: row.provider,
    amount: paise(row.amount),
    feeAmount: paise(row.feeAmount),
    capturedBy: row.status === "CAPTURED" || row.status === "PARTIALLY_REFUNDED" || row.status === "REFUNDED" ? nameOf(actorByOrder.get(row.orderId)) : null,
    at: row.capturedAt ?? row.createdAt,
    refunded: refundedByPayment.get(row.id) ?? ZERO,
    providerPaymentId: row.providerPaymentId,
  }));

  const captured = ledger.filter((row) => row.status === "CAPTURED");
  const byMethodMap = new Map<PaymentMethod, { count: number; total: Paise }>();
  for (const row of captured) {
    const found = byMethodMap.get(row.method) ?? { count: 0, total: ZERO };
    byMethodMap.set(row.method, { count: found.count + 1, total: add(found.total, row.amount) });
  }

  const refundList: RefundRow[] = refundRows.map((row) => ({
    id: row.id,
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    amount: paise(row.amount),
    reason: row.reason,
    by: nameOf(row.actorUserId),
    at: row.createdAt,
  }));

  return {
    range,
    payments: ledger,
    refunds: refundList,
    capturedTotal: add(...captured.map((row) => row.amount)),
    capturedCount: captured.length,
    feeTotal: add(...captured.map((row) => row.feeAmount)),
    refundedTotal: add(...refundList.map((row) => row.amount)),
    byMethod: [...byMethodMap.entries()]
      .map(([method, value]) => ({ method, ...value }))
      .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0)),
  };
}
