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

import { and, desc, eq, inArray, like, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, loyaltyAccounts, loyaltyTransactions, orderEvents, orders, payments, refunds } from "@/db/schema";
import { type Role, authorize, can } from "@/domain/permissions";
import { type Paise, ZERO, add, formatINR, paise, subtract } from "@/lib/money";
import { pointsEarned } from "@/lib/loyalty";
import { getLoyaltyConfig, getStampConfig } from "@/lib/loyalty/config";
import { awardStampForOrderInTx, qualifyingStampSpend, redeemStampRewardInTx, reversePointsForOrder, reverseStampForOrder } from "./loyalty";
import { financialYear, invoiceNumber, parseInvoiceNumber } from "@/lib/invoice";
import { CASH_PROVIDER, type PaymentMethod, type PaymentResult, RAZORPAY_PROVIDER, type RefundResult, getProvider } from "@/lib/payments";
import { IdempotencyConflict, withIdempotency } from "./idempotency";
import { type FactsRefreshSteps, refreshFactsForDays } from "./expenses";
import { refundFactsDays } from "@/lib/payments/refund-facts-days";
import { orderPaymentState } from "@/domain/order-payment-state";
import { getOrg } from "./org";
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

  // This path has no staff session and no customer identity, so every read
  // it makes is bound to the app's own organization (pay-58b, SEC c) — an
  // order UUID from any other org answers exactly like an unknown one.
  const org = await getOrg();
  if (!org) return { ok: false, error: "That order does not exist." };

  const [pending] = await database
    .select()
    .from(payments)
    .where(and(eq(payments.orderId, input.orderId), eq(payments.orgId, org.id), eq(payments.provider, RAZORPAY_PROVIDER), eq(payments.status, "PENDING")))
    .orderBy(desc(payments.createdAt))
    .limit(1);

  /*
   * The Razorpay order the caller names must be the one THIS order's pending
   * payment was opened for (pay-8). Without this, a caller holding a valid
   * signature for their own Razorpay order could aim it at any other order's
   * UUID: the signature verifies (it is genuine, just for a different
   * purchase), Razorpay confirms the money (again, for the other purchase),
   * and a payment for order A settles order B. The signature proves the
   * caller paid a Razorpay order; only this row says which of OUR orders that
   * Razorpay order belongs to.
   */
  if (input.providerOrderId !== undefined && pending?.providerOrderId && input.providerOrderId !== pending.providerOrderId) {
    return { ok: false, error: "That payment does not belong to this order." };
  }

  /*
   * Verification always uses the pending row's own reference, never the
   * caller's: with no pending row to anchor to there is nothing to verify a
   * signature against, and the provider then refuses — the replay of an
   * already-settled payment never gets this far (settle's captured fast path
   * answers first).
   */
  const providerOrderId = pending?.providerOrderId ?? undefined;

  // Only a failure Razorpay itself confirmed — the payment fetched from its
  // API and found failed, wrong, or short — is worth recording. A refusal
  // manufactured before that point (a fake signature, a missing reference)
  // is attacker-reachable with nothing but an order UUID, and writing it
  // would let anyone flag a stranger's order as failed (pay-58b, RED R2).
  let gatewayFailure: string | null = null;

  const result = await settle({
    orderId: input.orderId,
    // The same org binding as the reads above: this path's only authority is
    // the gateway's cryptography, so the order lookup stays inside our org.
    orgId: org.id,
    provider: RAZORPAY_PROVIDER,
    actorUserId: null,
    idempotencyKey: () => `razorpay-payment:${input.providerPaymentId}`,
    amountDue: (order) => (pending ? paise(pending.amount) : paise(order.grandTotal)),
    capture: async (order, amount) => {
      const captured = await getProvider(RAZORPAY_PROVIDER).capture({
        orderId: order.id,
        amount,
        actorUserId: null,
        providerPaymentId: input.providerPaymentId,
        providerOrderId,
        signature: input.signature,
      });
      if (!captured.ok && captured.payload?.gatewayVerified === true) gatewayFailure = captured.error ?? "The payment failed.";
      return captured;
    },
    providerPaymentId: input.providerPaymentId,
    providerOrderId: providerOrderId ?? null,
    methodFor: (captured) => (typeof captured.payload?.method === "string" ? (captured.payload.method as PaymentMethod) : "OTHER"),
    reasonFor: (amount, method) => `Paid online (${METHOD_WORD[method]}) — ${formatINR(amount)}`,
  });

  // A gateway-confirmed failure is recorded on the pending row so the order
  // page can say "payment failed — retry" rather than sitting on a spinner.
  // The order stays PENDING_PAYMENT; nothing here can move it to PAID.
  if (!result.ok && pending && gatewayFailure !== null) {
    await database
      .update(payments)
      .set({ failureReason: gatewayFailure, updatedAt: new Date() })
      .where(and(eq(payments.id, pending.id), eq(payments.status, "PENDING")));
  }
  return result;
}

