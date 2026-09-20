import "server-only";

/**
 * The WhatsApp order-update outbox (roadmap 7.2).
 *
 * `enqueueOrderUpdate` is what the order service calls when an order changes
 * status (the call site is orders.ts, owned by the integrator). It only writes
 * a row, in one insert with ON CONFLICT DO NOTHING against the unique
 * (org, order, channel, to_status): a retry, a double tap or a re-run job
 * enqueues once. Sending is separate: `dispatchPending` claims rows with
 * FOR UPDATE SKIP LOCKED, so two workers never send the same row, hands each to
 * the provider, and records the outcome. A provider never sets an order status.
 *
 * Transactional messages about an order the customer placed with their own
 * phone number; no phone (or an unusable one) means no row and no message.
 * Marketing consent is a different thing and is not consulted here.
 * The phone is never logged and never appears in a stored error.
 * Every query filters on org_id.
 */

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { notificationOutbox, orders, payments } from "@/db/schema";
import type { OrderStatus } from "@/domain/order-status";
import { paise } from "@/lib/money";
import { isNotifiableStatus, orderUpdateMessage, type PaymentPosition } from "@/lib/notifications/order-updates";
import { toWhatsAppNumber } from "@/lib/notifications/provider";
import type { WhatsappOrderProvider } from "@/lib/notifications/whatsapp-provider";

export const MAX_SEND_ATTEMPTS = 5;

export type EnqueueResult =
  | { readonly enqueued: true }
  | { readonly enqueued: false; readonly reason: "not_notifiable" | "order_not_found" | "no_phone" | "already_queued" };

export async function enqueueOrderUpdate(input: {
  readonly orgId: string;
  readonly orderId: string;
  readonly toStatus: OrderStatus;
  /** Origin the order link is built on, e.g. process.env.SITE_URL. Passed in so this stays testable. */
  readonly siteUrl: string;
}): Promise<EnqueueResult> {
  if (!isNotifiableStatus(input.toStatus)) return { enqueued: false, reason: "not_notifiable" };
  const database = db();

  const [order] = await database
    .select()
    .from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.orgId, input.orgId)))
    .limit(1);
  if (!order) return { enqueued: false, reason: "order_not_found" };

  const to = order.customerPhone ? toWhatsAppNumber(order.customerPhone) : null;
  if (!to) return { enqueued: false, reason: "no_phone" };

  const rows = await database
    .select({ status: payments.status, method: payments.method })
    .from(payments)
    .where(and(eq(payments.orderId, order.id), eq(payments.orgId, input.orgId)));
  const payment: PaymentPosition = rows.some((p) => p.status === "CAPTURED" || p.status === "PARTIALLY_REFUNDED")
    ? "PAID"
    : rows.some((p) => p.status === "PENDING" && p.method !== "CASH")
      ? "ONLINE_PENDING"
      : "COLLECT";

  const message = orderUpdateMessage({
    status: input.toStatus,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    fulfilment: order.fulfilment,
    payment,
    total: paise(order.grandTotal),
    link: `${input.siteUrl.replace(/\/$/, "")}/order/${order.id}`,
  });
  if (!message) return { enqueued: false, reason: "not_notifiable" };

  const inserted = await database
    .insert(notificationOutbox)
    .values({ orgId: input.orgId, orderId: order.id, toStatus: input.toStatus, template: message.template, toPhone: to, body: message.body })
    .onConflictDoNothing()
    .returning({ id: notificationOutbox.id });
  return inserted.length > 0 ? { enqueued: true } : { enqueued: false, reason: "already_queued" };
}

export interface DispatchSummary {
  readonly sent: number;
  readonly failed: number;
  readonly retryLater: number;
}

export async function dispatchPending(input: {
  readonly orgId: string;
  readonly provider: WhatsappOrderProvider;
  readonly limit?: number;
}): Promise<DispatchSummary> {
  const limit = input.limit ?? 20;
  return db().transaction(async (tx) => {
    const claimed = await tx
      .select()
      .from(notificationOutbox)
      .where(and(eq(notificationOutbox.orgId, input.orgId), eq(notificationOutbox.status, "PENDING")))
      .orderBy(asc(notificationOutbox.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });

    let sent = 0;
    let failed = 0;
    let retryLater = 0;
    for (const row of claimed) {
      const result = await input.provider
        .send({ to: row.toPhone, template: row.template, body: row.body, idempotencyKey: row.id })
        .catch(() => ({ ok: false as const, retryable: true, error: "provider threw" }));
      const where = and(eq(notificationOutbox.id, row.id), eq(notificationOutbox.orgId, input.orgId));
      if (result.ok) {
        await tx
          .update(notificationOutbox)
          .set({ status: "SENT", attempts: row.attempts + 1, provider: input.provider.name, providerMessageId: result.providerMessageId, sentAt: sql`now()`, lastError: null })
          .where(where);
        sent++;
        continue;
      }
      const attempts = row.attempts + 1;
      const giveUp = !result.retryable || attempts >= MAX_SEND_ATTEMPTS;
      await tx
        .update(notificationOutbox)
        .set({ status: giveUp ? "FAILED" : "PENDING", attempts, provider: input.provider.name, lastError: result.error.slice(0, 200) })
        .where(where);
      if (giveUp) failed++;
      else retryLater++;
    }
    return { sent, failed, retryLater };
  });
}
