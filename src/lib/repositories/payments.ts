import "server-only";

/**
 * Taking payment.
 *
 * The service layer between an order and a `PaymentProvider`. It owns the
 * consequences — the order's status, the invoice number, the rewards, the
 * audit trail — and the provider owns only the movement of money. §32's
 * shape, applied to payments.
 *
 * One settlement core (`settle`) serves cash at the counter and Razorpay
 * online; the two entry points below differ only in who is allowed to call
 * them and in how the provider is asked to capture. Roadmap 1.1–1.3.
 */

import { and, desc, eq, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, loyaltyAccounts, loyaltyTransactions, orderEvents, orders, payments, refunds } from "@/db/schema";
import { type Role, authorize } from "@/domain/permissions";
import { type Paise, ZERO, add, formatINR, paise, subtract } from "@/lib/money";
import { pointsEarned } from "@/lib/loyalty";
import { getLoyaltyConfig, getStampConfig } from "@/lib/loyalty/config";
import { awardStampForOrder, qualifyingStampSpend, redeemStampReward } from "./loyalty";
import { financialYear, invoiceNumber, parseInvoiceNumber } from "@/lib/invoice";
import { CASH_PROVIDER, type PaymentMethod, type PaymentResult, RAZORPAY_PROVIDER, getProvider } from "@/lib/payments";
import { withIdempotency } from "./idempotency";
import { canTransition } from "@/domain/order-status";
import { advanceOrder } from "./orders";

export type RecordPaymentResult =
  | { ok: true; paymentId: string; replayed: boolean }
  | { ok: false; error: string };

const METHOD_WORD: Record<PaymentMethod, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  NETBANKING: "Net banking",
  WALLET: "Wallet",
  OTHER: "Online",
};

/**
 * Creates the pending payment that a new order is waiting on.
 *
 * Called as part of placing the order. Without this an order sits in
 * PENDING_PAYMENT with nothing recording what it is waiting for, and the
 * counter has no row to settle against. When the caller has already made the
 * provider-side order (Razorpay, before the order row existed), it passes the
 * reference in and no second one is created.
 */
export async function createPendingPayment(input: {
  orgId: string;
  orderId: string;
  amount: Paise;
  provider?: string;
  method?: PaymentMethod;
  providerOrderId?: string | null;
}): Promise<{ id: string | null; providerOrderId: string | null }> {
  const providerName = input.provider ?? CASH_PROVIDER;
  const method = input.method ?? "CASH";
  let providerOrderId = input.providerOrderId ?? null;

  if (input.providerOrderId === undefined) {
    const provider = getProvider(providerName);
    const intent = await provider.createIntent({ orderId: input.orderId, amount: input.amount, method });
    providerOrderId = intent.providerOrderId;
  }

  const [row] = await db()
    .insert(payments)
    .values({
      orgId: input.orgId,
      orderId: input.orderId,
      status: "PENDING",
      method,
      amount: input.amount,
      provider: providerName,
      providerOrderId,
    })
    .returning();

  return { id: row?.id ?? null, providerOrderId };
}

/** Whether money has actually been captured against an order — answered by the payments table, never by the status. */
export async function isOrderPaid(orderId: string): Promise<boolean> {
  const [captured] = await db()
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.orderId, orderId), eq(payments.status, "CAPTURED")))
    .limit(1);
  return captured !== undefined;
}

/**
 * Records cash taken at the counter (or at the door) and moves the order to
 * PAID when it was waiting on payment.
 *
 * Taking money is a cashier's job, so `orders.update` is the permission. The
 * actor is recorded because cash is the one method with no external trail —
 * see the note in payments/cash.ts.
 *
 * Idempotent on the order: pressing "taken" twice does not book the money
 * twice, and the second press reports that it was already settled rather than
 * failing in a way that looks like the first press did not work.
 */
export async function recordCashPayment(input: {
  orderId: string;
  actorUserId: string;
  actorRoles: readonly Role[];
  /** What the customer handed over, when the till knows it. Must cover the amount due; the change is stored with the payment. */
  tendered?: Paise;
}): Promise<RecordPaymentResult> {
  try {
    authorize(input.actorRoles, "orders.update");
  } catch {
    return { ok: false, error: "You don't have permission to take payment." };
  }

  return settle({
    orderId: input.orderId,
    provider: CASH_PROVIDER,
    actorUserId: input.actorUserId,
    idempotencyKey: (order) => `cash-payment:${order.id}`,
    // The server decides what is owed. Nothing passes an amount in.
    amountDue: (order) => paise(order.grandTotal),
    capture: (order, amount) =>
      getProvider(CASH_PROVIDER).capture({ orderId: order.id, amount, actorUserId: input.actorUserId, tendered: input.tendered }),
    methodFor: () => "CASH",
    reasonFor: (amount) => `Cash received — ${formatINR(amount)}`,
  });
}