/** Who is asking to note a payment failure — see `markOnlinePaymentFailed`. */
export type PaymentFailureReporter =
  /** The Razorpay webhook, after its body signature verified. Its reason is the gateway's own words from that verified body. */
  | { readonly kind: "webhook"; readonly reason: string }
  /**
   * The customer's browser: whoever the session or this device's checkout
   * cookie says they are. Nulls mean "nothing known" and never match. No
   * reason field on purpose (pay-58b, RED R1): the contact cookie is
   * unsigned and the order page shows the customer's phone, so "matches by
   * phone" is not proof enough to let a caller author text the real
   * customer will read on our page. A customer report stores a fixed,
   * server-chosen line; the gateway's actual words arrive via the webhook.
   */
  | { readonly kind: "customer"; readonly customerId: string | null; readonly phone: string | null };

const CUSTOMER_REPORTED_FAILURE = "Payment failed";

/**
 * Notes a failure Razorpay reported (Checkout's payment.failed, or the
 * webhook) against the pending payment, without touching the order.
 *
 * The write is bound to the order's own customer (pay-5). This is reachable
 * with no staff session and no signature, so before this check anyone who
 * learned an order UUID could stamp arbitrary text onto its payment row —
 * text the order page then shows to whoever is watching that order. A
 * customer reporter must match the order by signed-in customer id or by the
 * phone the order was placed under; the webhook's proof is its verified body
 * signature, checked by the route before this is called. Only a PENDING row
 * is ever touched — enforced in the UPDATE itself, not just the read, so a
 * capture landing in between cannot be scribbled over.
 */
export async function markOnlinePaymentFailed(input: { orderId: string; via: PaymentFailureReporter }): Promise<{ ok: boolean }> {
  const database = db();

  // Same rule as recordOnlinePayment: no session here, so the order lookup
  // is bound to the app's own organization (pay-58b, SEC c).
  const org = await getOrg();
  if (!org) return { ok: false };

  const [order] = await database
    .select({ id: orders.id, orgId: orders.orgId, customerId: orders.customerId, customerPhone: orders.customerPhone })
    .from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.orgId, org.id)))
    .limit(1);
  if (!order) return { ok: false };

  if (input.via.kind === "customer") {
    const ownsById = input.via.customerId !== null && order.customerId !== null && input.via.customerId === order.customerId;
    const ownsByPhone = input.via.phone !== null && order.customerPhone !== null && input.via.phone === order.customerPhone;
    if (!ownsById && !ownsByPhone) return { ok: false };
  }

  // Never the caller's words. A customer report records the fact of failure;
  // the wording is the server's (see `PaymentFailureReporter`).
  const reason = input.via.kind === "webhook" ? input.via.reason : CUSTOMER_REPORTED_FAILURE;

  const [pending] = await database
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.orderId, order.id), eq(payments.orgId, order.orgId), eq(payments.provider, RAZORPAY_PROVIDER), eq(payments.status, "PENDING")))
    .orderBy(desc(payments.createdAt))
    .limit(1);
  if (!pending) return { ok: false };
  const written = await database
    .update(payments)
    .set({ failureReason: reason.slice(0, 250), updatedAt: new Date() })
    .where(and(eq(payments.id, pending.id), eq(payments.status, "PENDING")))
    .returning({ id: payments.id });
  return { ok: written.length > 0 };
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
   * The org the order must belong to. For cash it is the acting staff
   * member's own org. The Razorpay/webhook path has no staff session — its
   * boundary is the provider's cryptographic signature over a specific
   * payment id — but since pay-58b it passes the app's own org (`getOrg()`)
   * anyway, so an anonymous caller probing with a foreign or invented order
   * UUID gets the same "does not exist" either way.
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

export type RefundPaymentResult =
  | { ok: true; refundId: string; orderId: string; fullyRefunded: boolean }
  /** `retriable`: the refund may or may not have gone through; retry the same attempt (same key) to find out. Never start a new one. */
  | { ok: false; error: string; retriable?: boolean };

/**
 * What the reserve-and-finalize work returns, and what `withIdempotency`
 * stores for a replay. Deliberately small: the follow-up (F2) re-reads the
 * refund, payment and order fresh instead of trusting a snapshot.
 */
type RefundWorkOutcome = { ok: true; refundId: string; orderId: string } | { ok: false; error: string };

/**
 * The provider could not say whether the money moved — a timeout, a 5xx, a
 * 409, a refund still pending, an amount that does not match. Thrown, never
 * returned, from inside the idempotent work: `withIdempotency` then stores no
 * snapshot and releases its claim, the refund row stays RESERVED and keeps
 * its amount out of the refundable balance, and the next call with the same
 * key re-enters through that row and asks again (design Revision 2, B2).
 */
class AmbiguousRefundOutcome extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmbiguousRefundOutcome";
  }
}

