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
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { payments, refunds } from "@/db/schema";
import { refundPayment } from "./payments";
import { createTestOrg, createTestProduct, createTestTaxRate, deleteTestOrg, warmPool, type TestOrg } from "./__test-support__/fixtures";
import { istInstant, seedSale } from "./__test-support__/iq-fixtures";
import { getProfitAndLoss, getProfitAndLossReport } from "./expenses";
import { readDailyFacts, recomputeDay } from "./iq-facts";
import { computeTrustDay } from "./iq-trust";
import { businessDate, endOfBusinessDay, startOfBusinessDay } from "@/lib/dates";
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
