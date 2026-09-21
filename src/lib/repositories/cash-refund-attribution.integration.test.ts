/**
 * Cash refunds belong to the till that paid them (till go-live checklist: `cash-refund-attribution` and
 * `till-close-micros`). A cash refund records the open till at the moment it is finalized (`refunds.cash_session_id`,
 * read FOR SHARE, the same lock as the till's close), and a till's expected cash counts exactly the refunds
 * attributed to it: no comparison of timestamps at all. So a refund can no longer fall out of a till because of a
 * millisecond, a clock, or a window edge, and a refund paid while no till is open is in no till (never guessed).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, cashHandovers, cashSessions, orders, payments, refunds } from "@/db/schema";
import { fromRupees, paise } from "@/lib/money";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { closeCashSession, openCashSession } from "./cash-sessions";
import { recordCashPayment, refundPayment } from "./payments";

let org: TestOrg;
const cashier = randomUUID();

beforeAll(async () => {
  org = await createTestOrg();
});
afterAll(async () => {
  await deleteTestOrg(org.orgId);
});
beforeEach(async () => {
  await db().delete(refunds).where(eq(refunds.orgId, org.orgId));
  await db().delete(payments).where(eq(payments.orgId, org.orgId));
  await db().delete(cashHandovers).where(eq(cashHandovers.orgId, org.orgId));
  await db().delete(cashSessions).where(eq(cashSessions.orgId, org.orgId));
  await db().delete(orders).where(eq(orders.orgId, org.orgId));
  await db().delete(auditLogs).where(eq(auditLogs.orgId, org.orgId));
});

async function counterCash(rupees: string): Promise<{ orderId: string; paymentId: string }> {
  const [order] = await db()
    .insert(orders)
    .values({ orgId: org.orgId, locationId: org.locationId, orderNumber: `T-${randomUUID().slice(0, 8)}`, businessDate: new Date().toISOString().slice(0, 10), status: "PENDING_PAYMENT", channel: "TAKEAWAY", fulfilment: "TAKEAWAY", grandTotal: fromRupees(rupees) })
    .returning({ id: orders.id });
  const result = await recordCashPayment({ orderId: order!.id, actorUserId: cashier, actorRoles: ["OWNER"], orgId: org.orgId });
  if (!result.ok) throw new Error(result.error);
  const [payment] = await db().select().from(payments).where(eq(payments.orderId, order!.id));
  return { orderId: order!.id, paymentId: payment!.id };
}
const openTill = async (float: string) => {
  const r = await openCashSession({ orgId: org.orgId, actorUserId: cashier, openingFloat: fromRupees(float), note: null });
  if (!r.ok) throw new Error(r.error);
  return r.sessionId;
};
const cashRefund = (paymentId: string, rupees: string) => refundPayment({ paymentId, amount: fromRupees(rupees), reason: "wrong item", actorUserId: cashier, actorRoles: ["OWNER"], orgId: org.orgId, idempotencyKey: randomUUID() });
const refundRow = async (paymentId: string) => (await db().select().from(refunds).where(eq(refunds.paymentId, paymentId)))[0]!;
const close = (sessionId: string, counted: string) => closeCashSession({ orgId: org.orgId, actorUserId: cashier, sessionId, counted: fromRupees(counted), note: null });

describe("a cash refund is attributed to the till that paid it", () => {
  it("refunded while a till is open: the refund records that till, and the till expects the cash to be lower by it", async () => {
    const till = await openTill("1000");
    const { paymentId } = await counterCash("500");
    expect(await cashRefund(paymentId, "120")).toMatchObject({ ok: true });
    expect((await refundRow(paymentId)).cashSessionId).toBe(till);
    // 1000 float + 500 taken - 120 refunded
    expect(await close(till, "1380")).toMatchObject({ ok: true, expected: fromRupees("1380"), variance: paise(0) });
  });

  it("refunded while NO till is open: it is in no till (never guessed), and a till opened later does not count it", async () => {
    const { paymentId } = await counterCash("500");
    expect(await cashRefund(paymentId, "120")).toMatchObject({ ok: true });
    expect((await refundRow(paymentId)).cashSessionId).toBeNull();
    const till = await openTill("1000");
    expect(await close(till, "1000")).toMatchObject({ ok: true, expected: fromRupees("1000"), variance: paise(0) });
  });

  it("a payment taken in one till and refunded while the next till is open comes out of the NEXT till only", async () => {
    const a = await openTill("1000");
    const { paymentId } = await counterCash("500");
    expect(await close(a, "1500")).toMatchObject({ ok: true, variance: paise(0) });
    const b = await openTill("200");
    expect(await cashRefund(paymentId, "120")).toMatchObject({ ok: true });
    expect((await refundRow(paymentId)).cashSessionId).toBe(b);
    expect(await close(b, "80")).toMatchObject({ ok: true, expected: fromRupees("80"), variance: paise(0) });
    const [closedA] = await db().select().from(cashSessions).where(eq(cashSessions.id, a));
    expect(closedA).toMatchObject({ expectedCash: fromRupees("1500"), variance: paise(0) }); // A's figures never change afterwards
  });

  it("the count uses attribution, not clocks: a refund attributed to the till counts whatever its timestamp, and one inside the till's hours but attributed to no till does not", async () => {
    const till = await openTill("1000");
    const { orderId, paymentId } = await counterCash("500");
    // attributed to this till, but stamped years before it opened: still counted
    await db().insert(refunds).values({ orgId: org.orgId, paymentId, orderId, amount: fromRupees("120"), reason: "x", provider: "cash", status: "SUCCEEDED", finalizedAt: new Date("2020-01-01T00:00:00Z"), cashSessionId: till });
    // stamped right now, inside the till's hours, but attributed to no till: not counted
    await db().insert(refunds).values({ orgId: org.orgId, paymentId, orderId, amount: fromRupees("30"), reason: "y", provider: "cash", status: "SUCCEEDED", finalizedAt: sql`clock_timestamp()` });
    expect(await close(till, "1380")).toMatchObject({ ok: true, expected: fromRupees("1380"), variance: paise(0) });
  });

  it("only refunds that succeeded are counted", async () => {
    const till = await openTill("1000");
    const { orderId, paymentId } = await counterCash("500");
    await db().insert(refunds).values({ orgId: org.orgId, paymentId, orderId, amount: fromRupees("120"), reason: "x", provider: "cash", status: "FAILED", finalizedAt: null, cashSessionId: till });
    expect(await close(till, "1500")).toMatchObject({ ok: true, expected: fromRupees("1500") });
  });

  it("the database refuses a till on a refund that is not cash", async () => {
    const till = await openTill("100");
    const { orderId, paymentId } = await counterCash("500");
    await expect(
      db().insert(refunds).values({ orgId: org.orgId, paymentId, orderId, amount: fromRupees("10"), reason: "x", provider: "razorpay", status: "SUCCEEDED", finalizedAt: sql`clock_timestamp()`, cashSessionId: till }),
    ).rejects.toThrow();
  });

  it("a refund that had to wait for a close while it was finalizing ends up in no closed till and is not added to it afterwards", async () => {
    const till = await openTill("1000");
    const { paymentId } = await counterCash("500");
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const holding = new Promise<void>((resolve) => (locked = resolve));
    const closing = db().transaction(async (tx) => {
      await tx.select().from(cashSessions).where(eq(cashSessions.id, till)).for("update");
      locked();
      await held;
      await tx.update(cashSessions).set({ status: "CLOSED", closedBy: cashier, closedAt: new Date(), countedCash: fromRupees("1500"), expectedCash: fromRupees("1500"), variance: paise(0) }).where(eq(cashSessions.id, till));
    });
    await holding;
    const refunding = cashRefund(paymentId, "120");
    await new Promise((resolve) => setTimeout(resolve, 400));
    release();
    await closing;
    expect(await refunding).toMatchObject({ ok: true });
    expect((await refundRow(paymentId)).cashSessionId).toBeNull(); // the till was closed when it got the lock: it is in no till
    const [closed] = await db().select().from(cashSessions).where(and(eq(cashSessions.id, till)));
    expect(closed!.expectedCash).toBe(fromRupees("1500")); // the closed till's figures are untouched
  });
});
