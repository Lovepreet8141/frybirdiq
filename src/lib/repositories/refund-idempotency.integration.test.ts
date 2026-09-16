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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { payments, refunds } from "@/db/schema";
import { refundPayment } from "./payments";
import { createTestOrg, createTestProduct, createTestTaxRate, deleteTestOrg, warmPool, type TestOrg } from "./__test-support__/fixtures";
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

  it("Priority's actual design point: two concurrent refunds with DIFFERENT keys never together exceed what was captured", async () => {
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
