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

import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, loyaltyAccounts, loyaltyTransactions, orderEvents, orders, payments, refunds } from "@/db/schema";
import { type Role, authorize, can } from "@/domain/permissions";
import { type Paise, ZERO, add, formatINR, paise, subtract } from "@/lib/money";
import { pointsEarned } from "@/lib/loyalty";
import { getLoyaltyConfig, getStampConfig } from "@/lib/loyalty/config";
import { awardStampForOrderInTx, qualifyingStampSpend, redeemStampRewardInTx } from "./loyalty";
import { financialYear, invoiceNumber, parseInvoiceNumber } from "@/lib/invoice";
import { CASH_PROVIDER, type PaymentMethod, type PaymentResult, RAZORPAY_PROVIDER, getProvider } from "@/lib/payments";
import { withIdempotency } from "./idempotency";
import { canTransition, isTerminal } from "@/domain/order-status";
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
 * One narrow exception, cash at the door (card ord-4): `completeDelivery`
 * passes `via: "delivery"`, and then `delivery.complete` — all a RIDER holds —
 * is enough, but only for a DELIVERY order that is OUT_FOR_DELIVERY, checked
 * on the org-scoped read and again under settle's order-row lock. The rider
 * stays the recorded actor and the amount is still the server's. No other
 * caller passes the flag, so every other path still needs `orders.update`.
 *
 * Idempotent on the order: pressing "taken" twice does not book the money
 * twice, and the second press reports that it was already settled rather than
 * failing in a way that looks like the first press did not work.
 */