/**
 * Records a Razorpay payment the customer just made, or that Razorpay's
 * webhook reports. No staff actor: the customer paid, the gateway confirms.
 *
 * Idempotent on the Razorpay payment id, which is also unique on the
 * payments table — the Checkout handler and the webhook both arrive for the
 * same payment and exactly one row results. The amount due is what the
 * pending payment was opened for (the fee-inclusive, discounted, points-net
 * figure the Razorpay Order was created with), and the provider refuses a
 * capture that does not match it.
 */
export async function recordOnlinePayment(input: {
  orderId: string;
  providerPaymentId: string;
  /** From Checkout; omitted for a webhook, where the provider verifies by fetching the payment instead. */
  providerOrderId?: string;
  signature?: string;
}): Promise<RecordPaymentResult> {
  const database = db();
  const [pending] = await database
    .select()
    .from(payments)
    .where(and(eq(payments.orderId, input.orderId), eq(payments.provider, RAZORPAY_PROVIDER), eq(payments.status, "PENDING")))
    .orderBy(desc(payments.createdAt))
    .limit(1);

  const providerOrderId = input.providerOrderId ?? pending?.providerOrderId ?? undefined;

  const result = await settle({
    orderId: input.orderId,
    provider: RAZORPAY_PROVIDER,
    actorUserId: null,
    idempotencyKey: () => `razorpay-payment:${input.providerPaymentId}`,
    amountDue: (order) => (pending ? paise(pending.amount) : paise(order.grandTotal)),
    capture: (order, amount) =>
      getProvider(RAZORPAY_PROVIDER).capture({
        orderId: order.id,
        amount,
        actorUserId: null,
        providerPaymentId: input.providerPaymentId,
        providerOrderId,
        signature: input.signature,
      }),
    providerPaymentId: input.providerPaymentId,
    providerOrderId: providerOrderId ?? null,
    methodFor: (captured) => (typeof captured.payload?.method === "string" ? (captured.payload.method as PaymentMethod) : "OTHER"),
    reasonFor: (amount, method) => `Paid online (${METHOD_WORD[method]}) — ${formatINR(amount)}`,
  });

  // A refused capture is recorded on the pending row so the order page can say
  // "payment failed — retry" rather than sitting on a spinner. The order stays
  // PENDING_PAYMENT; nothing here can move it to PAID.
  if (!result.ok && pending) {
    await database
      .update(payments)
      .set({ failureReason: result.error, updatedAt: new Date() })
      .where(and(eq(payments.id, pending.id), eq(payments.status, "PENDING")));
  }
  return result;
}

/** Notes a failure Razorpay reported (Checkout's payment.failed, or the webhook) against the pending payment, without touching the order. */
export async function markOnlinePaymentFailed(input: { orderId: string; reason: string }): Promise<void> {
  const database = db();
  const [pending] = await database
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.orderId, input.orderId), eq(payments.provider, RAZORPAY_PROVIDER), eq(payments.status, "PENDING")))
    .orderBy(desc(payments.createdAt))
    .limit(1);
  if (!pending) return;
  await database
    .update(payments)
    .set({ failureReason: input.reason.slice(0, 250), updatedAt: new Date() })
    .where(eq(payments.id, pending.id));
}

/* ------------------------------------------------------------------ */
/* The settlement core                                                 */
/* ------------------------------------------------------------------ */

type OrderRow = typeof orders.$inferSelect;

interface Settlement {
  readonly orderId: string;
  readonly provider: string;
  readonly actorUserId: string | null;
  readonly idempotencyKey: (order: OrderRow) => string;
  readonly amountDue: (order: OrderRow) => Paise;
  readonly capture: (order: OrderRow, amount: Paise) => Promise<PaymentResult>;
  readonly methodFor: (captured: PaymentResult) => PaymentMethod;
  readonly reasonFor: (amount: Paise, method: PaymentMethod) => string;
  readonly providerPaymentId?: string;
  readonly providerOrderId?: string | null;
}