/** The caller's key already belongs to a different refund (another payment, amount or reason). */
class RefundKeyConflict extends Error {
  constructor() {
    super("payments: refund idempotency key reused for a different refund");
    this.name = "RefundKeyConflict";
  }
}

type RefundRow = typeof refunds.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;

/** Statuses whose amount is no longer available to refund: money on its way back, or back. */
const REFUND_HOLDS_BALANCE = ["RESERVED", "SUCCEEDED"] as const;

const REFUND_STILL_OPEN =
  "We couldn't confirm the refund yet. Nothing more will be refunded twice — try the same refund again in a minute to finish it.";

function failureOf(row: RefundRow): string {
  const failure = (row.providerPayload as { failure?: unknown } | null)?.failure;
  return `The refund was not made: ${typeof failure === "string" ? failure : "the payment provider refused it"}.`;
}

/**
 * Gives money back. Design: hive/agents/michael-mu4lr1ro/reports/
 * 2026-09-16-refund-design.md, Revision 2.
 *
 * 1. RESERVE (one transaction). Lock the payment row, look the caller's key
 *    up in `refunds` (a hit is this same refund coming back — resume it),
 *    check the balance counting RESERVED and SUCCEEDED refunds, and insert
 *    the refund as RESERVED with an audit row. Nothing leaves the business.
 * 2. PROVIDER, outside any transaction. Cash always succeeds. Razorpay is
 *    asked under `X-Refund-Idempotency: <refund id>`; a resumed refund first
 *    looks for an earlier refund carrying that id, and never asks twice for
 *    one it finds. Pending or unknown outcomes throw `AmbiguousRefundOutcome`.
 * 3. FINALIZE (one transaction). Lock payment, then refund row — the one
 *    lock order every refund path uses — then SUCCEEDED with finalized_at and
 *    the payment's status from the SUCCEEDED total, or FAILED with its reason.
 * 4. FOLLOW-UP (`followUpRefund`), outside the idempotent work so it runs on
 *    every call, replays included, and converges on what is stored.
 *
 * `orders.refund` only; every read is scoped to the caller's org.
 */
export async function refundPayment(input: {
  paymentId: string;
  amount: Paise;
  reason: string;
  actorUserId: string;
  actorRoles: readonly Role[];
  orgId: string;
  idempotencyKey: string;
}, opts: { readonly factsRefresh?: FactsRefreshSteps } = {}): Promise<RefundPaymentResult> {
  try {
    authorize(input.actorRoles, "orders.refund");
  } catch {
    return { ok: false, error: "Refunds need a manager or the owner." };
  }
  if (input.amount <= ZERO) return { ok: false, error: "A refund has to be more than nothing." };
  const reason = input.reason.trim();
  if (reason.length < 3) return { ok: false, error: "Say why, in a few words." };

  let outcome: RefundWorkOutcome;
  try {
    ({ result: outcome } = await withIdempotency(
      {
        key: input.idempotencyKey,
        operation: "refund_payment",
        orgId: input.orgId,
        request: { paymentId: input.paymentId, amount: input.amount.toString(), reason },
      },
      () => reserveAndFinalizeRefund({ ...input, reason }),
    ));
  } catch (error) {
    if (error instanceof AmbiguousRefundOutcome) return { ok: false, error: error.message, retriable: true };
    if (error instanceof IdempotencyConflict || error instanceof RefundKeyConflict) {
      return { ok: false, error: "That refund attempt was already used for a different refund. Close the dialog and start again." };
    }
    throw error;
  }

  if (!outcome.ok) {
    // A refusal on a payment that already has refunds (POS-ORDERS, 8093c26 #1):
    // the manager may be retrying, under a NEW key, a refund whose follow-up
    // was lost — the dialog mints a new key when it reopens. Finish every
    // SUCCEEDED refund on this payment first; each follow-up is idempotent.
    await healPaymentRefundFollowUps({ orgId: input.orgId, actorUserId: input.actorUserId, paymentId: input.paymentId }, opts.factsRefresh);
    return outcome;
  }

  // The money has moved and is recorded. A follow-up failure is logged and
  // left for `healLostRefundFollowUps` (the scheduled healer) or a later
  // attempt on this payment to finish — never reported as a failed refund,
  // which would invite a second one.
  const fullyRefunded = await runFollowUp({ orgId: input.orgId, actorUserId: input.actorUserId, refundId: outcome.refundId }, opts.factsRefresh);
  return { ok: true, refundId: outcome.refundId, orderId: outcome.orderId, fullyRefunded: fullyRefunded ?? false };
}

/** `followUpRefund`, with any error logged by name only. Null when it failed. */
async function runFollowUp(input: { orgId: string; actorUserId: string | null; refundId: string }, factsRefresh: FactsRefreshSteps | undefined): Promise<boolean | null> {
  try {
    return await followUpRefund(input, factsRefresh);
  } catch (error) {
    console.warn(`payments: refund follow-up failed (${error instanceof Error ? error.name : "unknown"}); the refund healer or a later attempt on this payment finishes it`);
    return null;
  }
}