export async function recordCashPayment(input: {
  orderId: string;
  actorUserId: string;
  actorRoles: readonly Role[];
  /** The acting staff member's own org — enforced against the order, not trusted from it. See `Settlement.orgId`. */
  orgId: string;
  /** What the customer handed over, when the till knows it. Must cover the amount due; the change is stored with the payment. */
  tendered?: Paise;
  /**
   * Set only by `completeDelivery`: cash taken at the door by whoever closes
   * the delivery. Lets `delivery.complete` stand in for `orders.update`, for
   * an OUT_FOR_DELIVERY delivery order and nothing else.
   */
  via?: "delivery";
}): Promise<RecordPaymentResult> {
  const deliveryCashOnly = !can(input.actorRoles, "orders.update");
  if (deliveryCashOnly && !(input.via === "delivery" && can(input.actorRoles, "delivery.complete"))) {
    return { ok: false, error: "You don't have permission to take payment." };
  }

  return settle({
    orderId: input.orderId,
    orgId: input.orgId,
    orderGuard: deliveryCashOnly ? deliveryCashGuard : undefined,
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

/** The only orders `delivery.complete` may take cash for: a delivery on the road. */
function deliveryCashGuard(order: OrderRow): string | null {
  if (order.fulfilment !== "DELIVERY" || order.status !== "OUT_FOR_DELIVERY") {
    return "Only a delivery that is out for delivery can take cash at the door.";
  }
  return null;
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
  /**
   * The caller's own org, when there is a staff session to check it against
   * — cash at the counter or the door. Omitted for the Razorpay/webhook path,
   * which has no staff session at all; that path's boundary is the
   * provider's cryptographic signature over a specific payment id, not org
   * membership, so there is nothing meaningful to compare it against.
   *
   * When present, this is enforced on the very first read: every other
   * order-mutating function in this codebase (`refundPayment`,
   * `advanceOrder`, `completeDelivery`) fetches its order scoped by
   * `orgId`, and cash settlement was the one exception — a staff member
   * could otherwise settle any order in the database by UUID alone, with
   * only a role check and no tenant check at all.
   */
  readonly orgId?: string;
  /**
   * An extra condition the order must meet before any money is taken — a
   * refusal message, or null to proceed. Checked on the org-scoped first read
   * and again on the row held under the lock, before the settlement gate, so
   * a narrower authorization (cash at the door) can never reach an order it
   * does not cover. Refusals are never stored by withIdempotency.
   */
  readonly orderGuard?: (order: OrderRow) => string | null;
}

/**
 * Payment statuses meaning money was taken against the order at some point.
 * A refund does not make an order payable again: the refund gave back money
 * for this order, and booking a fresh capture on top of it is how cash gets
 * taken twice for one meal (F13, ref-1 DATABASE-RELIABILITY).
 */
const MONEY_TAKEN_STATUSES = ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"] as const;

type PriorPayment = { id: string; status: (typeof payments.$inferSelect)["status"]; providerPaymentId: string | null };

type SettlementGate =
  | { kind: "proceed" }
  | { kind: "replay"; paymentId: string }
  /** Another settlement's capture is committed. Stored by withIdempotency when decided inside it — pay-4's behaviour, unchanged. */
  | { kind: "alreadyPaid" }
  /** Decided from a refund or the order's status. Never stored: see `SettlementRefused`. */
  | { kind: "refused"; error: string };

/**
 * The one decision of whether `settle` may take money for an order. The
 * pre-transaction fast path and the authoritative re-check under the order
 * row lock both call this, so the two cannot drift apart.
 *
 * Order of the checks matters:
 *  1. Any refund against the order → refused. Never a replay, even of the
 *     very settlement that was later refunded: "taken" is no longer true.
 *  2. A captured payment → the same settlement arriving again is a replay
 *     (the Checkout handler and the webhook; a cashier's double-tap);
 *     anything else is "already paid".
 *  3. PAID/COMPLETED without a capture → "already paid", as before.
 *  4. Any other terminal status (`TERMINAL_STATUSES` in
 *     src/domain/order-status.ts: CANCELLED, FAILED, REFUNDED) → refused. No
 *     transition leaves these, so no money and no loyalty may land on them
 *     (red-team ord-2 item 4).
 */
function settlementGate(orderStatus: OrderRow["status"], prior: readonly PriorPayment[], settlement: Settlement): SettlementGate {
  if (prior.some((payment) => payment.status === "REFUNDED" || payment.status === "PARTIALLY_REFUNDED")) {
    // "already been paid" is kept in the wording on purpose: completeDelivery
    // and the Razorpay webhook both treat that phrase as final, which is
    // exactly right here — the order was paid, and nothing more is owed.
    return { kind: "refused", error: "That order has already been paid and refunded, so it cannot take payment again. Ring up a new order instead." };
  }
  const captured = prior.find((payment) => payment.status === "CAPTURED");
  if (captured) {
    const sameSettlement = settlement.providerPaymentId ? captured.providerPaymentId === settlement.providerPaymentId : !captured.providerPaymentId;
    return sameSettlement ? { kind: "replay", paymentId: captured.id } : { kind: "alreadyPaid" };
  }
  if (orderStatus === "PAID" || orderStatus === "COMPLETED") return { kind: "alreadyPaid" };
  if (isTerminal(orderStatus)) {
    return { kind: "refused", error: `That order is ${orderStatus.toLowerCase()}, so it cannot take payment.` };
  }
  return { kind: "proceed" };
}

const ALREADY_PAID = "That order has already been paid.";

/**
 * A refusal decided under the lock from a refund or the order's status.
 *
 * Thrown rather than returned so withIdempotency does not store it: its
 * catch releases the claim, settle() turns this back into `{ ok: false }`,
 * and every later call re-derives the answer from the database (the fast
 * path gives the same refusal) instead of replaying a snapshot forever that
 * could only ever match the database or contradict it.
 */
class SettlementRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettlementRefused";
  }
}

async function settle(settlement: Settlement): Promise<RecordPaymentResult> {
  const database = db();
  const [order] = await database
    .select()
    .from(orders)
    .where(settlement.orgId ? and(eq(orders.id, settlement.orderId), eq(orders.orgId, settlement.orgId)) : eq(orders.id, settlement.orderId))
    .limit(1);
  if (!order) return { ok: false, error: "That order does not exist." };

  const guardRefusal = settlement.orderGuard?.(order);
  if (guardRefusal) return { ok: false, error: guardRefusal };

  /*
   * Already settled. For a gateway, the same payment id arriving twice (the
   * Checkout handler and then the webhook) is the normal case and is
   * success; a genuinely different attempt against a paid order is refused.
   *
   * Cash has no provider payment id at all (cashProvider.capture always
   * returns `providerPaymentId: null`), so a captured payment with none is
   * itself the cash case — and this order is only ever settled once, by
   * design (`recordCashPayment`'s own doc comment: "pressing 'taken' twice
   * ... reports that it was already settled"). Requiring an exact id match
   * only for the provider that actually has one, rather than requiring
   * `settlement.providerPaymentId` to be truthy at all, means a cashier's
   * double-tap after a *successful* settlement gets the success reply that
   * comment promises, not a confusing failure — the two are provably the
   * same settlement precisely because cash is captured once per order.
   *
   * This check being reliable at all — "captured" implies "the full
   * settlement below actually finished" — depends on everything from the
   * payment row onward being one atomic transaction (see below). Before
   * that was true, this same check was the bug: a captured-but-incomplete
   * settlement (a crash between the payment row committing and the rest
   * finishing) would hit this and report success without ever completing
   * the invoice, the status, or the loyalty awards it skipped.
   */
  const prior = await database
    .select({ id: payments.id, status: payments.status, providerPaymentId: payments.providerPaymentId })
    .from(payments)
    .where(and(eq(payments.orderId, order.id), eq(payments.orgId, order.orgId), inArray(payments.status, MONEY_TAKEN_STATUSES)));
  const gate = settlementGate(order.status, prior, settlement);
  if (gate.kind === "replay") return { ok: true, paymentId: gate.paymentId, replayed: true };
  if (gate.kind === "alreadyPaid") return { ok: false, error: ALREADY_PAID };
  if (gate.kind === "refused") return { ok: false, error: gate.error };

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
   * That decision is made inside the transaction below, from the row as it
   * is under the lock — not from the read above, which may be stale by then.
   */

  const settled = await withIdempotency(
    {
      key: settlement.idempotencyKey(order),
      operation: "recordPayment",
      orgId: order.orgId,
      request: { orderId: order.id, amount: amount.toString(), provider: settlement.provider, providerPaymentId: settlement.providerPaymentId ?? null },
    },
    async () => {
      const capturedResult = await settlement.capture(order, amount);
      if (!capturedResult.ok) return { ok: false as const, error: capturedResult.error ?? "The payment could not be recorded." };

      // Reads only, unaffected by anything the transaction below writes —
      // fetched before it opens rather than inside it on purpose.
      const loyaltyConfig = order.customerId ? await getLoyaltyConfig() : null;
      const stampConfig = order.customerId ? await getStampConfig() : null;

      /*
       * Everything from here on — the payment row, the invoice number, the
       * PAID transition, the loyalty award, the stamp reward, the event and
       * audit rows — is one atomic unit. `settlement.capture` above is the
       * one thing that must NOT be in here: it is a real network call for
       * Razorpay (or a pure, side-effect-free check for cash), and a DB
       * transaction has no business holding a connection and locks open
       * across one. Confirmed idempotent to repeat on a retry either way —
       * cash's capture writes nothing at all, and Razorpay's only ever
       * fetches and re-verifies an already-captured payment, never charges.
       *
       * Before this was one transaction, a crash after the payment row
       * committed but before the rest finished (the invoice number was the
       * one actually observed to do this, but anything after the payment
       * row could) left a CAPTURED payment on an order that was otherwise
       * never invoiced, never marked PAID, and never given its loyalty
       * award — and the "already captured" check above would then report
       * that half-finished settlement as a success forever after, since it
       * had no way to tell "captured" from "captured and everything else
       * finished too." Wrapping it all together makes those the same
       * thing: either this whole block commits, or none of it does, and a
       * retry after a rollback starts from a genuinely clean slate.
       */
      return database.transaction(async (tx) => {
        /*
         * Serialize concurrent settlements of the same order.
         *
         * The "already captured" check before withIdempotency runs outside
         * any transaction, so two settlements arriving together — cash at
         * the counter while the customer pays online, each under its own
         * idempotency key — both used to pass it before either committed,
         * and both captured: one meal, charged twice. Locking the order row
         * here and re-checking under the lock makes the loser wait for the
         * winner's commit and then see it.
         *
         * Lock order, kept consistent across the codebase: the ORDER row is
         * always locked first (advanceOrder in orders.ts does the same),
         * and payment rows are only ever written after it. refundPayment
         * locks a PAYMENTS row and then merely reads the order without
         * locking it, so no path takes these two locks in the opposite
         * order and no cycle exists.
         */
        const [locked] = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.id, order.id), eq(orders.orgId, order.orgId)))
          .for("update")
          .limit(1);
        if (!locked) return { ok: false as const, error: "That order does not exist." };

        // Re-checked on the locked row: the order may have moved since the first read.
        const lockedGuardRefusal = settlement.orderGuard?.(locked);
        if (lockedGuardRefusal) throw new SettlementRefused(lockedGuardRefusal);

        // The same gate as the pre-transaction fast path — but this one is
        // authoritative, because it runs under the lock: a capture, a refund
        // or a cancellation that committed while this call waited is seen.
        const priorUnderLock = await tx
          .select({ id: payments.id, status: payments.status, providerPaymentId: payments.providerPaymentId })
          .from(payments)
          .where(and(eq(payments.orderId, order.id), eq(payments.orgId, order.orgId), inArray(payments.status, MONEY_TAKEN_STATUSES)));
        const lockedGate = settlementGate(locked.status, priorUnderLock, settlement);
        if (lockedGate.kind === "replay") return { ok: true as const, paymentId: lockedGate.paymentId };
        if (lockedGate.kind === "alreadyPaid") return { ok: false as const, error: ALREADY_PAID };
        if (lockedGate.kind === "refused") throw new SettlementRefused(lockedGate.error);

        // See the comment above the transaction: decided from the locked
        // row, so a status that moved since the first read is respected.
        const movesToPaid = locked.status === "PENDING_PAYMENT";

        const method = settlement.methodFor(capturedResult);
        const feeAmount = typeof capturedResult.payload?.fee === "number" ? paise(capturedResult.payload.fee) : paise(0);
        const now = new Date();

        const [existing] = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.orderId, order.id), eq(payments.orgId, order.orgId), eq(payments.provider, settlement.provider), eq(payments.status, "PENDING")))
          .orderBy(desc(payments.createdAt))
          .limit(1);

        const paymentId = existing
          ? (
              await tx
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
                .where(and(eq(payments.id, existing.id), eq(payments.orgId, order.orgId)))
                .returning()
            )[0]?.id
          : (
              await tx
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
         * counting what has already been issued this year — a real database
         * sequence would be cleaner, but would need one per (org, financial
         * year), created on demand, for a single-column figure that only
         * needs to be right, not fast (tracked as a follow-up, not done here).
         * The unique constraint on (org_id, invoice_number) turns two
         * simultaneous settlements reading the same count into a failed
         * write, not a duplicate invoice, and retrying on that specific
         * conflict — recomputing the count fresh each attempt — is the same
         * idiom `insertOrder`'s own order-number collision already uses,
         * just below in this same file's sibling `orders.ts`.
         *
         * Run as a nested transaction (a real Postgres SAVEPOINT under
         * Drizzle's postgres-js driver) rather than directly against `tx`:
         * a failed statement aborts a transaction until it is rolled back,
         * so retrying the same statement again on `tx` itself after a
         * 23505 would just fail again with "current transaction is
         * aborted" — the savepoint gives each attempt its own rollback
         * point without discarding the payment row already written above.
         */
        const issuedAt = now;
        const year = financialYear(issuedAt);
        const settlingOrder = locked; // the row as held under the lock — its invoiceNumber/invoicedAt are current, and the closures below keep TS's non-undefined narrowing

        // Recount-and-increment means a fully adversarial burst of N
        // concurrent settlements can force the unluckiest one through up to
        // N-1 retries — every round only the single writer that lands first
        // survives, and everyone else recomputes the same next number and
        // collides again together. 10 attempts comfortably covers a busier
        // burst than "single owner-operator, one location" will ever produce
        // at the counter; each retry is one cheap select+update, not
        // something worth being stingy about.
        const MAX_INVOICE_NUMBER_ATTEMPTS = 10;
        for (let attempt = 0; attempt < MAX_INVOICE_NUMBER_ATTEMPTS; attempt += 1) {
          try {
            await tx.transaction(async (tx2) => {
              const issuedThisYear = await tx2
                .select({ invoiceNumber: orders.invoiceNumber })
                .from(orders)
                .where(and(eq(orders.orgId, settlingOrder.orgId), like(orders.invoiceNumber, `${year}/%`)));

              const highest = issuedThisYear.reduce((max, row) => {
                const parsed = row.invoiceNumber ? parseInvoiceNumber(row.invoiceNumber) : null;
                return parsed && parsed.sequence > max ? parsed.sequence : max;
              }, 0);

              await tx2
                .update(orders)
                .set({
                  ...(movesToPaid ? { status: "PAID" as const } : {}),
                  invoiceNumber: settlingOrder.invoiceNumber ?? invoiceNumber(issuedAt, highest + 1),
                  invoicedAt: settlingOrder.invoicedAt ?? issuedAt,
                  updatedAt: issuedAt,
                })
                .where(and(eq(orders.id, settlingOrder.id), eq(orders.orgId, settlingOrder.orgId)));
            });
            break;
          } catch (error) {
            // 23505 is unique_violation — another settlement claimed the
            // same invoice number in between the read above and this write.
            // Anything else is a real failure.
            const code = (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
            if (code !== "23505" || attempt === MAX_INVOICE_NUMBER_ATTEMPTS - 1) throw error;
          }
        }

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
        if (order.customerId && loyaltyConfig) {
          const qualifying = subtract(paise(order.grandTotal), paise(order.deliveryFee));
          const earned = pointsEarned(qualifying, loyaltyConfig);

          if (earned > 0) {
            const [account] = await tx
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
              await tx.insert(loyaltyTransactions).values({
                orgId: order.orgId,
                accountId: account.id,
                points: earned,
                reason: `Order #${order.orderNumber}`,
                orderId: order.id,
              });
            }

            await tx.update(orders).set({ pointsEarned: earned }).where(and(eq(orders.id, order.id), eq(orders.orgId, order.orgId)));
          }
        }

        /*
         * FRYBIRD REWARDS — the stamp moves when the money actually arrives,
         * same as points and for the same reason: an order abandoned at the
         * counter must not leave a stamp behind.
         *
         * `awardStampForOrderInTx` is idempotent on the order id by itself (a
         * unique constraint in the ledger), so a retried capture cannot mint
         * a second stamp even without this function's own idempotency
         * wrapper — belt and braces on the exact failure mode webhooks are
         * prone to.
         *
         * If this order carried a redeemed reward — chosen and priced at
         * checkout, see src/lib/cart — that reward is marked spent here,
         * at the same moment the discount it granted is actually charged.
         */
        if (order.customerId && stampConfig) {
          const qualifying = qualifyingStampSpend(paise(order.grandTotal), paise(order.deliveryFee));
          await awardStampForOrderInTx(tx, {
            orgId: order.orgId,
            customerId: order.customerId,
            orderId: order.id,
            qualifyingSpend: qualifying,
            config: stampConfig,
          });

          if (order.stampRewardId && order.stampRewardProductSlug) {
            const { redeemed } = await redeemStampRewardInTx(tx, {
              rewardId: order.stampRewardId,
              orgId: order.orgId,
              orderId: order.id,
              productSlug: order.stampRewardProductSlug,
            });
            if (!redeemed) {
              // The order is already committed with the free item priced in —
              // nothing here can charge for it a second time. This is the
              // one thing left to do: make it loud rather than silent, since
              // the reward itself is still sitting AVAILABLE for whichever
              // order actually claimed it.
              console.error(`loyalty reward: order #${order.orderNumber} was priced with reward ${order.stampRewardId} but it was already redeemed by another order by settlement time (two unpaid orders selecting the same reward?) — free item given, no matching redemption recorded, customer ${order.customerId}`);
            }
          }
        }

        // The event is written either way: money changing hands is a fact about
        // the order whether or not it also moved the status.
        await tx.insert(orderEvents).values({
          orgId: order.orgId,
          orderId: order.id,
          fromStatus: locked.status,
          toStatus: movesToPaid ? "PAID" : locked.status,
          actorUserId: settlement.actorUserId,
          reason: settlement.reasonFor(capturedResult.capturedAmount, method),
        });

        // §52: money changing hands is a critical operation.
        await tx.insert(auditLogs).values({
          orgId: order.orgId,
          locationId: order.locationId,
          actorUserId: settlement.actorUserId,
          action: "payment_captured",
          entity: "orders",
          entityId: order.id,
          before: { status: locked.status },
          after: {
            status: movesToPaid ? "PAID" : locked.status,
            method,
            provider: settlement.provider,
            amount: capturedResult.capturedAmount.toString(),
            providerPaymentId: capturedResult.providerPaymentId,
          },
        });

        return { ok: true as const, paymentId: paymentId ?? "" };
      });
    },
  ).catch((error: unknown) => {
    // Unwraps a refusal thrown under the lock (see SettlementRefused) after
    // withIdempotency has released its claim instead of storing it.
    if (error instanceof SettlementRefused) return error;
    throw error;
  });
  if (settled instanceof SettlementRefused) return { ok: false, error: settled.message };

  const { result, replayed } = settled;
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, paymentId: result.paymentId, replayed };
}