async function settle(settlement: Settlement): Promise<RecordPaymentResult> {
  const database = db();
  const [order] = await database.select().from(orders).where(eq(orders.id, settlement.orderId)).limit(1);
  if (!order) return { ok: false, error: "That order does not exist." };

  // Already settled. For a gateway, the same payment id arriving twice (the
  // Checkout handler and then the webhook) is the normal case and is success;
  // anything else against a paid order is refused.
  const [captured] = await database
    .select({ id: payments.id, providerPaymentId: payments.providerPaymentId })
    .from(payments)
    .where(and(eq(payments.orderId, order.id), eq(payments.status, "CAPTURED")))
    .limit(1);
  if (captured) {
    if (settlement.providerPaymentId && captured.providerPaymentId === settlement.providerPaymentId) {
      return { ok: true, paymentId: captured.id, replayed: true };
    }
    return { ok: false, error: "That order has already been paid." };
  }
  if (order.status === "PAID" || order.status === "COMPLETED") {
    return { ok: false, error: "That order has already been paid." };
  }

  const amount = settlement.amountDue(order);

  /*
   * Recording a payment is not a status transition.
   *
   * Payment and fulfilment progress are different axes. Cash on delivery is
   * taken at the door, by which point the order is OUT_FOR_DELIVERY — and
   * forcing it to PAID from there is a move the lifecycle rightly refuses,
   * which is how "cannot be marked paid" ended up in front of a cashier
   * holding the money.
   *
   * So: the payment is always recorded. The status only moves to PAID when the
   * order is still waiting on payment and has gone nowhere else. Whether an
   * order is paid is answered by the payments table, never by the status.
   */
  const movesToPaid = order.status === "PENDING_PAYMENT";

  const { result, replayed } = await withIdempotency(
    {
      key: settlement.idempotencyKey(order),
      operation: "recordPayment",
      orgId: order.orgId,
      request: { orderId: order.id, amount: amount.toString(), provider: settlement.provider, providerPaymentId: settlement.providerPaymentId ?? null },
    },
    async () => {
      const capturedResult = await settlement.capture(order, amount);
      if (!capturedResult.ok) return { ok: false as const, error: capturedResult.error ?? "The payment could not be recorded." };

      const method = settlement.methodFor(capturedResult);
      const feeAmount = typeof capturedResult.payload?.fee === "number" ? paise(capturedResult.payload.fee) : paise(0);
      const now = new Date();

      const [existing] = await database
        .select()
        .from(payments)
        .where(and(eq(payments.orderId, order.id), eq(payments.provider, settlement.provider), eq(payments.status, "PENDING")))
        .orderBy(desc(payments.createdAt))
        .limit(1);

      const paymentId = existing
        ? (
            await database
              .update(payments)
              .set({
                status: "CAPTURED",
                method,
                amount: capturedResult.capturedAmount,
                feeAmount,
                capturedAt: now,
                providerPaymentId: capturedResult.providerPaymentId ?? existing.providerPaymentId,
                providerOrderId: settlement.providerOrderId ?? existing.providerOrderId,
                providerPayload: capturedResult.payload,
                failureReason: null,
                updatedAt: now,
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
                method,
                amount: capturedResult.capturedAmount,
                feeAmount,
                provider: settlement.provider,
                providerPaymentId: capturedResult.providerPaymentId,
                providerOrderId: settlement.providerOrderId ?? null,
                capturedAt: now,
                providerPayload: capturedResult.payload,
              })
              .returning()
          )[0]?.id;

      /*
       * Issue the tax invoice number.
       *
       * On payment, not on placement: an invoice records a completed sale, and
       * numbering unpaid orders would leave gaps in a sequence that GST
       * requires to have none.
       *
       * The sequence is per financial year and per organization, found by
       * counting what has already been issued this year. Under real
       * concurrency this wants a database sequence rather than a count — two
       * simultaneous settlements could read the same number — but the unique
       * constraint on (org_id, invoice_number) turns that into a failed write
       * rather than a duplicate invoice, and one counter serves one queue.
       */
      const issuedAt = now;
      const year = financialYear(issuedAt);
      const issuedThisYear = await database
        .select({ invoiceNumber: orders.invoiceNumber })
        .from(orders)
        .where(and(eq(orders.orgId, order.orgId), like(orders.invoiceNumber, `${year}/%`)));

      const highest = issuedThisYear.reduce((max, row) => {
        const parsed = row.invoiceNumber ? parseInvoiceNumber(row.invoiceNumber) : null;
        return parsed && parsed.sequence > max ? parsed.sequence : max;
      }, 0);

      await database
        .update(orders)
        .set({
          ...(movesToPaid ? { status: "PAID" as const } : {}),
          invoiceNumber: order.invoiceNumber ?? invoiceNumber(issuedAt, highest + 1),
          invoicedAt: order.invoicedAt ?? issuedAt,
          updatedAt: issuedAt,
        })
        .where(eq(orders.id, order.id));

      /*
       * Points are awarded when the money actually arrives, not when the order
       * is placed.
       *
       * An order that is never paid for — abandoned at the counter, refused at
       * the door — must not leave points behind. Awarding on payment means the
       * balance only ever reflects money that came in.
       *
       * Earned on the food, not the delivery fee: paying 5% back on a rider's
       * petrol is giving away money on a cost rather than rewarding a purchase.
       */
      if (order.customerId) {
        const config = await getLoyaltyConfig();
        const qualifying = subtract(paise(order.grandTotal), paise(order.deliveryFee));
        const earned = pointsEarned(qualifying, config);

        if (earned > 0) {
          const [account] = await database
            .insert(loyaltyAccounts)
            .values({ orgId: order.orgId, customerId: order.customerId, pointsBalance: earned })
            .onConflictDoUpdate({
              target: loyaltyAccounts.customerId,
              set: { pointsBalance: sql`${loyaltyAccounts.pointsBalance} + ${earned}`, updatedAt: new Date() },
            })
            .returning();

          // Every movement is recorded, never a bare balance update — the same
          // principle as inventory in §24. A disputed balance can be explained.
          if (account) {
            await database.insert(loyaltyTransactions).values({
              orgId: order.orgId,
              accountId: account.id,
              points: earned,
              reason: `Order #${order.orderNumber}`,
              orderId: order.id,
            });
          }

          await database.update(orders).set({ pointsEarned: earned }).where(eq(orders.id, order.id));
        }
      }

      /*
       * FRYBIRD REWARDS — the stamp moves when the money actually arrives,
       * same as points and for the same reason: an order abandoned at the
       * counter must not leave a stamp behind.
       *
       * `awardStampForOrder` is idempotent on the order id by itself (a
       * unique constraint in the ledger), so a retried capture cannot mint
       * a second stamp even without this function's own idempotency
       * wrapper — belt and braces on the exact failure mode webhooks are
       * prone to.
       *
       * If this order carried a redeemed reward — chosen and priced at
       * checkout, see src/lib/cart — that reward is marked spent here,
       * at the same moment the discount it granted is actually charged.
       */
      if (order.customerId) {
        const stampConfig = await getStampConfig();
        const qualifying = qualifyingStampSpend(paise(order.grandTotal), paise(order.deliveryFee));
        await awardStampForOrder({
          orgId: order.orgId,
          customerId: order.customerId,
          orderId: order.id,
          qualifyingSpend: qualifying,
          config: stampConfig,
        });

        if (order.stampRewardId && order.stampRewardProductSlug) {
          await redeemStampReward({
            rewardId: order.stampRewardId,
            orgId: order.orgId,
            orderId: order.id,
            productSlug: order.stampRewardProductSlug,
          });
        }
      }

      // The event is written either way: money changing hands is a fact about
      // the order whether or not it also moved the status.
      await database.insert(orderEvents).values({
        orgId: order.orgId,
        orderId: order.id,
        fromStatus: order.status,
        toStatus: movesToPaid ? "PAID" : order.status,
        actorUserId: settlement.actorUserId,
        reason: settlement.reasonFor(capturedResult.capturedAmount, method),
      });

      // §52: money changing hands is a critical operation.
      await database.insert(auditLogs).values({
        orgId: order.orgId,
        locationId: order.locationId,
        actorUserId: settlement.actorUserId,
        action: "payment_captured",
        entity: "orders",
        entityId: order.id,
        before: { status: order.status },
        after: {
          status: movesToPaid ? "PAID" : order.status,
          method,
          provider: settlement.provider,
          amount: capturedResult.capturedAmount.toString(),
          providerPaymentId: capturedResult.providerPaymentId,
        },
      });

      return { ok: true as const, paymentId: paymentId ?? "" };
    },
  );

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, paymentId: result.paymentId, replayed };
}