/** Runs the follow-up for every SUCCEEDED refund on a payment that has any — org-scoped, oldest first. */
async function healPaymentRefundFollowUps(input: { orgId: string; actorUserId: string; paymentId: string }, factsRefresh: FactsRefreshSteps | undefined): Promise<void> {
  try {
    const database = db();
    const [payment] = await database
      .select({ status: payments.status })
      .from(payments)
      .where(and(eq(payments.id, input.paymentId), eq(payments.orgId, input.orgId)))
      .limit(1);
    if (payment?.status !== "REFUNDED" && payment?.status !== "PARTIALLY_REFUNDED") return;
    const done = await database
      .select({ id: refunds.id })
      .from(refunds)
      .where(and(eq(refunds.paymentId, input.paymentId), eq(refunds.orgId, input.orgId), eq(refunds.status, "SUCCEEDED")))
      .orderBy(refunds.finalizedAt);
    for (const row of done) await runFollowUp({ orgId: input.orgId, actorUserId: input.actorUserId, refundId: row.id }, factsRefresh);
  } catch (error) {
    console.warn(`payments: refund follow-up healing failed (${error instanceof Error ? error.name : "unknown"})`);
  }
}

type Reservation =
  | { readonly kind: "settled"; readonly outcome: RefundWorkOutcome }
  | { readonly kind: "ask"; readonly row: RefundRow; readonly payment: PaymentRow; readonly resumed: boolean };

