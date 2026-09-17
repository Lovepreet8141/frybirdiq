/**
 * settle() atomicity against a real database — the payment-core priority.
 *
 * The bug: settle()'s side effects after a payment provider confirms a
 * capture (promoting the payment row to CAPTURED, issuing the GST invoice
 * number, moving the order to PAID, awarding loyalty points, awarding or
 * redeeming a FRYBIRD REWARDS stamp, writing the order-event and audit
 * rows) used to be separate, un-transacted statements. If the payment row
 * committed but something after it threw, real money was captured while
 * the rest of the settlement never finished — and settle()'s own "already
 * captured" fast path would then report that half-finished settlement as
 * success forever after, since a captured payment used to be trusted, on
 * its own, to mean the whole thing had happened.
 *
 * Proving that needs a real, unrecoverable failure partway through the
 * transaction — not a hand-wave. The invoice-numbering retry loop turned
 * out to be the wrong lever for this (it always recomputes the *true*
 * current max from the table, so pre-seeded rows just get stepped past
 * rather than re-colliding; genuinely exhausting it needs real concurrent
 * contention, already covered separately in
 * invoice-numbering.integration.test.ts). Instead, these tests install a
 * throwaway Postgres trigger — scoped to this test database only, armed
 * for one specific order id at a time, dropped in `afterAll` — that makes
 * the very last statement in the transaction (the audit_logs insert) throw
 * on command. Firing the fault at the *last* statement is deliberate: if
 * even that rolls back everything before it, atomicity holds regardless of
 * where a real failure happens to land.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, idempotencyKeys, loyaltyAccounts, loyaltyStampEvents, loyaltyTransactions, orders, organizations, payments } from "@/db/schema";
import { recordCashPayment, recordOnlinePayment, refundPayment } from "./payments";
import { createTestCustomer, createTestOrg, deleteTestOrg, warmPool, type TestOrg } from "./__test-support__/fixtures";
import { fromRupees } from "@/lib/money";
import { ORG_SLUG } from "./org";

async function createOrderPendingPayment(org: TestOrg, opts: { customerId?: string; grandTotalRupees?: string } = {}) {
  const [order] = await db()
    .insert(orders)
    .values({
      orgId: org.orgId,
      locationId: org.locationId,
      orderNumber: `TEST-${randomUUID().slice(0, 8)}`,
      businessDate: new Date().toISOString().slice(0, 10),
      status: "PENDING_PAYMENT",
      channel: "TAKEAWAY",
      fulfilment: "TAKEAWAY",
      customerId: opts.customerId ?? null,
      grandTotal: fromRupees(opts.grandTotalRupees ?? "300"),
    })
    .returning({ id: orders.id });
  if (!order) throw new Error("fixture: order insert returned no row");
  return order.id;
}

async function setLoyaltyEarning(org: TestOrg) {
  // 5% back at ₹1/point — a ₹300 order earns 15, an easy number to assert on.
  await db().update(organizations).set({ loyaltyEarnBps: 500, loyaltyPointValue: fromRupees("1") }).where(eq(organizations.id, org.orgId));
}

/** Arms a deliberate, deterministic failure on settle()'s very last write for one order id. */
async function armSettleFailure(orderId: string) {
  await db().execute(sql`INSERT INTO test_settle_fault_orders (order_id) VALUES (${orderId})`);
}

async function disarmSettleFailure(orderId: string) {
  await db().execute(sql`DELETE FROM test_settle_fault_orders WHERE order_id = ${orderId}`);
}