/* ------------------------------------------------------------------ */
/* Refunds — roadmap 1.4                                               */
/* ------------------------------------------------------------------ */

export type RefundPaymentResult = { ok: true; refundId: string; orderId: string; fullyRefunded: boolean } | { ok: false; error: string };

/**
 * Gives money back.
 *
 * Online: Razorpay is asked to refund and the row is written only once it
 * agrees. Cash: the till hands it over and the row records who did. The
 * amount can never exceed what was captured less what has already gone
 * back; a full refund moves the order to REFUNDED (through `advanceOrder`,
 * which also voids the FRYBIRD REWARDS stamp) when the lifecycle allows the
 * move, and a partial one leaves the order where it is. Every refund lands
 * a `refunds` row, an `order_events` row and an audit row with the actor.
 */
export async function refundPayment(input: {
  paymentId: string;
  amount: Paise;
  reason: string;
  actorUserId: string;
  actorRoles: readonly Role[];
  orgId: string;
}): Promise<RefundPaymentResult> {
  try {
    authorize(input.actorRoles, "orders.refund");
  } catch {
    return { ok: false, error: "Refunds need a manager or the owner." };
  }
  if (input.amount <= ZERO) return { ok: false, error: "A refund has to be more than nothing." };
  const reason = input.reason.trim();
  if (reason.length < 3) return { ok: false, error: "Say why, in a few words." };

  const database = db();
  const [payment] = await database
    .select()
    .from(payments)
    .where(and(eq(payments.id, input.paymentId), eq(payments.orgId, input.orgId)))
    .limit(1);
  if (!payment) return { ok: false, error: "That payment does not exist." };
  if (payment.status !== "CAPTURED" && payment.status !== "PARTIALLY_REFUNDED") {
    return { ok: false, error: `Only a captured payment can be refunded; this one is ${payment.status.toLowerCase().replace("_", " ")}.` };
  }

  const [order] = await database.select().from(orders).where(eq(orders.id, payment.orderId)).limit(1);
  if (!order) return { ok: false, error: "That order does not exist." };

  const booked = await database.select({ amount: refunds.amount }).from(refunds).where(eq(refunds.paymentId, payment.id));
  const alreadyRefunded = booked.reduce((sum, row) => add(sum, paise(row.amount)), ZERO);
  const remaining = subtract(paise(payment.amount), alreadyRefunded);
  if (input.amount > remaining) {
    return { ok: false, error: `Only ${formatINR(remaining)} is left to refund on this payment.` };
  }

  const provider = getProvider(payment.provider);
  const refunded = await provider.refund({ providerPaymentId: payment.providerPaymentId, amount: input.amount, reason });
  if (!refunded.ok) return { ok: false, error: refunded.error ?? "The refund could not be made." };

  const now = new Date();
  const [row] = await database
    .insert(refunds)
    .values({
      orgId: input.orgId,
      paymentId: payment.id,
      orderId: order.id,
      amount: refunded.refundedAmount,
      reason,
      actorUserId: input.actorUserId,
      provider: payment.provider,
      providerRefundId: refunded.providerRefundId,
    })
    .returning({ id: refunds.id });
  if (!row) return { ok: false, error: "The refund was made but could not be recorded. Tell the owner." };

  const fullyRefunded = add(alreadyRefunded, refunded.refundedAmount) >= paise(payment.amount);
  await database
    .update(payments)
    .set({ status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED", updatedAt: now })
    .where(eq(payments.id, payment.id));

  await database.insert(auditLogs).values({
    orgId: input.orgId,
    locationId: order.locationId,
    actorUserId: input.actorUserId,
    action: "payment_refunded",
    entity: "payments",
    entityId: payment.id,
    before: { status: payment.status, refunded: alreadyRefunded.toString() },
    after: {
      status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED",
      amount: refunded.refundedAmount.toString(),
      reason,
      provider: payment.provider,
      providerRefundId: refunded.providerRefundId,
      orderId: order.id,
    },
  });

  // A full refund closes the order as REFUNDED where the lifecycle allows
  // it (paid, cooking, ready, out, completed). advanceOrder writes the event
  // and voids the stamp. A partial refund, or an order the graph will not
  // move, gets an event of its own so the trail still shows the money.
  if (fullyRefunded && canTransition(order.status, "REFUNDED", order.fulfilment)) {
    const moved = await advanceOrder({ orderId: order.id, to: "REFUNDED", actorUserId: input.actorUserId, orgId: input.orgId });
    if (!moved.ok) {
      await database.insert(orderEvents).values({ orgId: input.orgId, orderId: order.id, fromStatus: order.status, toStatus: order.status, actorUserId: input.actorUserId, reason: `Refunded ${formatINR(refunded.refundedAmount)} — ${reason}` });
    }
  } else {
    await database.insert(orderEvents).values({
      orgId: input.orgId,
      orderId: order.id,
      fromStatus: order.status,
      toStatus: order.status,
      actorUserId: input.actorUserId,
      reason: `${fullyRefunded ? "Refunded" : "Part refunded"} ${formatINR(refunded.refundedAmount)} — ${reason}`,
    });
  }

  return { ok: true, refundId: row.id, orderId: order.id, fullyRefunded };
}