async function reserveAndFinalizeRefund(input: {
  paymentId: string;
  amount: Paise;
  reason: string;
  actorUserId: string;
  orgId: string;
  idempotencyKey: string;
}): Promise<RefundWorkOutcome> {
  const database = db();

  /* ---- 1. RESERVE ------------------------------------------------------ */
  const reservation: Reservation = await database.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.id, input.paymentId), eq(payments.orgId, input.orgId)))
      .for("update")
      .limit(1);
    if (!payment) return { kind: "settled", outcome: { ok: false, error: "That payment does not exist." } };

    // After the payment lock, so a same-key call for this payment waits here
    // and then sees the row the first one wrote (S1).
    const findByKey = async () =>
      (await tx.select().from(refunds).where(and(eq(refunds.orgId, input.orgId), eq(refunds.idempotencyKey, input.idempotencyKey))).limit(1))[0];
    const resume = (row: RefundRow): Reservation => {
      // The key's own row must be this very refund; anything else is a key
      // reused for a different request (B3) — never replayed.
      if (row.paymentId !== input.paymentId || paise(row.amount) !== input.amount || row.reason !== input.reason) throw new RefundKeyConflict();
      if (row.status === "SUCCEEDED") return { kind: "settled", outcome: { ok: true, refundId: row.id, orderId: row.orderId } };
      if (row.status === "FAILED") return { kind: "settled", outcome: { ok: false, error: failureOf(row) } };
      return { kind: "ask", row, payment, resumed: true };
    };

    const existing = await findByKey();
    if (existing) return resume(existing);

    if (payment.status !== "CAPTURED" && payment.status !== "PARTIALLY_REFUNDED") {
      return { kind: "settled", outcome: { ok: false, error: `Only a captured payment can be refunded; this one is ${payment.status.toLowerCase().replace("_", " ")}.` } };
    }
    try {
      getProvider(payment.provider);
    } catch {
      // Checked before reserving, so an unusable provider never parks an amount.
      return { kind: "settled", outcome: { ok: false, error: "This payment's provider is not set up, so it cannot be refunded here." } };
    }

    const [order] = await tx.select().from(orders).where(and(eq(orders.id, payment.orderId), eq(orders.orgId, input.orgId))).limit(1);
    if (!order) return { kind: "settled", outcome: { ok: false, error: "That order does not exist." } };

    const held = await tx
      .select({ amount: refunds.amount })
      .from(refunds)
      .where(and(eq(refunds.paymentId, payment.id), eq(refunds.orgId, input.orgId), inArray(refunds.status, REFUND_HOLDS_BALANCE)));
    const alreadyHeld = held.reduce((sum, row) => add(sum, paise(row.amount)), ZERO);
    const remaining = subtract(paise(payment.amount), alreadyHeld);
    if (input.amount > remaining) {
      return { kind: "settled", outcome: { ok: false, error: `Only ${formatINR(remaining)} is left to refund on this payment.` } };
    }

    let row: RefundRow | undefined;
    try {
      // A savepoint: a 23505 here (the same key racing in for a different
      // payment, which the payment lock does not serialize) must not abort
      // the whole transaction before it can be read back.
      [row] = await tx.transaction((sp) =>
        sp
          .insert(refunds)
          .values({
            orgId: input.orgId,
            paymentId: payment.id,
            orderId: order.id,
            amount: input.amount,
            reason: input.reason,
            actorUserId: input.actorUserId,
            provider: payment.provider,
            status: "RESERVED",
            // Explicit: 0038's expand-phase DEFAULT now() would otherwise mark a
            // reservation finalized and trip refunds_finalized_check.
            finalizedAt: null,
            idempotencyKey: input.idempotencyKey,
          })
          .returning(),
      );
    } catch (error) {
      const code = (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
      if (code !== "23505") throw error;
      const raced = await findByKey();
      if (!raced) throw error;
      return resume(raced);
    }
    if (!row) throw new Error("payments: refund reservation returned no row");

    await tx.insert(auditLogs).values({
      orgId: input.orgId,
      locationId: order.locationId,
      actorUserId: input.actorUserId,
      action: "refund_reserved",
      entity: "refunds",
      entityId: row.id,
      before: { paymentStatus: payment.status, held: alreadyHeld.toString() },
      after: { status: "RESERVED", amount: input.amount.toString(), reason: input.reason, provider: payment.provider, paymentId: payment.id, orderId: order.id },
    });

    return { kind: "ask", row, payment, resumed: false };
  });

  if (reservation.kind === "settled") return reservation.outcome;
  const { row, payment, resumed } = reservation;

  /* ---- 2. PROVIDER — outside every transaction ------------------------- */
  let provider;
  try {
    provider = getProvider(row.provider);
  } catch {
    // A reservation made while the provider worked, resumed after it stopped:
    // whether money moved is unknown, so the amount stays held.
    throw new AmbiguousRefundOutcome(REFUND_STILL_OPEN);
  }
  const request = { providerPaymentId: payment.providerPaymentId, amount: paise(row.amount), reason: row.reason, refundId: row.id };

  let result: RefundResult;
  const lookup = resumed && provider.findRefund ? await provider.findRefund({ providerPaymentId: payment.providerPaymentId, refundId: row.id }) : null;
  if (lookup?.found === "unknown") throw new AmbiguousRefundOutcome(REFUND_STILL_OPEN);
  result = lookup?.found === true ? lookup.result : await provider.refund(request);

  if (resumed && lookup?.found !== true && result.outcome === "refused") {
    // RELIABILITY C2: on a resume the earlier POST may have refunded already
    // and the lookup simply missed it (list lag). A 4xx now ("more than
    // refundable") is then proof of nothing — never book FAILED and free the
    // amount on it. It stays RESERVED for a later lookup or manual finalize.
    result = { ...result, outcome: "ambiguous" };
  }

  if (result.outcome === "succeeded" && result.refundedAmount !== paise(row.amount)) {
    // S7: a refund for another amount is never booked as this one.
    result = { ...result, outcome: "ambiguous", error: "The provider refunded a different amount than was reserved." };
  }
  if (result.outcome === "pending" || result.outcome === "ambiguous") {
    if (result.providerRefundId) {
      // Keep the gateway's reference on the held row for reconciliation; the status stays RESERVED.
      await database
        .update(refunds)
        .set({ providerRefundId: result.providerRefundId, updatedAt: new Date() })
        .where(and(eq(refunds.id, row.id), eq(refunds.orgId, input.orgId), eq(refunds.status, "RESERVED")));
    }
    throw new AmbiguousRefundOutcome(
      result.outcome === "pending" ? "The payment provider accepted the refund and is still processing it. Try the same refund again shortly to finish recording it." : REFUND_STILL_OPEN,
    );
  }

  /* ---- 3. FINALIZE ------------------------------------------------------ */
  return database.transaction(async (tx): Promise<RefundWorkOutcome> => {
    // Payment first, then the refund row: the same order as RESERVE (B1).
    const [lockedPayment] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.id, payment.id), eq(payments.orgId, input.orgId)))
      .for("update")
      .limit(1);
    const [locked] = await tx
      .select()
      .from(refunds)
      .where(and(eq(refunds.id, row.id), eq(refunds.orgId, input.orgId)))
      .for("update")
      .limit(1);
    if (!lockedPayment || !locked) throw new Error("payments: a reserved refund or its payment disappeared before finalize");

    // Another call finalized it while this one was asking the provider.
    if (locked.status === "SUCCEEDED") return { ok: true, refundId: locked.id, orderId: locked.orderId };
    if (locked.status === "FAILED") return { ok: false, error: failureOf(locked) };

    const [order] = await tx.select({ locationId: orders.locationId }).from(orders).where(and(eq(orders.id, locked.orderId), eq(orders.orgId, input.orgId))).limit(1);

    if (result.outcome === "refused") {
      const failure = (result.error ?? "the payment provider refused it").slice(0, 300);
      await tx
        .update(refunds)
        .set({ status: "FAILED", providerRefundId: result.providerRefundId, providerPayload: { failure, httpStatus: result.httpStatus }, updatedAt: new Date() })
        .where(eq(refunds.id, locked.id));
      await tx.insert(auditLogs).values({
        orgId: input.orgId,
        locationId: order?.locationId ?? null,
        actorUserId: input.actorUserId,
        action: "refund_failed",
        entity: "refunds",
        entityId: locked.id,
        before: { status: "RESERVED" },
        after: { status: "FAILED", amount: locked.amount.toString(), provider: locked.provider, httpStatus: result.httpStatus, failure, paymentId: lockedPayment.id, orderId: locked.orderId },
      });
      return { ok: false, error: failureOf({ ...locked, providerPayload: { failure } }) };
    }

    await tx
      .update(refunds)
      .set({ status: "SUCCEEDED", finalizedAt: sql`now()`, providerRefundId: result.providerRefundId, providerPayload: { httpStatus: result.httpStatus }, updatedAt: new Date() })
      .where(eq(refunds.id, locked.id));

    // Recomputed under the payment lock from what has actually SUCCEEDED
    // (B1) — RESERVED and FAILED refunds never change the payment's status.
    const succeeded = await tx
      .select({ amount: refunds.amount })
      .from(refunds)
      .where(and(eq(refunds.paymentId, lockedPayment.id), eq(refunds.orgId, input.orgId), eq(refunds.status, "SUCCEEDED")));
    const refundedTotal = succeeded.reduce((sum, r) => add(sum, paise(r.amount)), ZERO);
    const nextStatus = refundedTotal >= paise(lockedPayment.amount) ? "REFUNDED" : "PARTIALLY_REFUNDED";
    await tx.update(payments).set({ status: nextStatus, updatedAt: new Date() }).where(eq(payments.id, lockedPayment.id));

    await tx.insert(auditLogs).values({
      orgId: input.orgId,
      locationId: order?.locationId ?? null,
      actorUserId: input.actorUserId,
      action: "payment_refunded",
      entity: "payments",
      entityId: lockedPayment.id,
      before: { status: lockedPayment.status, refunded: subtract(refundedTotal, paise(locked.amount)).toString() },
      after: {
        status: nextStatus,
        amount: locked.amount.toString(),
        reason: locked.reason,
        provider: locked.provider,
        providerRefundId: result.providerRefundId,
        refundId: locked.id,
        orderId: locked.orderId,
      },
    });

    return { ok: true, refundId: locked.id, orderId: locked.orderId };
  });
}

