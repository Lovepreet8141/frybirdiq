/**
 * refundPayment against a real database — this priority's fix.
 *
 * Two separate guarantees, both only provable against a real Postgres:
 *  1. A retried request with the SAME idempotency key never refunds twice
 *     (withIdempotency).
 *  2. Two genuinely concurrent requests with DIFFERENT keys against the
 *     SAME payment never together refund more than was captured — the
 *     `SELECT ... FOR UPDATE` inside the transaction serializes them, so
 *     the second one sees the first one's committed deduction before it
 *     checks its own amount against what is left.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, idempotencyKeys, loyaltyAccounts, loyaltyTransactions, orderEvents, orders, payments, refunds } from "@/db/schema";
import { refundPayment } from "./payments";
import { fingerprint } from "./idempotency";
import { createTestCustomer, createTestOrg, createTestProduct, createTestTaxRate, deleteTestOrg, warmPool, type TestOrg } from "./__test-support__/fixtures";
import { istInstant, seedSale } from "./__test-support__/iq-fixtures";
import { getProfitAndLoss, getProfitAndLossReport } from "./expenses";
import { readDailyFacts, recomputeDay } from "./iq-facts";
import { computeTrustDay } from "./iq-trust";
import { addDays, businessDate, endOfBusinessDay, startOfBusinessDay } from "@/lib/dates";
import { fromRupees } from "@/lib/money";
import { CASH_PROVIDER } from "@/lib/payments";

async function createCapturedPayment(org: TestOrg, orderId: string, amountRupees: string) {
  const [payment] = await db()
    .insert(payments)
    .values({
      orgId: org.orgId,
      orderId,
      status: "CAPTURED",
      method: "CASH",
      amount: fromRupees(amountRupees),
      provider: CASH_PROVIDER,
      capturedAt: new Date(),
    })
    .returning({ id: payments.id });
  if (!payment) throw new Error("fixture: payment insert returned no row");
  return payment.id;
}

async function createTestOrder(org: TestOrg, productSlug: string, amountRupees: string) {
  const { orders } = await import("@/db/schema");
  const [order] = await db()
    .insert(orders)
    .values({
      orgId: org.orgId,
      locationId: org.locationId,
      orderNumber: `TEST-${randomUUID().slice(0, 8)}`,
      businessDate: new Date().toISOString().slice(0, 10),
      status: "PAID",
      channel: "TAKEAWAY",
      fulfilment: "TAKEAWAY",
      grandTotal: fromRupees(amountRupees),
    })
    .returning({ id: orders.id });
  if (!order) throw new Error("fixture: order insert returned no row");
  return order.id;
}

describe("refundPayment", () => {
  let org: TestOrg;
  let productSlug: string;

  beforeAll(async () => {
    org = await createTestOrg();
    const taxRate = await createTestTaxRate(org.orgId);
    const product = await createTestProduct(org.orgId, { taxRateId: taxRate.id, basePriceRupees: "99" });
    productSlug = product.slug;
  });

  afterAll(async () => {
    await deleteTestOrg(org.orgId);
  });

  it("refunds a captured payment", async () => {
    const orderId = await createTestOrder(org, productSlug, "300");
    const paymentId = await createCapturedPayment(org, orderId, "300");

    const result = await refundPayment({
      paymentId,
      amount: fromRupees("300"),
      reason: "wrong order",
      actorUserId: randomUUID(),
      actorRoles: ["OWNER"],
      orgId: org.orgId,
      idempotencyKey: randomUUID(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.fullyRefunded).toBe(true);

    const [payment] = await db().select().from(payments).where(eq(payments.id, paymentId));
    expect(payment?.status).toBe("REFUNDED");
  });

  it("the exact guarantee: a retried call with the SAME key never refunds twice", async () => {
    const orderId = await createTestOrder(org, productSlug, "200");
    const paymentId = await createCapturedPayment(org, orderId, "200");
    const key = randomUUID();

    const input = {
      paymentId,
      amount: fromRupees("100"),
      reason: "partial, retried",
      actorUserId: randomUUID(),
      actorRoles: ["OWNER"] as const,
      orgId: org.orgId,
      idempotencyKey: key,
    };

    const first = await refundPayment(input);
    const second = await refundPayment(input);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("unreachable");
    expect(second.refundId).toBe(first.refundId);

    const refundRows = await db().select().from(refunds).where(eq(refunds.paymentId, paymentId));
    expect(refundRows).toHaveLength(1); // not two ₹100 refunds
  });

  it("two concurrent refunds with DIFFERENT keys never together exceed what was captured", async () => {
    const orderId = await createTestOrder(org, productSlug, "150");
    const paymentId = await createCapturedPayment(org, orderId, "150");

    // A cold pool's first two concurrent queries can end up serialized by
    // connection-acquisition latency alone, before either ever reaches the
    // FOR UPDATE lock this test exists to prove — which would let this test
    // pass whether or not that lock is even there. Warm the pool first so
    // the race below is a real one.
    await warmPool();

    // Both ask for the full ₹150 at once — a real over-refund race if the
    // balance check were not serialized against the payment row.
    const [a, b] = await Promise.all([
      refundPayment({
        paymentId,
        amount: fromRupees("150"),
        reason: "race attempt A",
        actorUserId: randomUUID(),
        actorRoles: ["OWNER"],
        orgId: org.orgId,
        idempotencyKey: randomUUID(),
      }),
      refundPayment({
        paymentId,
        amount: fromRupees("150"),
        reason: "race attempt B",
        actorUserId: randomUUID(),
        actorRoles: ["OWNER"],
        orgId: org.orgId,
        idempotencyKey: randomUUID(),
      }),
    ]);

    const results = [a, b];
    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    expect(succeeded).toHaveLength(1); // exactly one of the two gets the money
    expect(failed).toHaveLength(1);
    if (failed[0]?.ok !== false) throw new Error("unreachable");
    // Either message is a correct rejection of the loser: the lock
    // serializes the two, so by the time the second one gets its turn the
    // payment may already show REFUNDED (if it read after the winner's
    // commit) rather than "insufficient remaining" — both mean the same
    // thing: nothing was left, so nothing more went out.
    expect(failed[0].error).toMatch(/left to refund|already .*refund|can be refunded/);

    const refundRows = await db().select({ amount: refunds.amount }).from(refunds).where(eq(refunds.paymentId, paymentId));
    const totalRefunded = refundRows.reduce((sum, row) => sum + row.amount, 0n);
    expect(totalRefunded).toBe(fromRupees("150")); // never more than was captured
  });

  it("rejects a refund larger than what remains", async () => {
    const orderId = await createTestOrder(org, productSlug, "100");
    const paymentId = await createCapturedPayment(org, orderId, "100");

    const result = await refundPayment({
      paymentId,
      amount: fromRupees("150"),
      reason: "too much",
      actorUserId: randomUUID(),
      actorRoles: ["OWNER"],
      orgId: org.orgId,
      idempotencyKey: randomUUID(),
    });

    expect(result.ok).toBe(false);
  });
});

/**
 * iq1-rfh: a refund refreshes the IQ daily facts it changed, once it has
 * committed. A closed period's P&L reads facts, so without this a refund of
 * an older order stayed invisible there until the nightly recompute.
 */
