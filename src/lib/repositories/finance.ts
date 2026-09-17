import "server-only";

/**
 * The payments ledger — money that actually moved, one row per payment.
 *
 * Read-only. This is deliberately NOT a second definition of revenue:
 * revenue stays `analytics.ts`'s (an order's `taxableTotal` — net of GST —
 * once it has a captured payment). What this shows is the payment records
 * themselves — amount, method, provider fee, who captured it — which is the
 * surface a manager reads to check the till, not the dashboard figure. The
 * two are labelled differently on screen for that reason ("captured", never
 * "revenue").
 *
 * "Who captured" comes from the `payment_captured` audit row
 * `recordCashPayment` already writes (`payments.ts`), resolved to a display
 * name the same way `listActiveOrders` resolves "placed by". Nothing here
 * writes a payment, a refund, or an audit row.
 */

import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { type REFUND_STATUSES, auditLogs, memberships, orders, payments, refunds } from "@/db/schema";
import type { OrderChannel } from "@/domain/order-channel";
import type { DateRange } from "@/lib/dates";
import { type RefundStatus, isStaleReserved, refundDate, refundsByPayment, summariseRefunds } from "@/lib/finance/refunds";
import { type Paise, ZERO, add, paise } from "@/lib/money";

// The pure rules' statuses and the column's must be the same set.
type SameRefundStatuses = [RefundStatus] extends [(typeof REFUND_STATUSES)[number]] ? ([(typeof REFUND_STATUSES)[number]] extends [RefundStatus] ? true : never) : never;
const refundStatusesMatch: SameRefundStatuses = true;
void refundStatusesMatch;

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
  /** What has gone back on this payment: SUCCEEDED refunds only. */
  readonly refunded: Paise;
  /**
   * Held by refunds still RESERVED (approved, money not yet back). Never part
   * of `refunded`, but it does count against what is left to refund:
   * refundable = amount − refunded − refundReserved.
   */
  readonly refundReserved: Paise;
  readonly providerPaymentId: string | null;
}

export interface RefundRow {
  readonly id: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly amount: Paise;
  readonly reason: string;
  readonly by: string | null;
  readonly status: RefundStatus;
  readonly provider: string;
  /** When the money went back for SUCCEEDED (`finalized_at`); when it was asked for otherwise. */
  readonly at: Date;
  /** A RESERVED refund past its provider's limit (15 min cash, 60 min online). */
  readonly stale: boolean;
}

export interface PaymentsLedger {
  readonly range: DateRange;
  readonly payments: readonly PaymentRow[];
  /**
   * SUCCEEDED refunds finalized in the range, FAILED refunds asked for in the
   * range, and every RESERVED refund whenever it started — an open refund is
   * a question for now, not for a period.
   */
  readonly refunds: readonly RefundRow[];
  /** Captured payments only — pending and failed are listed but never summed. */
  readonly capturedTotal: Paise;
  readonly capturedCount: number;
  readonly feeTotal: Paise;
  /** Σ SUCCEEDED refunds finalized in the range. RESERVED and FAILED are never in it. */
  readonly refundedTotal: Paise;
  readonly refundedCount: number;
  /** Σ RESERVED refunds, open now: held, not returned. */
  readonly reservedRefundTotal: Paise;
  readonly reservedRefundCount: number;
  readonly staleReservedRefundCount: number;
  readonly failedRefundCount: number;
  readonly byMethod: readonly { method: PaymentMethod; count: number; total: Paise }[];
}