/**
 * Everything a SUCCEEDED refund owes the rest of the system, done so that
 * running it again — a replay, a retry after a crash, two calls at once, the
 * healer — finishes what is missing and repeats nothing (design Revision 2,
 * B4, S4, S8). Reads refund, payment and order fresh; trusts no snapshot.
 *
 * 1. A full refund of the ORDER moves it to REFUNDED where the lifecycle
 *    allows, then reverses its stamp and points whatever its status (a
 *    crash after advanceOrder's commit, or a CANCELLED/FAILED order). Both
 *    reversals are idempotent and run only after every transaction that
 *    touched the order has committed (RELIABILITY condition b526c5).
 * 2. The money event, exactly once per refund, keyed by `metadata.refundId`
 *    under the refund row's lock — written LAST, so its presence means steps
 *    1 and 2 are done. `healLostRefundFollowUps` relies on exactly that.
 * 3. The IQ daily facts for the days the refund touched (best effort).
 *
 * Returns whether the ORDER is fully refunded: every payment ever captured
 * on it is REFUNDED.
 */
async function followUpRefund(input: { orgId: string; actorUserId: string | null; refundId: string }, factsRefresh: FactsRefreshSteps | undefined): Promise<boolean> {
  const database = db();
  const [refund] = await database.select().from(refunds).where(and(eq(refunds.id, input.refundId), eq(refunds.orgId, input.orgId))).limit(1);
  if (!refund || refund.status !== "SUCCEEDED") return false;
  const [order] = await database.select().from(orders).where(and(eq(orders.id, refund.orderId), eq(orders.orgId, input.orgId))).limit(1);
  if (!order) return false;

  // Fully refunded is an ORDER question (FINANCE-LEDGER, 8093c26 #1): every
  // payment ever captured on the order is REFUNDED. Refunding a duplicate
  // capture in full leaves the order sold, its points and stamp kept.
  const orderPayments = await database
    .select({ status: payments.status })
    .from(payments)
    .where(and(eq(payments.orderId, order.id), eq(payments.orgId, input.orgId)));
  const fullyRefunded = orderPaymentState(orderPayments.map((row) => row.status)) === "REFUNDED";
  const amount = paise(refund.amount);

  if (fullyRefunded) {
    // 1. The order, where the lifecycle allows. A refusal here is a race with
    // another move (S8) and changes nothing below.
    if (order.status !== "REFUNDED" && canTransition(order.status, "REFUNDED", order.fulfilment)) {
      await advanceOrder({ orderId: order.id, to: "REFUNDED", actorUserId: input.actorUserId, orgId: input.orgId, reason: `Refunded — ${refund.reason}` });
    }
    // Loyalty, unconditionally for a full refund.
    await reverseStampForOrder({ orgId: input.orgId, orderId: order.id, reason: `Order #${order.orderNumber} refunded` });
    await reversePointsForOrder({ orgId: input.orgId, orderId: order.id, reason: `Order #${order.orderNumber} refunded` });
  }

  // 2. The money event, last. Worded from this refund alone (FIN #2).
  await database.transaction(async (tx) => {
    await tx.select({ id: refunds.id }).from(refunds).where(eq(refunds.id, refund.id)).for("update");
    const [already] = await tx
      .select({ id: orderEvents.id })
      .from(orderEvents)
      .where(and(eq(orderEvents.orderId, order.id), eq(orderEvents.orgId, input.orgId), sql`${orderEvents.metadata}->>'refundId' = ${refund.id}`))
      .limit(1);
    if (already) return;
    // The status as it is now, after step 1 (POS #4).
    const [current] = await tx.select({ status: orders.status }).from(orders).where(and(eq(orders.id, order.id), eq(orders.orgId, input.orgId))).limit(1);
    const status = current?.status ?? order.status;
    await tx.insert(orderEvents).values({
      orgId: input.orgId,
      orderId: order.id,
      fromStatus: status,
      toStatus: status,
      actorUserId: refund.actorUserId ?? input.actorUserId,
      reason: `Refund ${formatINR(amount)} — ${refund.reason}`,
      metadata: { refundId: refund.id },
    });
  });

  // 3. Facts: the order's day and the day the refund finalized — never the
  // day it was reserved (an-3). Best effort, bounded, never fails the refund.
  try {
    await refreshFactsForDays(input.orgId, refundFactsDays({ orderCreatedAt: order.createdAt, finalizedAt: refund.finalizedAt }), factsRefresh);
  } catch (error) {
    console.warn(`payments: facts refresh after refund failed (${error instanceof Error ? error.name : "unknown"}); the nightly recompute will heal it`);
  }

  return fullyRefunded;
}

