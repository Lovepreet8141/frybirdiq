/**
 * cash-refund-attribution: no phantom variance from refunds of rider-held cash or of an earlier session's cash, and an
 * unopened till blocks nothing. The physical model: the drawer pays a cash refund out of whichever till is open; a rider's door
 * cash joins the drawer only at the handover, at the amount the rider took.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, cashHandovers, cashSessions, orders, payments, refunds } from "@/db/schema";
import { fromRupees, paise } from "@/lib/money";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { closeCashSession, openCashSession, recordCashHandover } from "./cash-sessions";
import { recordCashPayment, refundPayment } from "./payments";

let org: TestOrg;
const cashier = randomUUID();
const rider = randomUUID();

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

async function newOrder(rupees: string, kind: "counter" | "delivery" = "counter") {
  const [row] = await db()
    .insert(orders)
    .values({
      orgId: org.orgId,
      locationId: org.locationId,
      orderNumber: `V-${randomUUID().slice(0, 8)}`,
      businessDate: new Date().toISOString().slice(0, 10),
      status: kind === "delivery" ? "OUT_FOR_DELIVERY" : "PENDING_PAYMENT",
      channel: kind === "delivery" ? "ONLINE" : "TAKEAWAY",
      fulfilment: kind === "delivery" ? "DELIVERY" : "TAKEAWAY",
      grandTotal: fromRupees(rupees),
    })
    .returning({ id: orders.id });
  return row!.id;
}
const paymentOf = async (orderId: string) => (await db().select().from(payments).where(eq(payments.orderId, orderId)))[0]!;
async function counterCash(rupees: string) {
  const orderId = await newOrder(rupees);
  const result = await recordCashPayment({ orderId, actorUserId: cashier, actorRoles: ["OWNER"], orgId: org.orgId });
  if (!result.ok) throw new Error(result.error);
  return paymentOf(orderId);
}
async function doorCash(rupees: string) {
  const orderId = await newOrder(rupees, "delivery");
  await db().update(orders).set({ riderId: rider }).where(eq(orders.id, orderId)); // door cash only on a delivery the rider holds (reassign-race-1)
  const result = await recordCashPayment({ orderId, actorUserId: rider, actorRoles: ["RIDER"], orgId: org.orgId, via: "delivery" });
  if (!result.ok) throw new Error(result.error);
  return paymentOf(orderId);
}
const openTill = async (float: string) => {
  const r = await openCashSession({ idempotencyKey: crypto.randomUUID(), orgId: org.orgId, actorUserId: cashier, openingFloat: fromRupees(float), note: null });
  if (!r.ok) throw new Error(r.error);
  return r.sessionId;
};
const refund = (paymentId: string, rupees: string) => refundPayment({ paymentId, amount: fromRupees(rupees), reason: "wrong item", actorUserId: cashier, actorRoles: ["OWNER"], orgId: org.orgId, idempotencyKey: randomUUID() });
const close = (sessionId: string, counted: string) => closeCashSession({ idempotencyKey: crypto.randomUUID(), orgId: org.orgId, actorUserId: cashier, sessionId, counted: fromRupees(counted), note: null });
const handover = (declared: string) => recordCashHandover({ idempotencyKey: crypto.randomUUID(), orgId: org.orgId, actorUserId: cashier, riderUserId: rider, declared: fromRupees(declared), note: null });

describe("no phantom variance", () => {
  it("rider-held door cash partly refunded BEFORE the handover: float 1000, rider took 340, drawer paid a 100 refund, rider hands over 340 -> the till holds 1240 and reports no variance", async () => {
    const till = await openTill("1000");
    const door = await doorCash("340");
    expect(await refund(door.id, "100")).toMatchObject({ ok: true });
    expect(await handover("340")).toMatchObject({ ok: true, expected: fromRupees("340"), variance: paise(0) });
    // 1000 float - 100 paid out + 340 received from the rider
    expect(await close(till, "1240")).toMatchObject({ ok: true, expected: fromRupees("1240"), variance: paise(0) });
  });

  it("rider-held door cash FULLY refunded before the handover: the rider still carries the 340 and hands it over, the drawer paid 340 out -> back to the float, no variance", async () => {
    const till = await openTill("1000");
    const door = await doorCash("340");
    expect(await refund(door.id, "340")).toMatchObject({ ok: true });
    expect(await handover("340")).toMatchObject({ ok: true, expected: fromRupees("340"), variance: paise(0) });
    expect(await close(till, "1000")).toMatchObject({ ok: true, expected: fromRupees("1000"), variance: paise(0) });
  });

  it("an earlier session's cash refunded while the next till is open comes out of the next till: both tills close with no variance, and the first till's figures are untouched", async () => {
    const a = await openTill("1000");
    const sale = await counterCash("500");
    expect(await close(a, "1500")).toMatchObject({ ok: true, variance: paise(0) });
    const b = await openTill("200");
    expect(await refund(sale.id, "120")).toMatchObject({ ok: true });
    expect(await close(b, "80")).toMatchObject({ ok: true, expected: fromRupees("80"), variance: paise(0) });
    const [first] = await db().select().from(cashSessions).where(eq(cashSessions.id, a));
    expect(first).toMatchObject({ expectedCash: fromRupees("1500"), variance: paise(0) });
  });
});

describe("an unopened till blocks nothing", () => {
  it("with no session open: a counter cash payment, a rider's door cash and a cash refund all work, and are simply in no till", async () => {
    const counter = await counterCash("500");
    expect(counter).toMatchObject({ status: "CAPTURED", cashSessionId: null, heldByRider: false });
    const door = await doorCash("340");
    expect(door).toMatchObject({ status: "CAPTURED", cashSessionId: null, heldByRider: true });
    expect(await refund(counter.id, "120")).toMatchObject({ ok: true });
    const [row] = await db().select().from(refunds).where(eq(refunds.paymentId, counter.id));
    expect(row).toMatchObject({ status: "SUCCEEDED", cashSessionId: null });
    expect((await paymentOf(counter.orderId)).status).toBe("PARTIALLY_REFUNDED");
  });

  it("a till opened afterwards starts clean: it does not inherit the earlier refund or the cash taken before it opened", async () => {
    const counter = await counterCash("500");
    await refund(counter.id, "120");
    const till = await openTill("1000");
    expect(await close(till, "1000")).toMatchObject({ ok: true, expected: fromRupees("1000"), variance: paise(0) });
  });
});
