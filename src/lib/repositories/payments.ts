import "server-only";

/**
 * Taking payment.
 *
 * The service layer between an order and a `PaymentProvider`. It owns the
 * consequences — the order's status, the audit trail — and the provider owns
 * only the movement of money. §32's shape, applied to payments.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, orderEvents, orders, payments } from "@/db/schema";
import { assertTransition } from "@/domain/order-status";
import { type Role, authorize } from "@/domain/permissions";
import { type Paise, formatINR, paise } from "@/lib/money";
import { CASH_PROVIDER, getProvider } from "@/lib/payments";
import { withIdempotency } from "./idempotency";

export type RecordPaymentResult =
  | { ok: true; paymentId: string; replayed: boolean }
  | { ok: false; error: string };

/**
 * Creates the pending payment that a new order is waiting on.
 *
 * Called as part of placing the order. Without this an order sits in
 * PENDING_PAYMENT with nothing recording what it is waiting for, and the
 * counter has no row to settle against.
 */
export async function createPendingPayment(input: {
  orgId: string;
  orderId: string;
  amount: Paise;
  provider?: string;
}): Promise<string | null> {
  const providerName = input.provider ?? CASH_PROVIDER;
  const provider = getProvider(providerName);
  const intent = await provider.createIntent({ orderId: input.orderId, amount: input.amount, method: "CASH" });

  const [row] = await db()
    .insert(payments)
    .values({
      orgId: input.orgId,
      orderId: input.orderId,
      status: "PENDING",
      method: intent.method,
      amount: intent.amount,
      provider: providerName,
      providerOrderId: intent.providerOrderId,
    })
    .returning();

  return row?.id ?? null;
}

/**
 * Records cash taken at the counter and moves the order to PAID.
 *
 * Needs `orders.refund`-adjacent trust: taking money is a cashier's job, so
 * `orders.update` is the permission. The actor is recorded because cash is the
 * one method with no external trail — see the note in payments/cash.ts.
 *
 * Idempotent on the order: pressing "taken" twice does not book the money
 * twice, and the second press reports that it was already settled rather than
 * failing in a way that looks like the first press did not work.
 */
export async function recordCashPayment(input: {
  orderId: string;
  actorUserId: string;
  actorRoles: readonly Role[];
}): Promise<RecordPaymentResult> {
  try {
    authorize(input.actorRoles, "orders.update");
  } catch {
    return { ok: false, error: "You don't have permission to take payment." };
  }

  const database = db();
  const [order] = await database.select().from(orders).where(eq(orders.id, input.orderId)).limit(1);
  if (!order) return { ok: false, error: "That order does not exist." };

  if (order.status === "PAID" || order.status === "COMPLETED") {
    return { ok: false, error: "That order has already been paid." };
  }

  // The server decides what is owed. Nothing passes an amount in.
  const amount = paise(order.grandTotal);

  try {
    assertTransition(order.status, "PAID", order.fulfilment);
  } catch {
    return { ok: false, error: `An order that is ${order.status} cannot be marked paid.` };
  }

  const { result, replayed } = await withIdempotency(
    {
      key: `cash-payment:${order.id}`,
      operation: "recordCashPayment",
      orgId: order.orgId,
      request: { orderId: order.id, amount: amount.toString() },
    },
    async () => {
      const provider = getProvider(CASH_PROVIDER);
      const captured = await provider.capture({
        orderId: order.id,
        amount,
        actorUserId: input.actorUserId,
      });

      if (!captured.ok) return { ok: false as const, error: captured.error ?? "The payment could not be recorded." };

      const [existing] = await database
        .select()
        .from(payments)
        .where(and(eq(payments.orderId, order.id), eq(payments.status, "PENDING")))
        .limit(1);

      const paymentId = existing
        ? (
            await database
              .update(payments)
              .set({
                status: "CAPTURED",
                capturedAt: new Date(),
                providerPayload: captured.payload,
                updatedAt: new Date(),
              })
              .where(eq(payments.id, existing.id))
              .returning()
          )[0]?.id
        : (
            await database
              .insert(payments)
              .values({
                orgId: order.orgId,
                orderId: order.id,
                status: "CAPTURED",
                method: "CASH",
                amount,
                provider: CASH_PROVIDER,
                capturedAt: new Date(),
                providerPayload: captured.payload,
              })
              .returning()
          )[0]?.id;

      await database
        .update(orders)
        .set({ status: "PAID", updatedAt: new Date() })
        .where(eq(orders.id, order.id));

      await database.insert(orderEvents).values({
        orgId: order.orgId,
        orderId: order.id,
        fromStatus: order.status,
        toStatus: "PAID",
        actorUserId: input.actorUserId,
        reason: `Cash taken at the counter — ${formatINR(amount)}`,
      });

      // §52: money changing hands is a critical operation.
      await database.insert(auditLogs).values({
        orgId: order.orgId,
        locationId: order.locationId,
        actorUserId: input.actorUserId,
        action: "payment_captured",
        entity: "orders",
        entityId: order.id,
        before: { status: order.status },
        after: { status: "PAID", method: "CASH", amount: amount.toString() },
      });

      return { ok: true as const, paymentId: paymentId ?? "" };
    },
  );

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, paymentId: result.paymentId, replayed };
}