/* ------------------------------------------------------------------ */
/* Refunds — roadmap 1.4                                               */
/* ------------------------------------------------------------------ */

export type RefundPaymentResult = { ok: true; refundId: string; orderId: string; fullyRefunded: boolean } | { ok: false; error: string };

type RefundTxOutcome =
  // refundedAmount travels as a string, not a Paise/bigint: withIdempotency
  // stores this whole object as a jsonb responseSnapshot for a replay to
  // return later, and JSON has no bigint representation.
  | { ok: true; refundId: string; orderId: string; fullyRefunded: boolean; orderStatusBefore: OrderRow["status"]; orderFulfilment: OrderRow["fulfilment"]; refundedAmount: string; reason: string }
  | { ok: false; error: string };

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
 *
 * Idempotent on the caller's key (a retried request — a network timeout, a
 * double-tap — replays the first result rather than refunding twice), and
 * the balance check is additionally serialized with `SELECT ... FOR UPDATE`
 * on the payment row: two genuinely concurrent refund requests against the
 * *same* payment (different keys — two managers, two devices) would
 * otherwise both read "remaining" before either wrote, and could together
 * refund more than was ever captured. The lock makes the second request
 * wait for the first to finish and see its result before checking its own
 * amount against what is actually left.
 */
export async function refundPayment(input: {
  paymentId: string;
  amount: Paise;
  reason: string;
  actorUserId: string;
  actorRoles: readonly Role[];
  orgId: string;
  idempotencyKey: string;
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

  const { result: outcome, replayed } = await withIdempotency(
    {
      key: input.idempotencyKey,
      operation: "refund_payment",
      orgId: input.orgId,
      request: { paymentId: input.paymentId, amount: input.amount.toString(), reason },
    },
    async (): Promise<RefundTxOutcome> =>
      database.transaction(async (tx) => {
        const [payment] = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.id, input.paymentId), eq(payments.orgId, input.orgId)))
          .for("update")
          .limit(1);
        if (!payment) return { ok: false, error: "That payment does not exist." };
        if (payment.status !== "CAPTURED" && payment.status !== "PARTIALLY_REFUNDED") {
          return { ok: false, error: `Only a captured payment can be refunded; this one is ${payment.status.toLowerCase().replace("_", " ")}.` };
        }

        const [order] = await tx.select().from(orders).where(eq(orders.id, payment.orderId)).limit(1);
        if (!order) return { ok: false, error: "That order does not exist." };

        const booked = await tx.select({ amount: refunds.amount }).from(refunds).where(eq(refunds.paymentId, payment.id));
        const alreadyRefunded = booked.reduce((sum, row) => add(sum, paise(row.amount)), ZERO);
        const remaining = subtract(paise(payment.amount), alreadyRefunded);
        if (input.amount > remaining) {
          return { ok: false, error: `Only ${formatINR(remaining)} is left to refund on this payment.` };
        }

        const provider = getProvider(payment.provider);
        const refunded = await provider.refund({ providerPaymentId: payment.providerPaymentId, amount: input.amount, reason });
        if (!refunded.ok) return { ok: false, error: refunded.error ?? "The refund could not be made." };

        const now = new Date();
        const [row] = await tx
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
            // Migration 0038 columns. Recorded only after the provider confirmed,
            // so SUCCEEDED; the RESERVE → finalize flow replaces this (ref-b3).
            status: "SUCCEEDED",
            finalizedAt: sql`now()`,
          })
          .returning({ id: refunds.id });
        if (!row) return { ok: false, error: "The refund was made but could not be recorded. Tell the owner." };

        const fullyRefunded = add(alreadyRefunded, refunded.refundedAmount) >= paise(payment.amount);
        await tx
          .update(payments)
          .set({ status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED", updatedAt: now })
          .where(eq(payments.id, payment.id));

        await tx.insert(auditLogs).values({
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

        return { ok: true, refundId: row.id, orderId: order.id, fullyRefunded, orderStatusBefore: order.status, orderFulfilment: order.fulfilment, refundedAmount: refunded.refundedAmount.toString(), reason };
      }),
  );

  if (!outcome.ok) return outcome;

  // A replay must not repeat what only the first, successful run should do
  // — the transaction above already ran exactly once and wrote everything
  // that belongs to the refund itself. Moving the order and writing its
  // event are the one part deliberately left outside that transaction (see
  // below), so they need their own guard against running a second time.
  if (replayed) return { ok: true, refundId: outcome.refundId, orderId: outcome.orderId, fullyRefunded: outcome.fullyRefunded };

  // A full refund closes the order as REFUNDED where the lifecycle allows
  // it (paid, cooking, ready, out, completed). advanceOrder writes the event
  // and voids the stamp. A partial refund, or an order the graph will not
  // move, gets an event of its own so the trail still shows the money.
  // Outside the locked transaction deliberately: advanceOrder does its own
  // writes (and its own idempotency, via order-status transition checks)
  // and does not need to hold the payment row lock to do them.
  const refundedAmount = paise(BigInt(outcome.refundedAmount));
  if (outcome.fullyRefunded && canTransition(outcome.orderStatusBefore, "REFUNDED", outcome.orderFulfilment)) {
    const moved = await advanceOrder({ orderId: outcome.orderId, to: "REFUNDED", actorUserId: input.actorUserId, orgId: input.orgId });
    if (!moved.ok) {
      await database.insert(orderEvents).values({ orgId: input.orgId, orderId: outcome.orderId, fromStatus: outcome.orderStatusBefore, toStatus: outcome.orderStatusBefore, actorUserId: input.actorUserId, reason: `Refunded ${formatINR(refundedAmount)} — ${outcome.reason}` });
    }
  } else {
    await database.insert(orderEvents).values({
      orgId: input.orgId,
      orderId: outcome.orderId,
      fromStatus: outcome.orderStatusBefore,
      toStatus: outcome.orderStatusBefore,
      actorUserId: input.actorUserId,
      reason: `${outcome.fullyRefunded ? "Refunded" : "Part refunded"} ${formatINR(refundedAmount)} — ${outcome.reason}`,
    });
  }

  return { ok: true, refundId: outcome.refundId, orderId: outcome.orderId, fullyRefunded: outcome.fullyRefunded };
}