describe("refundPayment — facts refresh after commit (iq1-rfh)", () => {
  let org: TestOrg;
  const DAY = "2026-08-14";

  beforeAll(async () => {
    org = await createTestOrg();
  });

  afterAll(async () => {
    await deleteTestOrg(org.orgId);
  });

  async function computedSale(at: string) {
    const product = await createTestProduct(org.orgId, { name: `Refresh burger ${randomUUID().slice(0, 6)}` });
    const sale = await seedSale(org, { at: istInstant(at, "13:00"), lines: [{ productId: product.id, unitPricePaise: 24_900n }] });
    await recomputeDay(org.orgId, at);
    await computeTrustDay(org.orgId, at);
    return sale;
  }

  it("shows a refund of last month's order at once on the facts path — on the order's day and the refund's day", async () => {
    const sale = await computedSale(DAY);
    const payment = sale.payments[0]!;
    const period = { from: startOfBusinessDay(DAY), to: endOfBusinessDay(DAY), label: DAY };

    const before = await readDailyFacts(org.orgId, DAY, DAY);
    expect(before.totals.orders_paid ?? 0n).toBe(1n);
    const reportBefore = await getProfitAndLossReport(org.orgId, period);
    expect(reportBefore.source).toBe("facts");
    expect(reportBefore.pnl.revenue).toBeGreaterThan(0n);

    const result = await refundPayment({
      paymentId: payment.id,
      amount: payment.amount,
      reason: "cold fries, refunded a month later",
      actorUserId: randomUUID(),
      actorRoles: ["OWNER"],
      orgId: org.orgId,
      idempotencyKey: randomUUID(),
    });
    expect(result.ok).toBe(true);

    // The order's own day: REFUNDED takes it out of the sale set.
    const after = await readDailyFacts(org.orgId, DAY, DAY);
    expect(after.missingDates).toEqual([]);
    expect(after.totals.orders_paid ?? 0n).toBe(0n);
    expect(after.totals.orders_refunded ?? 0n).toBe(1n);

    // The closed period's P&L, still read from facts, already agrees with live.
    const reportAfter = await getProfitAndLossReport(org.orgId, period);
    expect(reportAfter.source).toBe("facts");
    expect(reportAfter.pnl).toEqual(await getProfitAndLoss(org.orgId, period));
    expect(reportAfter.pnl.revenue).toBe(0n);

    // The refund's own day (today, IST) carries the money that went back.
    const today = businessDate(new Date());
    const refundDay = await readDailyFacts(org.orgId, today, today);
    expect(refundDay.totals.refunds_amount ?? 0n).toBe(BigInt(payment.amount));
  });

  it("computes nothing and logs nothing on a database without the facts tables, and the refund still lands", async () => {
    const sale = await computedSale("2026-08-15");
    const payment = sale.payments[0]!;
    const compute = vi.fn(async () => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await refundPayment(
        { paymentId: payment.id, amount: payment.amount, reason: "no facts tables here", actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: org.orgId, idempotencyKey: randomUUID() },
        { factsRefresh: { tablesExist: async () => false, recompute: compute, scoreTrust: compute } },
      );
      expect(result.ok).toBe(true);
      expect(compute).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(await db().select().from(refunds).where(eq(refunds.paymentId, payment.id))).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("never fails the refund when the refresh itself throws", async () => {
    const sale = await computedSale("2026-08-16");
    const payment = sale.payments[0]!;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await refundPayment(
        { paymentId: payment.id, amount: payment.amount, reason: "refresh blows up", actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: org.orgId, idempotencyKey: randomUUID() },
        { factsRefresh: { tablesExist: () => Promise.reject(new Error("boom")), recompute: async () => undefined, scoreTrust: async () => undefined } },
      );
      expect(result.ok).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      const [row] = await db().select({ status: payments.status }).from(payments).where(eq(payments.id, payment.id));
      expect(row?.status).toBe("REFUNDED");
    } finally {
      warn.mockRestore();
    }
  });
});

/**
 * ref-b3: the reserve → provider → finalize → follow-up refund (design
 * Revision 2), proven against a real local database. Crashes are forced
 * deterministically by a throwaway trigger armed per order and per point;
 * Razorpay is a recorded-shape fetch stub that remembers what it refunded, so
 * a double refund would show up as a second POST. No network, no real money.
 */
describe("refundPayment — reserve, finalize, converge (ref-b3)", () => {
  let org: TestOrg;
  const realFetch = globalThis.fetch;
  const savedKeys = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
  const OWNER = ["OWNER"] as const;

  beforeAll(async () => {
    org = await createTestOrg();
    process.env.RAZORPAY_KEY_ID = "rzp_test_integration";
    process.env.RAZORPAY_KEY_SECRET = "integration-test-secret";

    await db().execute(sql`CREATE TABLE IF NOT EXISTS test_refund_faults (point text NOT NULL, order_id uuid NOT NULL, PRIMARY KEY (point, order_id))`);
    await db().execute(sql`
      CREATE OR REPLACE FUNCTION test_refund_fault() RETURNS TRIGGER AS $$
      DECLARE v_point text; v_order uuid;
      BEGIN
        IF TG_TABLE_NAME = 'refunds' THEN
          v_point := 'reserve'; v_order := NEW.order_id;
        ELSIF TG_TABLE_NAME = 'audit_logs' THEN
          IF NEW.action <> 'payment_refunded' THEN RETURN NEW; END IF;
          v_point := 'finalize'; v_order := (NEW.after->>'orderId')::uuid;
        ELSIF TG_TABLE_NAME = 'order_events' THEN
          v_point := 'money_event'; v_order := NEW.order_id;
        ELSIF TG_TABLE_NAME = 'loyalty_transactions' THEN
          IF NEW.order_id IS NULL OR NEW.reason NOT LIKE 'Reversed%' THEN RETURN NEW; END IF;
          v_point := 'reversal'; v_order := NEW.order_id;
        END IF;
        IF EXISTS (SELECT 1 FROM test_refund_faults f WHERE f.point = v_point AND f.order_id = v_order) THEN
          RAISE EXCEPTION 'test: deliberate refund fault at % (order %)', v_point, v_order;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    for (const table of ["refunds", "audit_logs", "order_events", "loyalty_transactions"]) {
      await db().execute(sql.raw(`DROP TRIGGER IF EXISTS test_refund_fault_trigger ON ${table}`));
      await db().execute(sql.raw(`CREATE TRIGGER test_refund_fault_trigger BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION test_refund_fault()`));
    }
  });

  afterAll(async () => {
    try {
      await deleteTestOrg(org.orgId);
    } finally {
      for (const table of ["refunds", "audit_logs", "order_events", "loyalty_transactions"]) {
        await db().execute(sql.raw(`DROP TRIGGER IF EXISTS test_refund_fault_trigger ON ${table}`));
      }
      await db().execute(sql`DROP FUNCTION IF EXISTS test_refund_fault()`);
      await db().execute(sql`DROP TABLE IF EXISTS test_refund_faults`);
      if (savedKeys.id === undefined) delete process.env.RAZORPAY_KEY_ID;
      else process.env.RAZORPAY_KEY_ID = savedKeys.id;
      if (savedKeys.secret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
      else process.env.RAZORPAY_KEY_SECRET = savedKeys.secret;
    }
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await db().execute(sql`DELETE FROM test_refund_faults`);
  });

  const arm = (point: "reserve" | "finalize" | "money_event" | "reversal", orderId: string) => db().execute(sql`INSERT INTO test_refund_faults (point, order_id) VALUES (${point}, ${orderId})`);
  const disarm = (orderId: string) => db().execute(sql`DELETE FROM test_refund_faults WHERE order_id = ${orderId}`);

  /** A PAID order with one captured payment; optionally a customer holding the points it earned. */
  async function paidOrder(opts: { rupees?: string; provider?: "cash" | "razorpay"; points?: number; status?: "PAID" | "CANCELLED" } = {}) {
    const amount = fromRupees(opts.rupees ?? "300");
    const customer = opts.points ? await createTestCustomer(org.orgId) : null;
    const [order] = await db()
      .insert(orders)
      .values({
        orgId: org.orgId,
        locationId: org.locationId,
        orderNumber: `TEST-${randomUUID().slice(0, 8)}`,
        businessDate: new Date().toISOString().slice(0, 10),
        status: opts.status ?? "PAID",
        channel: "TAKEAWAY",
        fulfilment: "TAKEAWAY",
        customerId: customer?.id ?? null,
        pointsEarned: opts.points ?? 0,
        grandTotal: amount,
      })
      .returning({ id: orders.id, orderNumber: orders.orderNumber });
    if (!order) throw new Error("fixture: order insert returned no row");
    const razorpay = opts.provider === "razorpay";
    const [payment] = await db()
      .insert(payments)
      .values({
        orgId: org.orgId,
        orderId: order.id,
        status: "CAPTURED",
        method: razorpay ? "UPI" : "CASH",
        amount,
        provider: razorpay ? "razorpay" : CASH_PROVIDER,
        providerPaymentId: razorpay ? `pay_test_${randomUUID().slice(0, 12)}` : null,
        capturedAt: new Date(),
      })
      .returning({ id: payments.id });
    if (!payment) throw new Error("fixture: payment insert returned no row");
    if (customer && opts.points) {
      const [account] = await db().insert(loyaltyAccounts).values({ orgId: org.orgId, customerId: customer.id, pointsBalance: opts.points }).returning({ id: loyaltyAccounts.id });
      await db().insert(loyaltyTransactions).values({ orgId: org.orgId, accountId: account!.id, points: opts.points, reason: `Order #${order.orderNumber}`, orderId: order.id });
    }
    return { orderId: order.id, paymentId: payment.id, amount };
  }

  /** Razorpay, as far as these tests can tell: it remembers each refund by our row id, like the real one. */
  function stubRazorpay() {
    const state = {
      mode: "processed" as "processed" | "pending" | "short" | "http400" | "http500",
      posts: 0,
      gets: 0,
      keys: [] as string[],
      refunds: [] as { id: string; entity: "refund"; amount: number; currency: "INR"; status: string; notes: Record<string, string> }[],
    };
    vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith("https://api.razorpay.com/")) return realFetch(input as Parameters<typeof fetch>[0], init);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (init?.method === "POST") {
        state.posts += 1;
        state.keys.push((init.headers as Record<string, string>)["X-Refund-Idempotency"] ?? "");
        if (state.mode === "http500") return new Response("", { status: 500 });
        if (state.mode === "http400") return json({ error: { code: "BAD_REQUEST_ERROR", description: "The payment has been fully refunded already" } }, 400);
        const body = JSON.parse(String(init.body)) as { amount: number; notes: Record<string, string> };
        let refund = state.refunds.find((r) => r.notes.frybirdRefundId === body.notes.frybirdRefundId);
        if (!refund) {
          refund = { id: `rfnd_${randomUUID().slice(0, 10)}`, entity: "refund", amount: state.mode === "short" ? body.amount - 100 : body.amount, currency: "INR", status: state.mode === "pending" ? "pending" : "processed", notes: body.notes };
          state.refunds.push(refund);
        }
        return json(refund);
      }
      state.gets += 1;
      return json({ entity: "collection", count: state.refunds.length, items: state.refunds });
    }) as typeof fetch);
    return state;
  }

  const refundRows = (paymentId: string) => db().select().from(refunds).where(and(eq(refunds.paymentId, paymentId), eq(refunds.orgId, org.orgId)));
  const statusOf = async (table: "payment" | "order", id: string) =>
    table === "payment"
      ? (await db().select({ s: payments.status }).from(payments).where(eq(payments.id, id)))[0]?.s
      : (await db().select({ s: orders.status }).from(orders).where(eq(orders.id, id)))[0]?.s;
  const moneyEvents = (orderId: string) =>
    db().select().from(orderEvents).where(and(eq(orderEvents.orderId, orderId), sql`${orderEvents.metadata}->>'refundId' IS NOT NULL`));
  const reversals = (orderId: string) =>
    db().select().from(loyaltyTransactions).where(and(eq(loyaltyTransactions.orderId, orderId), sql`${loyaltyTransactions.reason} LIKE 'Reversed%'`));
  const refund = (paymentId: string, amount: bigint, key: string, reason = "cold fries") =>
    refundPayment({ paymentId, amount: amount as ReturnType<typeof fromRupees>, reason, actorUserId: randomUUID(), actorRoles: OWNER, orgId: org.orgId, idempotencyKey: key });

  it("a full cash refund: RESERVED then SUCCEEDED with finalized_at, payment REFUNDED, order REFUNDED, one money event, both audit rows, points back", async () => {
    const o = await paidOrder({ points: 15 });
    const key = randomUUID();
    const result = await refund(o.paymentId, o.amount, key);

    expect(result).toMatchObject({ ok: true, fullyRefunded: true, orderId: o.orderId });
    const [row] = await refundRows(o.paymentId);
    expect(row).toMatchObject({ status: "SUCCEEDED", idempotencyKey: key });
    expect(row?.finalizedAt).toBeInstanceOf(Date);
    expect(await statusOf("payment", o.paymentId)).toBe("REFUNDED");
    expect(await statusOf("order", o.orderId)).toBe("REFUNDED");
    expect(await moneyEvents(o.orderId)).toHaveLength(1);
    expect(await reversals(o.orderId)).toHaveLength(1);
    const audits = await db().select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.orgId, org.orgId), sql`(${auditLogs.entityId} = ${row!.id} OR ${auditLogs.entityId} = ${o.paymentId})`));
    expect(audits.map((a) => a.action).sort()).toEqual(["payment_refunded", "refund_reserved"]);
  });

  it("a crash inside RESERVE leaves nothing — no row, payment untouched, claim released — and the retry refunds once", async () => {
    const o = await paidOrder();
    const key = randomUUID();
    await arm("reserve", o.orderId);
    await expect(refund(o.paymentId, o.amount, key)).rejects.toThrow();
    expect(await refundRows(o.paymentId)).toHaveLength(0);
    expect(await statusOf("payment", o.paymentId)).toBe("CAPTURED");
    expect(await db().select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key))).toHaveLength(0);

    await disarm(o.orderId);
    expect((await refund(o.paymentId, o.amount, key)).ok).toBe(true);
    expect(await refundRows(o.paymentId)).toHaveLength(1);
  });

  it("pay-2: Razorpay refunds, then FINALIZE crashes — the retry finds that refund by its row id and never asks Razorpay twice", async () => {
    const gateway = stubRazorpay();
    const o = await paidOrder({ provider: "razorpay" });
    const key = randomUUID();

    await arm("finalize", o.orderId);
    await expect(refund(o.paymentId, o.amount, key)).rejects.toThrow(/Failed query/);
    const [held] = await refundRows(o.paymentId);
    expect(held?.status).toBe("RESERVED"); // the money moved at the gateway; the amount stays held
    expect(await statusOf("payment", o.paymentId)).toBe("CAPTURED");
    expect(gateway.posts).toBe(1);

    await disarm(o.orderId);
    const retried = await refund(o.paymentId, o.amount, key);
    expect(retried).toMatchObject({ ok: true, fullyRefunded: true });
    expect(gateway.posts).toBe(1); // THE assertion: no second refund request
    expect(gateway.gets).toBe(1);
    const [done] = await refundRows(o.paymentId);
    expect(done).toMatchObject({ status: "SUCCEEDED", providerRefundId: gateway.refunds[0]!.id });
    expect(await statusOf("payment", o.paymentId)).toBe("REFUNDED");
  });

  it("a Razorpay refund still 'pending' stays RESERVED and keeps its amount held; the same attempt later finishes it", async () => {
    const gateway = stubRazorpay();
    gateway.mode = "pending";
    const o = await paidOrder({ provider: "razorpay" });
    const key = randomUUID();

    const first = await refund(o.paymentId, o.amount, key);
    expect(first).toMatchObject({ ok: false, retriable: true });
    const [held] = await refundRows(o.paymentId);
    expect(held).toMatchObject({ status: "RESERVED", providerRefundId: gateway.refunds[0]!.id });
    expect(held?.finalizedAt).toBeNull();
    expect(await statusOf("payment", o.paymentId)).toBe("CAPTURED");

    // Nothing else can take the held amount meanwhile.
    const other = await refund(o.paymentId, o.amount, randomUUID(), "second manager");
    expect(other).toMatchObject({ ok: false });
    if (other.ok) throw new Error("unreachable");
    expect(other.error).toMatch(/left to refund/);

    gateway.refunds[0]!.status = "processed";
    const finished = await refund(o.paymentId, o.amount, key);
    expect(finished).toMatchObject({ ok: true, fullyRefunded: true });
    expect(gateway.posts).toBe(1);
    expect((await refundRows(o.paymentId)).filter((r) => r.status === "SUCCEEDED")).toHaveLength(1);
  });

  it("a Razorpay refusal becomes FAILED (no finalized_at, audited), releases the amount, and replays as the same failure", async () => {
    const gateway = stubRazorpay();
    gateway.mode = "http400";
    const o = await paidOrder({ provider: "razorpay" });
    const key = randomUUID();

    const failed = await refund(o.paymentId, o.amount, key);
    expect(failed).toMatchObject({ ok: false });
    expect("retriable" in failed && failed.retriable).toBeFalsy();
    const [row] = await refundRows(o.paymentId);
    expect(row).toMatchObject({ status: "FAILED", finalizedAt: null });
    expect(await statusOf("payment", o.paymentId)).toBe("CAPTURED");
    expect(await db().select().from(auditLogs).where(and(eq(auditLogs.entityId, row!.id), eq(auditLogs.action, "refund_failed")))).toHaveLength(1);

    const replay = await refund(o.paymentId, o.amount, key);
    expect(replay).toEqual(failed);
    expect(gateway.posts).toBe(1);

    gateway.mode = "processed";
    expect((await refund(o.paymentId, o.amount, randomUUID(), "second attempt")).ok).toBe(true);
  });

  it("an unknown outcome (HTTP 500) stays RESERVED; the retry looks first, then asks again under the same idempotency key", async () => {
    const gateway = stubRazorpay();
    gateway.mode = "http500";
    const o = await paidOrder({ provider: "razorpay" });
    const key = randomUUID();

    expect(await refund(o.paymentId, o.amount, key)).toMatchObject({ ok: false, retriable: true });
    const [held] = await refundRows(o.paymentId);
    expect(held?.status).toBe("RESERVED");

    gateway.mode = "processed";
    expect((await refund(o.paymentId, o.amount, key)).ok).toBe(true);
    expect(gateway.gets).toBe(1);
    expect(gateway.posts).toBe(2);
    expect(gateway.keys).toEqual([held!.id, held!.id]);
  });

  it("never books a refund Razorpay made for a different amount (S7)", async () => {
    const gateway = stubRazorpay();
    gateway.mode = "short";
    const o = await paidOrder({ provider: "razorpay" });
    expect(await refund(o.paymentId, o.amount, randomUUID())).toMatchObject({ ok: false, retriable: true });
    const [held] = await refundRows(o.paymentId);
    expect(held?.status).toBe("RESERVED");
    expect(await statusOf("payment", o.paymentId)).toBe("CAPTURED");
  });

  it("refuses a key reused for a different refund — from the stored result, and from the row itself once the claim is gone (B3)", async () => {
    const o = await paidOrder();
    const key = randomUUID();
    expect((await refund(o.paymentId, fromRupees("100"), key)).ok).toBe(true);

    const reused = await refund(o.paymentId, fromRupees("50"), key);
    expect(reused).toMatchObject({ ok: false, error: expect.stringMatching(/already used/) });

    await db().delete(idempotencyKeys).where(eq(idempotencyKeys.key, key));
    const fromRow = await refund(o.paymentId, fromRupees("50"), key);
    expect(fromRow).toMatchObject({ ok: false, error: expect.stringMatching(/already used/) });
    expect(await refundRows(o.paymentId)).toHaveLength(1);
  });

  it("pay-3: a crash after FINALIZE, before the follow-up — the retry moves the order, writes one money event and reverses points once", async () => {
    const o = await paidOrder({ points: 15 });
    const key = randomUUID();
    await arm("money_event", o.orderId);
    await expect(refund(o.paymentId, o.amount, key)).rejects.toThrow(/Failed query/);
    expect(await statusOf("payment", o.paymentId)).toBe("REFUNDED");
    expect(await statusOf("order", o.orderId)).toBe("PAID"); // the old code left it here forever
    expect(await reversals(o.orderId)).toHaveLength(0);

    await disarm(o.orderId);
    expect((await refund(o.paymentId, o.amount, key)).ok).toBe(true);
    expect(await statusOf("order", o.orderId)).toBe("REFUNDED");
    expect(await moneyEvents(o.orderId)).toHaveLength(1);
    expect(await reversals(o.orderId)).toHaveLength(1);

    expect((await refund(o.paymentId, o.amount, key)).ok).toBe(true); // and again: nothing repeats
    expect(await moneyEvents(o.orderId)).toHaveLength(1);
    expect(await reversals(o.orderId)).toHaveLength(1);
  });

  it("B4: a crash after the order became REFUNDED but before its points were reversed — the retry reverses them, exactly once", async () => {
    const o = await paidOrder({ points: 15 });
    const key = randomUUID();
    await arm("reversal", o.orderId);
    await expect(refund(o.paymentId, o.amount, key)).rejects.toThrow(/Failed query/);
    expect(await statusOf("order", o.orderId)).toBe("REFUNDED");
    expect(await reversals(o.orderId)).toHaveLength(0);

    await disarm(o.orderId);
    expect((await refund(o.paymentId, o.amount, key)).ok).toBe(true);
    expect(await reversals(o.orderId)).toHaveLength(1);
    const [account] = await db().select({ balance: loyaltyAccounts.pointsBalance }).from(loyaltyAccounts).innerJoin(orders, eq(orders.customerId, loyaltyAccounts.customerId)).where(eq(orders.id, o.orderId));
    expect(account?.balance).toBe(0);
  });

  it("two follow-ups racing on the same refund write one money event and one reversal (ref-2 double-F2 condition)", async () => {
    const o = await paidOrder({ points: 15 });
    const key = randomUUID();
    await arm("money_event", o.orderId);
    await expect(refund(o.paymentId, o.amount, key)).rejects.toThrow();
    await disarm(o.orderId);

    await warmPool();
    const [a, b] = await Promise.all([refund(o.paymentId, o.amount, key), refund(o.paymentId, o.amount, key)]);
    expect(a.ok && b.ok).toBe(true);
    expect(await moneyEvents(o.orderId)).toHaveLength(1);
    expect(await reversals(o.orderId)).toHaveLength(1);
    expect(await statusOf("order", o.orderId)).toBe("REFUNDED");
  });

  it("a full refund of a CANCELLED order leaves it CANCELLED but still reverses its points (loy-1 caller wiring)", async () => {
    const o = await paidOrder({ points: 15, status: "CANCELLED" });
    expect((await refund(o.paymentId, o.amount, randomUUID())).ok).toBe(true);
    expect(await statusOf("order", o.orderId)).toBe("CANCELLED");
    expect(await moneyEvents(o.orderId)).toHaveLength(1);
    expect(await reversals(o.orderId)).toHaveLength(1);
  });

  it("a partial refund writes its money event, leaves the order where it is, and reverses nothing", async () => {
    const o = await paidOrder({ points: 15 });
    const result = await refund(o.paymentId, fromRupees("100"), randomUUID());
    expect(result).toMatchObject({ ok: true, fullyRefunded: false });
    expect(await statusOf("payment", o.paymentId)).toBe("PARTIALLY_REFUNDED");
    expect(await statusOf("order", o.orderId)).toBe("PAID");
    expect(await moneyEvents(o.orderId)).toHaveLength(1);
    expect(await reversals(o.orderId)).toHaveLength(0);
  });

  it("refreshes facts for the order's day and the day the refund FINALIZED, never the day it was reserved (reserved 23:59, finalized next day)", async () => {
    const gateway = stubRazorpay();
    gateway.mode = "pending";
    const o = await paidOrder({ provider: "razorpay" });
    await db().update(orders).set({ createdAt: new Date("2026-08-10T07:00:00Z") }).where(eq(orders.id, o.orderId));
    const key = randomUUID();
    const days: string[] = [];
    const steps = { tablesExist: async () => true, recompute: async (_org: string, date: string) => void days.push(date), scoreTrust: async () => undefined };
    const call = () => refundPayment({ paymentId: o.paymentId, amount: o.amount, reason: "late night refund", actorUserId: randomUUID(), actorRoles: OWNER, orgId: org.orgId, idempotencyKey: key }, { factsRefresh: steps });

    expect(await call()).toMatchObject({ ok: false, retriable: true });
    // Reserved at 23:59 IST yesterday.
    const today = businessDate(new Date());
    const yesterday = addDays(today, -1);
    await db().update(refunds).set({ createdAt: new Date(startOfBusinessDay(today).getTime() - 60_000) }).where(eq(refunds.paymentId, o.paymentId));

    gateway.refunds[0]!.status = "processed";
    expect((await call()).ok).toBe(true);
    const [row] = await refundRows(o.paymentId);
    expect(row?.status).toBe("SUCCEEDED");
    expect(businessDate(row!.createdAt)).toBe(yesterday);

    expect([...new Set(days)].sort()).toEqual(["2026-08-10", businessDate(row!.finalizedAt!)].sort());
    expect(days).not.toContain(yesterday);
  });

  it("S4: a stale claim from a caller that died takes over and completes the refund once", async () => {
    const o = await paidOrder();
    const key = randomUUID();
    const reason = "stale claim";
    const request = { paymentId: o.paymentId, amount: o.amount.toString(), reason };
    await db().insert(idempotencyKeys).values({ orgId: org.orgId, key, operation: "refund_payment", requestFingerprint: fingerprint({ orgId: org.orgId, request }), expiresAt: new Date(Date.now() + 3_600_000) });

    const result = await refund(o.paymentId, o.amount, key, reason);
    expect(result.ok).toBe(true);
    expect(await refundRows(o.paymentId)).toHaveLength(1);
    expect(await statusOf("payment", o.paymentId)).toBe("REFUNDED");
  }, 30_000);
});