/**
 * Runs `start()` while a separate transaction holds `SELECT ... FOR UPDATE`
 * on the order row; releases it only once `waiters` backends are waiting on
 * a lock, then resolves with the started calls' results. `whileHeld`, when
 * given, writes inside the holding transaction just before it commits — a
 * state change that lands after the waiters passed settle()'s pre-check.
 */
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
async function withOrderRowHeld<T>(orderId: string, waiters: number, start: () => Promise<T>[], whileHeld?: (tx: Tx) => Promise<void>): Promise<T[]> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let locked!: () => void;
  const lockTaken = new Promise<void>((resolve) => (locked = resolve));

  const holder = db().transaction(async (tx) => {
    await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId)).for("update");
    locked();
    await released;
    if (whileHeld) await whileHeld(tx);
  });
  await lockTaken;

  const calls = start();
  try {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const [row] = await db().execute<{ waiting: number }>(
        sql`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
      );
      if ((row?.waiting ?? 0) >= waiters) break;
      if (Date.now() > deadline) throw new Error(`test: only ${row?.waiting ?? 0} of ${waiters} settlements reached the order-row lock`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    release();
    await holder;
  }
  return Promise.all(calls);
}

describe("settle() atomicity", () => {
  let org: TestOrg;

  beforeAll(async () => {
    // settle() resolves loyalty/stamp config via getOrg(), which looks up
    // the org by the hardcoded ORG_SLUG rather than any id this test could
    // pass in — same reason orders-idempotency.integration.test.ts's own
    // fixture uses this slug. Safe here for the same reason it is there:
    // this suite runs against the local, isolated database only, and
    // integration test files run sequentially (fileParallelism: false),
    // each creating and deleting its own "frybird"-slugged org in turn.
    org = await createTestOrg({ slug: ORG_SLUG });
    await setLoyaltyEarning(org);

    // Test-only fault-injection scaffolding — this database only (the
    // integration setup refuses to run at all against anything else).
    await db().execute(sql`CREATE TABLE IF NOT EXISTS test_settle_fault_orders (order_id uuid PRIMARY KEY)`);
    await db().execute(sql`
      CREATE OR REPLACE FUNCTION test_settle_fault() RETURNS TRIGGER AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM test_settle_fault_orders WHERE order_id = NEW.entity_id) THEN
          RAISE EXCEPTION 'test: deliberate settle() failure to prove atomicity (order %)', NEW.entity_id;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await db().execute(sql`DROP TRIGGER IF EXISTS test_settle_fault_trigger ON audit_logs`);
    await db().execute(sql`CREATE TRIGGER test_settle_fault_trigger BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_settle_fault()`);
  });

  afterAll(async () => {
    // deleteTestOrg first, in its own try/finally: if any DROP below were to
    // throw, the "frybird" slug this file borrows (see the comment on
    // createTestOrg above) must still be freed — otherwise the next test
    // file that needs the same slug (orders-idempotency.integration.test.ts)
    // fails in its own beforeAll for a reason that has nothing to do with it.
    try {
      await deleteTestOrg(org.orgId);
    } finally {
      await db().execute(sql`DROP TRIGGER IF EXISTS test_settle_fault_trigger ON audit_logs`);
      await db().execute(sql`DROP FUNCTION IF EXISTS test_settle_fault()`);
      await db().execute(sql`DROP TABLE IF EXISTS test_settle_fault_orders`);
    }
  });

  afterEach(async () => {
    // Belt and braces — never leave a fault armed between tests even if one fails mid-way.
    await db().execute(sql`DELETE FROM test_settle_fault_orders`);
  });

  it("an interrupted settlement leaves nothing behind — no captured payment, no status change, no points", async () => {
    const customer = await createTestCustomer(org.orgId);
    const orderId = await createOrderPendingPayment(org, { customerId: customer.id, grandTotalRupees: "300" });
    await armSettleFailure(orderId);

    await expect(
      recordCashPayment({ orderId, actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: org.orgId, tendered: fromRupees("300") }),
    ).rejects.toThrow();

    // The payment row, the invoice number, the PAID transition and the
    // points award all happened earlier in the SAME transaction as the
    // audit_logs insert that just threw — none of them can have survived
    // the rollback if atomicity actually holds.
    const capturedRows = await db().select().from(payments).where(and(eq(payments.orderId, orderId), eq(payments.status, "CAPTURED")));
    expect(capturedRows).toHaveLength(0);

    const [order] = await db().select({ status: orders.status, invoiceNumber: orders.invoiceNumber, pointsEarned: orders.pointsEarned }).from(orders).where(eq(orders.id, orderId));
    expect(order?.status).toBe("PENDING_PAYMENT"); // never moved
    expect(order?.invoiceNumber).toBeNull(); // never issued
    expect(order?.pointsEarned).toBe(0); // never awarded

    const [account] = await db().select({ pointsBalance: loyaltyAccounts.pointsBalance }).from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, customer.id));
    expect(account).toBeUndefined(); // the points-award block's own writes never survived either
  });

  it("a retry after that rollback completes cleanly — one payment row, correct status, points awarded exactly once", async () => {
    const customer = await createTestCustomer(org.orgId);
    const orderId = await createOrderPendingPayment(org, { customerId: customer.id, grandTotalRupees: "300" });
    await armSettleFailure(orderId);

    // First attempt: forced to fail on the very last statement.
    await expect(
      recordCashPayment({ orderId, actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: org.orgId, tendered: fromRupees("300") }),
    ).rejects.toThrow();

    // Disarm — the real-world equivalent of whatever transient condition
    // caused the failure no longer applying. Same idempotency key as the
    // first attempt (`cash-payment:${orderId}`, derived from the order id
    // alone) — this is genuinely the same retry a second button press or a
    // webhook redelivery would produce, not a fresh, different request.
    await disarmSettleFailure(orderId);

    const result = await recordCashPayment({ orderId, actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: org.orgId, tendered: fromRupees("300") });
    expect(result.ok).toBe(true);

    const capturedRows = await db().select().from(payments).where(and(eq(payments.orderId, orderId), eq(payments.status, "CAPTURED")));
    expect(capturedRows).toHaveLength(1); // never duplicated across the two attempts

    const [order] = await db().select({ status: orders.status, invoiceNumber: orders.invoiceNumber, pointsEarned: orders.pointsEarned }).from(orders).where(eq(orders.id, orderId));
    expect(order?.status).toBe("PAID");
    expect(order?.invoiceNumber).toBeTruthy();
    expect(order?.pointsEarned).toBe(15); // 5% of ₹300 at ₹1/point — not 30

    const [account] = await db().select({ pointsBalance: loyaltyAccounts.pointsBalance }).from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, customer.id));
    expect(account?.pointsBalance).toBe(15); // the failed attempt's points block left nothing behind, so this is not doubled

    const ledgerRows = await db().select().from(loyaltyTransactions).where(eq(loyaltyTransactions.orderId, orderId));
    expect(ledgerRows).toHaveLength(1); // exactly one earn entry, not one per attempt

    // The one assertion in this test that actually distinguishes atomic
    // from not: the fault fires on the audit_logs insert itself, the very
    // last statement. Without atomicity, everything before it (payment row,
    // invoice, points) would have already individually committed on the
    // first attempt, so the second attempt's "already captured" fast path
    // — correct on its own — would short-circuit before ever reaching
    // work() again, and the payment_captured audit row that attempt 1
    // failed to write would simply never get written at all. With
    // atomicity, attempt 1 leaves nothing, so attempt 2 runs work() fresh
    // and writes it for real.
    const auditRows = await db().select().from(auditLogs).where(and(eq(auditLogs.entity, "orders"), eq(auditLogs.entityId, orderId), eq(auditLogs.action, "payment_captured")));
    expect(auditRows).toHaveLength(1);
  });

  it("a cash double-tap after a genuinely successful settlement now reports success, not a false failure", async () => {
    const orderId = await createOrderPendingPayment(org, { grandTotalRupees: "150" });

    const first = await recordCashPayment({ orderId, actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: org.orgId, tendered: fromRupees("150") });
    expect(first.ok).toBe(true);

    // Same order, a second press — recordCashPayment's own doc comment
    // promises this reports "already settled", not a failure that looks
    // like the first press didn't work. Before this priority's fix, cash
    // never had a providerPaymentId to match against, so this branch
    // always fell through to "That order has already been paid."
    const second = await recordCashPayment({ orderId, actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: org.orgId, tendered: fromRupees("150") });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.replayed).toBe(true);
    if (!first.ok) throw new Error("unreachable");
    expect(second.paymentId).toBe(first.paymentId);

    const capturedRows = await db().select().from(payments).where(and(eq(payments.orderId, orderId), eq(payments.status, "CAPTURED")));
    expect(capturedRows).toHaveLength(1); // the double-tap never wrote a second row
  });
});