/** What one healer run did. */
export interface RefundHealReport {
  /** Lost follow-ups this run attempted, up to the limit. */
  readonly examined: number;
  /** Of those, now carrying their money event: the follow-up finished. */
  readonly healed: number;
  /** Still unfinished after this run. */
  readonly stillOpen: number;
  /** Ids of the refunds still unfinished (ids only, nothing else), so the job can alert when they persist across runs. */
  readonly stillOpenRefundIds: readonly string[];
  /** Picked but not attempted because `shouldStop` said time was up; the next run reaches them (no failure is recorded). */
  readonly notReached: number;
}

/** A refund's follow-up is only presumed lost after this long, so the healer never races a live request. */
export const REFUND_HEAL_AFTER_MS = 5 * 60_000;
export const REFUND_HEAL_LIMIT = 20;
/** After a failed heal the refund is skipped for this long, so rows that always fail cannot starve newer ones. */
export const REFUND_HEAL_RETRY_AFTER_MS = 60 * 60_000;
export const REFUND_FOLLOWUP_FAILED_ACTION = "refund_followup_failed";

/**
 * Finishes refund follow-ups that were lost (the request died, or a
 * follow-up error was caught and logged) without anyone retrying in the UI
 * (ref-b7). A full refund leaves no Refund button behind, so nothing else
 * would ever finish it.
 *
 * Picks SUCCEEDED refunds in this org, finalized more than `olderThanMs` ago,
 * that have no money event (`order_events.metadata.refundId`). The follow-up
 * writes that event last, so its absence means exactly "not finished". It
 * only picks refunds made by the reserve-and-finalize flow (they carry an
 * idempotency key); refunds recorded before it are history and are never
 * rewritten. Oldest first, at most `limit` per call.
 *
 * A refund whose heal fails gets an audit row (`refund_followup_failed`, with
 * the attempt count and the error's name only) and is skipped for
 * `retryAfterMs`, so a row that always fails cannot block newer lost
 * follow-ups. A refund with no staff actor is healed as the system (null
 * actor). Each follow-up is idempotent: a second run, or a live request
 * racing this one, repeats nothing.
 *
 * Bounded in time (RELIABILITY): `shouldStop` is asked before each refund,
 * and once it returns true the run ends between refunds. One follow-up can
 * still take up to about 28 s (advanceOrder, two reversals, the event, and a
 * facts refresh within its 2 s lock wait and 5 s statements), so a job should
 * stop with at least that much of its deadline left.
 *
 * Exported for the scheduled job (AUTOMATION-ARCHITECT registers it). It
 * never calls a payment provider.
 */