/** Refund rows listed on the screen; the refund totals are never capped. */
const REFUND_LIST_LIMIT = 200;

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
export async function getPaymentsLedger(orgId: string, range: DateRange, limit = 500, now: Date = new Date()): Promise<PaymentsLedger> {
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

  // Refunds against the payments in view, whenever they were made — a refund
  // next month still reduces what this month's payment can give back.
  // SUCCEEDED is what went back; RESERVED is held; FAILED moved nothing.
  const paymentIds = paymentRows.map((row) => row.id);
  const byPayment =
    paymentIds.length > 0
      ? refundsByPayment(
          (
            await database
              .select({ paymentId: refunds.paymentId, status: refunds.status, amount: refunds.amount })
              .from(refunds)
              .where(and(eq(refunds.orgId, orgId), inArray(refunds.paymentId, paymentIds)))
          ).map((row) => ({ paymentId: row.paymentId, status: row.status, amount: paise(row.amount) })),
        )
      : new Map<string, { readonly refunded: Paise; readonly reserved: Paise }>();

  // Each status on its own clock: SUCCEEDED by when the money went back,
  // FAILED by when it was asked for, RESERVED whenever it started.
  const refundRows = await database
    .select({
      id: refunds.id,
      orderId: refunds.orderId,
      orderNumber: orders.orderNumber,
      amount: refunds.amount,
      reason: refunds.reason,
      actorUserId: refunds.actorUserId,
      status: refunds.status,
      provider: refunds.provider,
      createdAt: refunds.createdAt,
      finalizedAt: refunds.finalizedAt,
    })
    .from(refunds)
    .innerJoin(orders, and(eq(orders.id, refunds.orderId), eq(orders.orgId, orgId)))
    .where(
      and(
        eq(refunds.orgId, orgId),
        or(
          and(eq(refunds.status, "SUCCEEDED"), gte(refunds.finalizedAt, range.from), lt(refunds.finalizedAt, range.to)),
          and(eq(refunds.status, "FAILED"), gte(refunds.createdAt, range.from), lt(refunds.createdAt, range.to)),
          eq(refunds.status, "RESERVED"),
        ),
      ),
    )
    .orderBy(desc(sql`coalesce(${refunds.finalizedAt}, ${refunds.createdAt})`));

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
    ...new Set([...actorByOrder.values(), ...refundRows.slice(0, REFUND_LIST_LIMIT).map((row) => row.actorUserId).filter((id): id is string => id !== null)]),
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
    refunded: byPayment.get(row.id)?.refunded ?? ZERO,
    refundReserved: byPayment.get(row.id)?.reserved ?? ZERO,
    providerPaymentId: row.providerPaymentId,
  }));

  const captured = ledger.filter((row) => row.status === "CAPTURED");
  const byMethodMap = new Map<PaymentMethod, { count: number; total: Paise }>();
  for (const row of captured) {
    const found = byMethodMap.get(row.method) ?? { count: 0, total: ZERO };
    byMethodMap.set(row.method, { count: found.count + 1, total: add(found.total, row.amount) });
  }

  // The totals read every matching row; only the list shown is capped.
  const refundList: RefundRow[] = refundRows.slice(0, REFUND_LIST_LIMIT).map((row) => ({
    id: row.id,
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    amount: paise(row.amount),
    reason: row.reason,
    by: nameOf(row.actorUserId),
    status: row.status,
    provider: row.provider,
    at: refundDate(row),
    stale: isStaleReserved(row, now),
  }));
  const refundSummary = summariseRefunds(
    refundRows.map((row) => ({ status: row.status, amount: paise(row.amount), provider: row.provider, createdAt: row.createdAt, finalizedAt: row.finalizedAt })),
    now,
  );

  return {
    range,
    payments: ledger,
    refunds: refundList,
    capturedTotal: add(...captured.map((row) => row.amount)),
    capturedCount: captured.length,
    feeTotal: add(...captured.map((row) => row.feeAmount)),
    refundedTotal: refundSummary.refundedTotal,
    refundedCount: refundSummary.refundedCount,
    reservedRefundTotal: refundSummary.reservedTotal,
    reservedRefundCount: refundSummary.reservedCount,
    staleReservedRefundCount: refundSummary.staleReservedCount,
    failedRefundCount: refundSummary.failedCount,
    byMethod: [...byMethodMap.entries()]
      .map(([method, value]) => ({ method, ...value }))
      .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0)),
  };
}