/**
 * Baseline P2-2: two genuinely concurrent settlements of the same order —
 * cash at the counter while the customer pays online — used to both pass the
 * pre-transaction "already captured" check (it runs before either commits)
 * and both capture: two CAPTURED payments, one meal charged twice.
 *
 * The fix is the order-row `SELECT ... FOR UPDATE` at the top of settle()'s
 * transaction, plus a re-check of captured payments under that lock: the
 * loser blocks until the winner commits, then sees the capture and refuses.
 *
 * The online side is exercised for real through recordOnlinePayment: the
 * Razorpay keys are stubbed into the environment and global fetch answers
 * api.razorpay.com with a recorded-shape captured payment — no network, no
 * gateway, exactly the amount the pending payment was opened for. Nothing
 * else uses fetch here (the database speaks over a socket), and the stub
 * passes any other URL through untouched.
 */
describe("settle() concurrent double-capture (baseline P2-2)", () => {
  let org: TestOrg;
  const savedKeyId = process.env.RAZORPAY_KEY_ID;
  const savedKeySecret = process.env.RAZORPAY_KEY_SECRET;
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    // Its own random-slug org: these orders carry no customer, so settle()
    // never resolves loyalty config through the shared ORG_SLUG lookup and
    // this block needs no claim on that contended fixture slug.
    org = await createTestOrg();
    process.env.RAZORPAY_KEY_ID = "rzp_test_integration";
    process.env.RAZORPAY_KEY_SECRET = "integration-test-secret";
  });

  afterAll(async () => {
    if (savedKeyId === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = savedKeyId;
    if (savedKeySecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
    else process.env.RAZORPAY_KEY_SECRET = savedKeySecret;
    vi.unstubAllGlobals();
    await deleteTestOrg(org.orgId);
  });

  function stubRazorpayPaymentFetch(payment: { id: string; order_id: string; amount: number }) {
    vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("https://api.razorpay.com/")) {
        return new Response(
          JSON.stringify({ ...payment, currency: "INR", status: "captured", method: "upi", fee: 0, tax: 0 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return realFetch(input as Parameters<typeof fetch>[0], init);
    }) as typeof fetch);
  }

  async function createOnlineOrderAwaitingPayment(amountRupees: string) {
    const orderId = await createOrderPendingPayment(org, { grandTotalRupees: amountRupees });
    const providerOrderId = `order_test_${randomUUID().slice(0, 12)}`;
    await db().insert(payments).values({
      orgId: org.orgId,
      orderId,
      status: "PENDING",
      method: "UPI",
      amount: fromRupees(amountRupees),
      provider: "razorpay",
      providerOrderId,
    });
    return { orderId, providerOrderId };
  }

  it("cash and online settling the same order at the same instant capture exactly once; the loser gets a clear refusal", async () => {
    const { orderId, providerOrderId } = await createOnlineOrderAwaitingPayment("200");
    const providerPaymentId = `pay_test_${randomUUID().slice(0, 12)}`;
    stubRazorpayPaymentFetch({ id: providerPaymentId, order_id: providerOrderId, amount: 20000 });
    await warmPool();

    // Deterministic, not timing-dependent: hold the order row's lock until
    // BOTH settlements are provably inside their transactions, blocked on
    // it — so both have already passed the pre-transaction check, and the
    // loser's refusal can only have come from the re-check under the lock.
    const [cash, online] = await withOrderRowHeld(orderId, 2, () => [
      recordCashPayment({ orderId, actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: org.orgId, tendered: fromRupees("200") }),
      recordOnlinePayment({ orderId, providerPaymentId }),
    ]);
    if (!cash || !online) throw new Error("unreachable");

    // Exactly one of the two took the money; the other was told, in words a
    // cashier can act on, that it was already paid. Which one wins is timing.
    const results = [cash, online];
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const loser = results.find((result) => !result.ok);
    if (!loser || loser.ok) throw new Error("expected exactly one refusal");
    expect(loser.error).toMatch(/already been paid/);

    // THE assertion this card exists for: one order, one CAPTURED payment —
    // never a cash capture and an online capture side by side.
    const capturedRows = await db().select().from(payments).where(and(eq(payments.orderId, orderId), eq(payments.status, "CAPTURED")));
    expect(capturedRows).toHaveLength(1);

    const [order] = await db().select({ status: orders.status, invoiceNumber: orders.invoiceNumber }).from(orders).where(eq(orders.id, orderId));
    expect(order?.status).toBe("PAID");
    expect(order?.invoiceNumber).toBeTruthy();

    // The loser's refusal was produced inside withIdempotency's work (the
    // pre-check answers before a key is ever claimed) and stored there.
    const loserKey = cash.ok ? `razorpay-payment:${providerPaymentId}` : `cash-payment:${orderId}`;
    const [loserRow] = await db().select({ responseSnapshot: idempotencyKeys.responseSnapshot }).from(idempotencyKeys).where(and(eq(idempotencyKeys.key, loserKey), eq(idempotencyKeys.operation, "recordPayment")));
    expect(loserRow?.responseSnapshot).toMatchObject({ ok: false, error: expect.stringMatching(/already been paid/) });
  });
});