export async function healLostRefundFollowUps(
  input: { readonly orgId: string; readonly olderThanMs?: number; readonly limit?: number; readonly retryAfterMs?: number; readonly now?: Date },
  opts: { readonly factsRefresh?: FactsRefreshSteps; readonly shouldStop?: () => boolean } = {},
): Promise<RefundHealReport> {
  const database = db();
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - (input.olderThanMs ?? REFUND_HEAL_AFTER_MS));
  const retryAfter = new Date(now.getTime() - (input.retryAfterMs ?? REFUND_HEAL_RETRY_AFTER_MS));
  const limit = Math.max(1, Math.min(input.limit ?? REFUND_HEAL_LIMIT, 100));

  const lost = await database
    .select({ id: refunds.id, actorUserId: refunds.actorUserId, orderId: refunds.orderId })
    .from(refunds)
    .where(
      and(
        eq(refunds.orgId, input.orgId),
        eq(refunds.status, "SUCCEEDED"),
        sql`${refunds.idempotencyKey} IS NOT NULL`,
        lt(refunds.finalizedAt, cutoff),
        sql`NOT EXISTS (SELECT 1 FROM ${orderEvents} e WHERE e.org_id = ${refunds.orgId} AND e.order_id = ${refunds.orderId} AND e.metadata->>'refundId' = ${refunds.id}::text)`,
        sql`NOT EXISTS (SELECT 1 FROM ${auditLogs} a WHERE a.org_id = ${refunds.orgId} AND a.entity = 'refunds' AND a.entity_id = ${refunds.id} AND a.action = ${REFUND_FOLLOWUP_FAILED_ACTION} AND a.created_at > ${retryAfter.toISOString()}::timestamptz)`,
      ),
    )
    .orderBy(refunds.finalizedAt)
    .limit(limit);

  const stillOpenRefundIds: string[] = [];
  let examined = 0;
  for (const row of lost) {
    if (opts.shouldStop?.()) break;
    examined += 1;
    let errorName: string | null = null;
    try {
      await followUpRefund({ orgId: input.orgId, actorUserId: row.actorUserId, refundId: row.id }, opts.factsRefresh);
    } catch (error) {
      errorName = error instanceof Error ? error.name : "unknown";
    }
    const [event] = await database
      .select({ id: orderEvents.id })
      .from(orderEvents)
      .where(and(eq(orderEvents.orgId, input.orgId), eq(orderEvents.orderId, row.orderId), sql`${orderEvents.metadata}->>'refundId' = ${row.id}`))
      .limit(1);
    if (event) continue;

    stillOpenRefundIds.push(row.id);
    const [{ previous } = { previous: 0 }] = await database
      .select({ previous: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(and(eq(auditLogs.orgId, input.orgId), eq(auditLogs.entity, "refunds"), eq(auditLogs.entityId, row.id), eq(auditLogs.action, REFUND_FOLLOWUP_FAILED_ACTION)));
    await database.insert(auditLogs).values({
      orgId: input.orgId,
      locationId: null,
      actorUserId: null,
      action: REFUND_FOLLOWUP_FAILED_ACTION,
      entity: "refunds",
      entityId: row.id,
      before: { attempts: previous },
      after: { attempts: previous + 1, error: errorName ?? "follow-up did not finish", orderId: row.orderId },
    });
    console.warn(`payments: refund healer could not finish refund ${row.id} (${errorName ?? "not finished"}); retrying after the back-off`);
  }

  return { examined, healed: examined - stillOpenRefundIds.length, stillOpen: stillOpenRefundIds.length, stillOpenRefundIds, notReached: lost.length - examined };
}

/**
 * How many refund follow-ups are stuck: SUCCEEDED refunds from the
 * reserve-and-finalize flow (they carry an idempotency key) with no money
 * event, whose heal has failed at least `minFailures` times
 * (`refund_followup_failed` audit rows). State, not a per-run delta: the heal
 * job alerts on a count above zero (RELIABILITY 4a8d76 #2), and it drops back
 * to zero on its own once the follow-up finishes, because the money event
 * then exists. Org-scoped; reads only.
 */
export async function countStuckRefundFollowUps(input: { readonly orgId: string; readonly minFailures?: number }): Promise<number> {
  const minFailures = Math.max(1, input.minFailures ?? 2);
  const [row] = await db()
    .select({ stuck: sql<number>`count(*)::int` })
    .from(refunds)
    .where(
      and(
        eq(refunds.orgId, input.orgId),
        eq(refunds.status, "SUCCEEDED"),
        sql`${refunds.idempotencyKey} IS NOT NULL`,
        sql`NOT EXISTS (SELECT 1 FROM ${orderEvents} e WHERE e.org_id = ${refunds.orgId} AND e.order_id = ${refunds.orderId} AND e.metadata->>'refundId' = ${refunds.id}::text)`,
        sql`(SELECT count(*) FROM ${auditLogs} a WHERE a.org_id = ${refunds.orgId} AND a.entity = 'refunds' AND a.entity_id = ${refunds.id} AND a.action = ${REFUND_FOLLOWUP_FAILED_ACTION}) >= ${minFailures}`,
      ),
    );
  return row?.stuck ?? 0;
}
