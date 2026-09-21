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
import { auditLogs, idempotencyKeys, loyaltyAccounts, loyaltyStampEvents, loyaltyTransactions, orderEvents, orders, payments, refunds } from "@/db/schema";
import { countStuckRefundFollowUps, healLostRefundFollowUps, refundPayment } from "./payments";
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
  async function paidOrder(opts: { rupees?: string; provider?: "cash" | "razorpay"; points?: number; stamp?: boolean; status?: "PAID" | "CANCELLED"; secondCapture?: boolean } = {}) {
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
    // A duplicate capture of the same order (D3: possible before pay-4 deployed).
    const [second] = opts.secondCapture
      ? await db().insert(payments).values({ orgId: org.orgId, orderId: order.id, status: "CAPTURED", method: "CASH", amount, provider: CASH_PROVIDER, capturedAt: new Date() }).returning({ id: payments.id })
      : [];
    if (customer && opts.points) {
      const [account] = await db().insert(loyaltyAccounts).values({ orgId: org.orgId, customerId: customer.id, pointsBalance: opts.points }).returning({ id: loyaltyAccounts.id });
      await db().insert(loyaltyTransactions).values({ orgId: org.orgId, accountId: account!.id, points: opts.points, reason: `Order #${order.orderNumber}`, orderId: order.id });
      if (opts.stamp) await db().insert(loyaltyStampEvents).values({ orgId: org.orgId, accountId: account!.id, orderId: order.id });
    }
    return { orderId: order.id, paymentId: payment.id, secondPaymentId: second?.id ?? null, amount };
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
  const stampReversed = async (orderId: string) => (await db().select({ at: loyaltyStampEvents.reversedAt }).from(loyaltyStampEvents).where(eq(loyaltyStampEvents.orderId, orderId)))[0]?.at instanceof Date;
  /** Runs `fn` with console.warn silenced; returns what it returned and the warnings logged. */
  async function quietly<T>(fn: () => Promise<T>): Promise<{ value: T; warnings: string[] }> {
    const warnings: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => void warnings.push(String(args[0])));
    try {
      return { value: await fn(), warnings };
    } finally {
      warn.mockRestore();
    }
  }
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
    // Not filled by 0038's expand-phase DEFAULT now() (3d48a8d): the reservation writes null itself.
    expect(held?.finalizedAt).toBeNull();
    const [column] = await db().execute<{ column_default: string | null }>(sql`SELECT column_default FROM information_schema.columns WHERE table_name = 'refunds' AND column_name = 'finalized_at'`);
    expect(column?.column_default).toMatch(/now\(\)/);
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
    // The money moved, so the refund reports success; the lost follow-up is logged by name only.
    const crashed = await quietly(() => refund(o.paymentId, o.amount, key));
    expect(crashed.value.ok).toBe(true);
    expect(crashed.warnings.some((w) => /refund follow-up failed \(Error\)/.test(w))).toBe(true);
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
    expect((await quietly(() => refund(o.paymentId, o.amount, key))).value.ok).toBe(true);
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
    expect((await quietly(() => refund(o.paymentId, o.amount, key))).value.ok).toBe(true);
    await disarm(o.orderId);

    await warmPool();
    const [a, b] = await Promise.all([refund(o.paymentId, o.amount, key), refund(o.paymentId, o.amount, key)]);
    expect(a.ok && b.ok).toBe(true);
    expect(await moneyEvents(o.orderId)).toHaveLength(1);
    expect(await reversals(o.orderId)).toHaveLength(1);
    expect(await statusOf("order", o.orderId)).toBe("REFUNDED");
  });

  it("a full refund of a CANCELLED order leaves it CANCELLED but still reverses its points (loy-1 caller wiring)", async () => {
    const o = await paidOrder({ points: 15, stamp: true, status: "CANCELLED" });
    expect((await refund(o.paymentId, o.amount, randomUUID())).ok).toBe(true);
    expect(await statusOf("order", o.orderId)).toBe("CANCELLED");
    expect(await moneyEvents(o.orderId)).toHaveLength(1);
    expect(await reversals(o.orderId)).toHaveLength(1);
    expect(await stampReversed(o.orderId)).toBe(true); // POS-ORDERS #2
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

  it("FIN #1: a full refund of one of two captured payments leaves the order sold, its points and stamp kept; refunding the other makes it REFUNDED, reversing once", async () => {
    const o = await paidOrder({ points: 15, stamp: true, secondCapture: true });

    const first = await refund(o.secondPaymentId!, o.amount, randomUUID(), "double charge");
    expect(first).toMatchObject({ ok: true, fullyRefunded: false });
    expect(await statusOf("payment", o.secondPaymentId!)).toBe("REFUNDED");
    expect(await statusOf("order", o.orderId)).toBe("PAID");
    expect(await reversals(o.orderId)).toHaveLength(0);
    expect(await stampReversed(o.orderId)).toBe(false);
    const [event] = await moneyEvents(o.orderId);
    expect(event?.reason).toMatch(/^Refund ₹/); // worded from this refund alone (FIN #2)

    const second = await refund(o.paymentId, o.amount, randomUUID(), "customer returned it");
    expect(second).toMatchObject({ ok: true, fullyRefunded: true });
    expect(await statusOf("order", o.orderId)).toBe("REFUNDED");
    expect(await reversals(o.orderId)).toHaveLength(1);
    expect(await stampReversed(o.orderId)).toBe(true);
    expect(await moneyEvents(o.orderId)).toHaveLength(2);
  });

  it("POS #1: a refund whose follow-up was lost is finished by a later attempt under a NEW key, reversing exactly once", async () => {
    const o = await paidOrder({ points: 15, stamp: true });
    await arm("money_event", o.orderId);
    expect((await quietly(() => refund(o.paymentId, o.amount, randomUUID()))).value.ok).toBe(true);
    await disarm(o.orderId);
    expect(await statusOf("order", o.orderId)).toBe("PAID");
    expect(await reversals(o.orderId)).toHaveLength(0);

    // The dialog was closed and reopened: new key. The payment is fully refunded, so this is refused…
    const again = await refund(o.paymentId, o.amount, randomUUID());
    expect(again.ok).toBe(false);
    // …but the lost follow-up has been finished on the way.
    expect(await statusOf("order", o.orderId)).toBe("REFUNDED");
    expect(await moneyEvents(o.orderId)).toHaveLength(1);
    expect(await reversals(o.orderId)).toHaveLength(1);
    expect(await stampReversed(o.orderId)).toBe(true);

    expect((await refund(o.paymentId, o.amount, randomUUID())).ok).toBe(false);
    expect(await moneyEvents(o.orderId)).toHaveLength(1);
    expect(await reversals(o.orderId)).toHaveLength(1);
  });

  it("REL C2: on a resumed refund a plain 400 after a lookup that found nothing stays RESERVED — never FAILED", async () => {
    const gateway = stubRazorpay();
    gateway.mode = "pending";
    const o = await paidOrder({ provider: "razorpay" });
    const key = randomUUID();
    expect(await refund(o.paymentId, o.amount, key)).toMatchObject({ ok: false, retriable: true });

    // Razorpay's refund list lags and does not show it yet; a second POST is answered 400.
    gateway.refunds.length = 0;
    gateway.mode = "http400";
    expect(await refund(o.paymentId, o.amount, key)).toMatchObject({ ok: false, retriable: true });
    const [row] = await refundRows(o.paymentId);
    expect(row?.status).toBe("RESERVED");
    expect(row?.finalizedAt).toBeNull();
    expect(await db().select().from(auditLogs).where(and(eq(auditLogs.entityId, row!.id), eq(auditLogs.action, "refund_failed")))).toHaveLength(0);
  });

  /**
   * A full refund whose follow-up was lost part-way: the order moved and the
   * stamp was reversed, then the points reversal failed. Finalized
   * `minutesAgo` minutes ago. Exactly the case a "money event first" order
   * would hide from the healer.
   */
  async function lostFollowUp(minutesAgo: number) {
    const o = await paidOrder({ points: 15, stamp: true });
    await arm("reversal", o.orderId);
    expect((await quietly(() => refund(o.paymentId, o.amount, randomUUID()))).value.ok).toBe(true);
    await disarm(o.orderId);
    await db().update(refunds).set({ finalizedAt: new Date(Date.now() - minutesAgo * 60_000) }).where(eq(refunds.paymentId, o.paymentId));
    return o;
  }

  it("ref-b7: the healer finishes a lost full-refund follow-up once, and a second run changes nothing", async () => {
    const recent = await lostFollowUp(1);
    const o = await lostFollowUp(10);
    expect(await statusOf("order", o.orderId)).toBe("REFUNDED");
    expect(await reversals(o.orderId)).toHaveLength(0);
    expect(await moneyEvents(o.orderId)).toHaveLength(0);

    const first = await healLostRefundFollowUps({ orgId: org.orgId });
    expect(first).toEqual({ examined: 1, healed: 1, stillOpen: 0, stillOpenRefundIds: [], notReached: 0 });
    expect(await statusOf("order", o.orderId)).toBe("REFUNDED");
    expect(await reversals(o.orderId)).toHaveLength(1);
    expect(await stampReversed(o.orderId)).toBe(true);
    expect(await moneyEvents(o.orderId)).toHaveLength(1);
    // Under five minutes: possibly a live request still finishing, so left alone.
    expect(await reversals(recent.orderId)).toHaveLength(0);

    expect(await healLostRefundFollowUps({ orgId: org.orgId })).toEqual({ examined: 0, healed: 0, stillOpen: 0, stillOpenRefundIds: [], notReached: 0 });
    expect(await reversals(o.orderId)).toHaveLength(1);
    expect(await moneyEvents(o.orderId)).toHaveLength(1);

    // Tidy for the next test: the recent one, once it is old enough.
    expect(await healLostRefundFollowUps({ orgId: org.orgId, now: new Date(Date.now() + 10 * 60_000) })).toMatchObject({ healed: 1 });
  });

  it("ref-b7: the healer honours its limit, stays in its org, and never touches refunds recorded before the reserve flow", async () => {
    const a = await lostFollowUp(10);
    const b = await lostFollowUp(9);

    // A refund recorded by the old code: no idempotency key and no money event. History, not a lost follow-up.
    const legacy = await paidOrder();
    await db().update(payments).set({ status: "REFUNDED" }).where(eq(payments.id, legacy.paymentId));
    await db().insert(refunds).values({
      orgId: org.orgId,
      paymentId: legacy.paymentId,
      orderId: legacy.orderId,
      amount: legacy.amount,
      reason: "recorded before the refund redesign",
      actorUserId: randomUUID(),
      provider: CASH_PROVIDER,
      status: "SUCCEEDED",
      finalizedAt: new Date(Date.now() - 60 * 60_000),
      idempotencyKey: null,
    });

    const otherOrg = await createTestOrg();
    try {
      expect(await healLostRefundFollowUps({ orgId: otherOrg.orgId })).toEqual({ examined: 0, healed: 0, stillOpen: 0, stillOpenRefundIds: [], notReached: 0 });
    } finally {
      await deleteTestOrg(otherOrg.orgId);
    }

    expect(await healLostRefundFollowUps({ orgId: org.orgId, limit: 1 })).toEqual({ examined: 1, healed: 1, stillOpen: 0, stillOpenRefundIds: [], notReached: 0 });
    expect(await reversals(a.orderId)).toHaveLength(1); // oldest first
    expect(await reversals(b.orderId)).toHaveLength(0);
    expect(await healLostRefundFollowUps({ orgId: org.orgId, limit: 1 })).toEqual({ examined: 1, healed: 1, stillOpen: 0, stillOpenRefundIds: [], notReached: 0 });
    expect(await healLostRefundFollowUps({ orgId: org.orgId })).toEqual({ examined: 0, healed: 0, stillOpen: 0, stillOpenRefundIds: [], notReached: 0 });

    expect(await statusOf("order", legacy.orderId)).toBe("PAID");
    expect(await moneyEvents(legacy.orderId)).toHaveLength(0);
  });

  it("ref-b7: a follow-up that always fails is recorded and backed off, so it cannot starve a newer one (limit 1)", async () => {
    const poison = await lostFollowUp(30);
    await arm("reversal", poison.orderId); // stays broken across runs
    const newer = await lostFollowUp(10);
    const [poisonRefund] = await refundRows(poison.paymentId);

    const first = await quietly(() => healLostRefundFollowUps({ orgId: org.orgId, limit: 1 }));
    expect(first.value).toEqual({ examined: 1, healed: 0, stillOpen: 1, stillOpenRefundIds: [poisonRefund!.id], notReached: 0 });
    const failures = () =>
      db().select({ before: auditLogs.before, after: auditLogs.after, actor: auditLogs.actorUserId }).from(auditLogs).where(and(eq(auditLogs.entityId, poisonRefund!.id), eq(auditLogs.action, "refund_followup_failed")));
    expect(await failures()).toEqual([{ before: { attempts: 0 }, after: { attempts: 1, error: "Error", orderId: poison.orderId }, actor: null }]);

    // Next run: the failing row is backed off, and the newer lost follow-up is reached.
    expect(await healLostRefundFollowUps({ orgId: org.orgId, limit: 1 })).toEqual({ examined: 1, healed: 1, stillOpen: 0, stillOpenRefundIds: [], notReached: 0 });
    expect(await reversals(newer.orderId)).toHaveLength(1);
    expect(await healLostRefundFollowUps({ orgId: org.orgId, limit: 1 })).toEqual({ examined: 0, healed: 0, stillOpen: 0, stillOpenRefundIds: [], notReached: 0 });

    // After the back-off it is tried again, and counted again.
    const later = new Date(Date.now() + 2 * 60 * 60_000);
    expect((await quietly(() => healLostRefundFollowUps({ orgId: org.orgId, now: later }))).value).toMatchObject({ examined: 1, healed: 0, stillOpenRefundIds: [poisonRefund!.id], notReached: 0 });
    expect((await failures()).map((f) => (f.after as { attempts: number }).attempts).sort()).toEqual([1, 2]);

    // Once whatever broke it is fixed, it heals.
    await disarm(poison.orderId);
    expect(await healLostRefundFollowUps({ orgId: org.orgId, now: new Date(Date.now() + 4 * 60 * 60_000) })).toMatchObject({ examined: 1, healed: 1 });
    expect(await reversals(poison.orderId)).toHaveLength(1);
  });

  it("ref-b7: stops between refunds when shouldStop says time is up, and the next run reaches the rest", async () => {
    const a = await lostFollowUp(12);
    const b = await lostFollowUp(11);
    let asked = 0;
    const report = await healLostRefundFollowUps({ orgId: org.orgId }, { shouldStop: () => asked++ >= 1 });
    expect(report).toEqual({ examined: 1, healed: 1, stillOpen: 0, stillOpenRefundIds: [], notReached: 1 });
    expect(await reversals(a.orderId)).toHaveLength(1);
    expect(await reversals(b.orderId)).toHaveLength(0);
    // Not reached is not a failure: nothing was recorded, so it is not backed off.
    const [bRefund] = await refundRows(b.paymentId);
    expect(await db().select().from(auditLogs).where(and(eq(auditLogs.entityId, bRefund!.id), eq(auditLogs.action, "refund_followup_failed")))).toHaveLength(0);

    expect(await healLostRefundFollowUps({ orgId: org.orgId }, { shouldStop: () => false })).toEqual({ examined: 1, healed: 1, stillOpen: 0, stillOpenRefundIds: [], notReached: 0 });
    expect(await reversals(b.orderId)).toHaveLength(1);

    // Time already up: nothing is attempted.
    await lostFollowUp(10);
    expect(await healLostRefundFollowUps({ orgId: org.orgId }, { shouldStop: () => true })).toEqual({ examined: 0, healed: 0, stillOpen: 0, stillOpenRefundIds: [], notReached: 1 });
    expect(await healLostRefundFollowUps({ orgId: org.orgId })).toMatchObject({ healed: 1, notReached: 0 });
  });

  it("ref-b7j: counts a follow-up as stuck only after two failed heals, and not once it heals", async () => {
    expect(await countStuckRefundFollowUps({ orgId: org.orgId })).toBe(0);
    const o = await lostFollowUp(20);
    await arm("reversal", o.orderId);

    await quietly(() => healLostRefundFollowUps({ orgId: org.orgId }));
    expect(await countStuckRefundFollowUps({ orgId: org.orgId })).toBe(0); // one failure
    expect(await countStuckRefundFollowUps({ orgId: org.orgId, minFailures: 1 })).toBe(1);

    await quietly(() => healLostRefundFollowUps({ orgId: org.orgId, now: new Date(Date.now() + 2 * 60 * 60_000) }));
    expect(await countStuckRefundFollowUps({ orgId: org.orgId })).toBe(1); // two failures

    const otherOrg = await createTestOrg();
    try {
      expect(await countStuckRefundFollowUps({ orgId: otherOrg.orgId })).toBe(0);
    } finally {
      await deleteTestOrg(otherOrg.orgId);
    }

    await disarm(o.orderId);
    expect(await healLostRefundFollowUps({ orgId: org.orgId, now: new Date(Date.now() + 4 * 60 * 60_000) })).toMatchObject({ healed: 1 });
    expect(await countStuckRefundFollowUps({ orgId: org.orgId })).toBe(0); // healed: the money event now exists
  });

  it("ref-b7: a refund with no staff actor is healed by the system, with a null actor on its events", async () => {
    const o = await lostFollowUp(10);
    await db().update(refunds).set({ actorUserId: null }).where(eq(refunds.paymentId, o.paymentId));

    expect(await healLostRefundFollowUps({ orgId: org.orgId })).toEqual({ examined: 1, healed: 1, stillOpen: 0, stillOpenRefundIds: [], notReached: 0 });
    expect(await reversals(o.orderId)).toHaveLength(1);
    const [event] = await moneyEvents(o.orderId);
    expect(event?.actorUserId).toBeNull();
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
    // The takeover waits IN_FLIGHT_WAIT_MS (10 s) for the dead caller's result first, so on a loaded machine 30 s was too
    // tight (card flaky-s4). Test timeout only; the code and its 10 s wait are unchanged.
  }, 90_000);
});