/**
 * pay-6: settle() on an order that must not take money again.
 *
 * F13 (ref-1 DATABASE-RELIABILITY): the "already paid" checks only knew the
 * CAPTURED payment status. Once a refund moved the payment to REFUNDED or
 * PARTIALLY_REFUNDED, and the order sat anywhere but PAID/COMPLETED, staff
 * could book a fresh capture against the same order — or, while the original
 * `cash-payment:<order>` idempotency row still existed, be told a stale
 * "taken" success for money that had in fact gone back.
 *
 * Red-team ord-2 item 4: settle() recorded cash against CANCELLED, FAILED and
 * REFUNDED orders, and minted points and a stamp for it.
 *
 * Both are refused now, under the order-row lock and on the fast path alike,
 * with nothing written and no loyalty minted.
 */
describe("settle() refuses refunded payments and terminal orders (pay-6)", () => {
  let org: TestOrg;

  beforeAll(async () => {
    // ORG_SLUG for the same reason as the atomicity block above: loyalty and
    // stamp config resolve through getOrg(). That block's afterAll has
    // already released the slug by the time this one starts.
    org = await createTestOrg({ slug: ORG_SLUG });
    await setLoyaltyEarning(org);
    // Stamp card on (the column default), any spend above ₹0 qualifies.
    await db().update(organizations).set({ stampRewardEnabled: true, stampsRequired: 7, stampMinOrderValue: fromRupees("0") }).where(eq(organizations.id, org.orgId));
  });

  afterAll(async () => {
    await deleteTestOrg(org.orgId);
  });

  async function loyaltySnapshot(customerId: string, orderId: string) {
    const [account] = await db().select({ pointsBalance: loyaltyAccounts.pointsBalance }).from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, customerId));
    const earnRows = await db().select().from(loyaltyTransactions).where(eq(loyaltyTransactions.orderId, orderId));
    const stampRows = await db().select().from(loyaltyStampEvents).where(eq(loyaltyStampEvents.orderId, orderId));
    const [order] = await db().select({ pointsEarned: orders.pointsEarned }).from(orders).where(eq(orders.id, orderId));
    return { points: account?.pointsBalance ?? 0, earnRows: earnRows.length, stampRows: stampRows.length, orderPoints: order?.pointsEarned ?? 0 };
  }

  async function capturedCount(orderId: string) {
    const rows = await db().select().from(payments).where(and(eq(payments.orderId, orderId), eq(payments.status, "CAPTURED")));
    return rows.length;
  }

  /** The TTL cleanup of `cash-payment:<order>` — after it, nothing but settle()'s own checks stands between staff and a second capture. */
  async function purgeCashIdempotencyKey(orderId: string) {
    await db().delete(idempotencyKeys).where(eq(idempotencyKeys.key, `cash-payment:${orderId}`));
  }

  async function settleCash(orderId: string, amountRupees = "300") {
    return recordCashPayment({ orderId, actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: org.orgId, tendered: fromRupees(amountRupees) });
  }

  it("settle after a full cash refund is refused — no new CAPTURED row, no extra points or stamp", async () => {
    const customer = await createTestCustomer(org.orgId);
    const orderId = await createOrderPendingPayment(org, { customerId: customer.id, grandTotalRupees: "300" });

    const first = await settleCash(orderId);
    if (!first.ok) throw new Error(`fixture: first settlement failed: ${first.error}`);

    const refund = await refundPayment({ paymentId: first.paymentId, amount: fromRupees("300"), reason: "customer complaint", actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: org.orgId, idempotencyKey: randomUUID() });
    expect(refund.ok).toBe(true);
    const [refundedPayment] = await db().select({ status: payments.status }).from(payments).where(eq(payments.id, first.paymentId));
    expect(refundedPayment?.status).toBe("REFUNDED");

    const before = await loyaltySnapshot(customer.id, orderId);

    // A second "taken" press with the original idempotency row still there:
    // must not claim success for money that went back.
    const again = await settleCash(orderId);
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error("unreachable");
    expect(again.error).toMatch(/refunded/);

    // And once that row has expired: must not capture a second time.
    await purgeCashIdempotencyKey(orderId);
    const afterPurge = await settleCash(orderId);
    expect(afterPurge.ok).toBe(false);
    if (afterPurge.ok) throw new Error("unreachable");
    expect(afterPurge.error).toMatch(/refunded/);

    expect(await capturedCount(orderId)).toBe(0);
    expect(await loyaltySnapshot(customer.id, orderId)).toEqual(before);
  });

  it("settle after a partial refund is refused, with the order still in the kitchen", async () => {
    const customer = await createTestCustomer(org.orgId);
    const orderId = await createOrderPendingPayment(org, { customerId: customer.id, grandTotalRupees: "300" });

    const first = await settleCash(orderId);
    if (!first.ok) throw new Error(`fixture: first settlement failed: ${first.error}`);
    // The kitchen has moved on — past the PAID status the old guard looked at.
    await db().update(orders).set({ status: "PREPARING" }).where(eq(orders.id, orderId));

    const refund = await refundPayment({ paymentId: first.paymentId, amount: fromRupees("100"), reason: "missing side", actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: org.orgId, idempotencyKey: randomUUID() });
    expect(refund.ok).toBe(true);
    const [partlyRefunded] = await db().select({ status: payments.status }).from(payments).where(eq(payments.id, first.paymentId));
    expect(partlyRefunded?.status).toBe("PARTIALLY_REFUNDED");

    const before = await loyaltySnapshot(customer.id, orderId);

    const again = await settleCash(orderId);
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error("unreachable");
    expect(again.error).toMatch(/refunded/);

    await purgeCashIdempotencyKey(orderId);
    const afterPurge = await settleCash(orderId);
    expect(afterPurge.ok).toBe(false);

    expect(await capturedCount(orderId)).toBe(0);
    expect(await loyaltySnapshot(customer.id, orderId)).toEqual(before);
    const [order] = await db().select({ status: orders.status }).from(orders).where(eq(orders.id, orderId));
    expect(order?.status).toBe("PREPARING");
  });

  it.each(["CANCELLED", "FAILED", "REFUNDED"] as const)("settle on a %s order is refused — nothing captured, invoiced or minted", async (status) => {
    const customer = await createTestCustomer(org.orgId);
    const orderId = await createOrderPendingPayment(org, { customerId: customer.id, grandTotalRupees: "300" });
    await db().update(orders).set({ status }).where(eq(orders.id, orderId));

    const result = await settleCash(orderId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(new RegExp(status.toLowerCase()));

    expect(await capturedCount(orderId)).toBe(0);
    const [order] = await db().select({ status: orders.status, invoiceNumber: orders.invoiceNumber }).from(orders).where(eq(orders.id, orderId));
    expect(order?.status).toBe(status);
    expect(order?.invoiceNumber).toBeNull();
    expect(await loyaltySnapshot(customer.id, orderId)).toEqual({ points: 0, earnRows: 0, stampRows: 0, orderPoints: 0 });
    const auditRows = await db().select().from(auditLogs).where(and(eq(auditLogs.entityId, orderId), eq(auditLogs.action, "payment_captured")));
    expect(auditRows).toHaveLength(0);
  });

  it.each(["CANCELLED", "FAILED"] as const)("an AUTHORIZED online payment on a %s order cannot be captured by settle", async (status) => {
    const orderId = await createOrderPendingPayment(org, { grandTotalRupees: "300" });
    const providerPaymentId = `pay_test_${randomUUID().slice(0, 12)}`;
    await db().insert(payments).values({ orgId: org.orgId, orderId, status: "AUTHORIZED", method: "UPI", amount: fromRupees("300"), provider: "razorpay", providerPaymentId, providerOrderId: `order_test_${randomUUID().slice(0, 12)}` });
    await db().update(orders).set({ status }).where(eq(orders.id, orderId));

    // Refused before the provider is ever asked to capture: no Razorpay keys
    // or fetch stub are set up in this block, so reaching capture would throw.
    const result = await recordOnlinePayment({ orderId, providerPaymentId });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(new RegExp(status.toLowerCase()));
    expect(await capturedCount(orderId)).toBe(0);
    const [authorized] = await db().select({ status: payments.status }).from(payments).where(eq(payments.providerPaymentId, providerPaymentId));
    expect(authorized?.status).toBe("AUTHORIZED");
  });

  it.each([
    ["the order was cancelled", "CANCELLED" as const, /cancelled/],
    ["the payment was refunded", "REFUND" as const, /refunded/],
  ])("a refusal decided under the lock (%s while settle waited) is thrown, not stored — the key stays free", async (_label, change, message) => {
    const customer = await createTestCustomer(org.orgId);
    const orderId = await createOrderPendingPayment(org, { customerId: customer.id, grandTotalRupees: "300" });
    await warmPool();

    const [result] = await withOrderRowHeld(orderId, 1, () => [settleCash(orderId)], async (tx) => {
      if (change === "CANCELLED") {
        await tx.update(orders).set({ status: "CANCELLED" }).where(eq(orders.id, orderId));
      } else {
        // A capture and its full refund that committed while this settlement waited.
        await tx.insert(payments).values({ orgId: org.orgId, orderId, status: "REFUNDED", method: "UPI", amount: fromRupees("300"), provider: "razorpay", providerPaymentId: `pay_test_${randomUUID().slice(0, 12)}`, capturedAt: new Date() });
      }
    });

    expect(result?.ok).toBe(false);
    if (!result || result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(message);

    // Nothing stored under the key: the database, re-read on every call,
    // stays the only thing that answers for this order.
    const keyRows = await db().select().from(idempotencyKeys).where(eq(idempotencyKeys.key, `cash-payment:${orderId}`));
    expect(keyRows).toHaveLength(0);

    expect(await capturedCount(orderId)).toBe(0);
    expect(await loyaltySnapshot(customer.id, orderId)).toEqual({ points: 0, earnRows: 0, stampRows: 0, orderPoints: 0 });
  });

  it("a genuine duplicate of the same settlement, before any refund, still replays as success", async () => {
    const customer = await createTestCustomer(org.orgId);
    const orderId = await createOrderPendingPayment(org, { customerId: customer.id, grandTotalRupees: "300" });

    const first = await settleCash(orderId);
    if (!first.ok) throw new Error(`fixture: first settlement failed: ${first.error}`);
    // Even with the idempotency row gone, the captured payment itself identifies the replay.
    await purgeCashIdempotencyKey(orderId);
    const second = await settleCash(orderId);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.replayed).toBe(true);
    expect(second.paymentId).toBe(first.paymentId);
    expect(await capturedCount(orderId)).toBe(1);
    expect((await loyaltySnapshot(customer.id, orderId)).earnRows).toBe(1);
  });
});
