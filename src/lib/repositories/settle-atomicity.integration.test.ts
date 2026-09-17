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
import { auditLogs, loyaltyAccounts, loyaltyTransactions, orders, organizations, payments } from "@/db/schema";
import { recordCashPayment, recordOnlinePayment } from "./payments";
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

    // Same reason as the refund race test: a cold pool serializes the two
    // calls on connection acquisition alone, which would hide the race this
    // test exists to prove.
    await warmPool();

    const [cash, online] = await Promise.all([
      recordCashPayment({ orderId, actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: org.orgId, tendered: fromRupees("200") }),
      recordOnlinePayment({ orderId, providerPaymentId }),
    ]);

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
  });
});
