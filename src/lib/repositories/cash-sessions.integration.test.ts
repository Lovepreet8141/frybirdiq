/**
 * The till against a real database (roadmap 5.1-5.3): a session with a float,
 * counter cash attaching to it, a close that records the variance against the
 * person who closed it (with an audit row), rider door cash held until a
 * handover, the day's reconciliation, and the constraints that hold it all.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, cashHandovers, cashSessions, orders, payments, refunds } from "@/db/schema";
import { fromRupees, paise } from "@/lib/money";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { closeCashSession, getCashSessions, getReconciliation, getRiderCashOutstanding, openCashSession, openSessionIdForPayment, recordCashHandover } from "./cash-sessions";
import { recordCashPayment, refundPayment } from "./payments";

let org: TestOrg;
let other: TestOrg;
const cashier = randomUUID();
const rider = randomUUID();

beforeAll(async () => {
  org = await createTestOrg();
  other = await createTestOrg();
});
afterAll(async () => {
  await deleteTestOrg(org.orgId);
  await deleteTestOrg(other.orgId);
});

async function reset(owner: TestOrg = org) {
  await db().delete(refunds).where(eq(refunds.orgId, owner.orgId));
  await db().delete(payments).where(eq(payments.orgId, owner.orgId));
  await db().delete(cashHandovers).where(eq(cashHandovers.orgId, owner.orgId));
  await db().delete(cashSessions).where(eq(cashSessions.orgId, owner.orgId));
  await db().delete(orders).where(eq(orders.orgId, owner.orgId));
  await db().delete(auditLogs).where(eq(auditLogs.orgId, owner.orgId));
}

async function order(owner: TestOrg, rupees: string, kind: "counter" | "delivery" = "counter"): Promise<string> {
  const [row] = await db()
    .insert(orders)
    .values({
      orgId: owner.orgId,
      locationId: owner.locationId,
      orderNumber: `T-${randomUUID().slice(0, 8)}`,
      businessDate: new Date().toISOString().slice(0, 10),
      status: kind === "delivery" ? "OUT_FOR_DELIVERY" : "PENDING_PAYMENT",
      channel: kind === "delivery" ? "ONLINE" : "TAKEAWAY",
      fulfilment: kind === "delivery" ? "DELIVERY" : "TAKEAWAY",
      grandTotal: fromRupees(rupees),
    })
    .returning({ id: orders.id });
  return row!.id;
}

const counterCash = async (owner: TestOrg, rupees: string) => {
  const orderId = await order(owner, rupees);
  const result = await recordCashPayment({ orderId, actorUserId: cashier, actorRoles: ["OWNER"], orgId: owner.orgId });
  if (!result.ok) throw new Error(result.error);
  return orderId;
};
const doorCash = async (owner: TestOrg, rupees: string, riderId = rider) => {
  const orderId = await order(owner, rupees, "delivery");
  await db().update(orders).set({ riderId }).where(eq(orders.id, orderId)); // a rider takes door cash only on a delivery that is theirs (reassign-race-1)
  const result = await recordCashPayment({ orderId, actorUserId: riderId, actorRoles: ["RIDER"], orgId: owner.orgId, via: "delivery" });
  if (!result.ok) throw new Error(result.error);
  return orderId;
};
const paymentOf = async (orderId: string) => (await db().select().from(payments).where(eq(payments.orderId, orderId)))[0]!;
const openTill = async (float = "2000") => {
  const result = await openCashSession({ idempotencyKey: crypto.randomUUID(), orgId: org.orgId, actorUserId: cashier, openingFloat: fromRupees(float), note: null });
  if (!result.ok) throw new Error(result.error);
  return result.sessionId;
};
const audit = async (action: string) => db().select().from(auditLogs).where(and(eq(auditLogs.orgId, org.orgId), eq(auditLogs.action, action)));

describe("counter cash and the open till", () => {
  it("with no till open, cash is recorded against the person and attaches to nothing", async () => {
    await reset();
    const p = await paymentOf(await counterCash(org, "300"));
    expect(p).toMatchObject({ method: "CASH", status: "CAPTURED", cashSessionId: null, collectedBy: cashier, heldByRider: false, handoverId: null });
  });

  it("with a till open, every counter cash payment attaches to it", async () => {
    await reset();
    const sessionId = await openTill();
    const a = await paymentOf(await counterCash(org, "300"));
    const b = await paymentOf(await counterCash(org, "150.50"));
    expect(a.cashSessionId).toBe(sessionId);
    expect(b.cashSessionId).toBe(sessionId);
    expect((await getCashSessions(org.orgId)).open).toMatchObject({ id: sessionId, cashPaymentCount: 2, countedCash: null, expectedCash: null });
  });

  it("only one till is open at a time; the second open says so and changes nothing", async () => {
    await reset();
    await openTill();
    const second = await openCashSession({ idempotencyKey: crypto.randomUUID(), orgId: org.orgId, actorUserId: cashier, openingFloat: fromRupees("500"), note: null });
    expect(second).toMatchObject({ ok: false, code: "ALREADY_OPEN" });
    expect((await db().select().from(cashSessions).where(eq(cashSessions.orgId, org.orgId))).length).toBe(1);
  });
});

describe("closing the till", () => {
  it("counted ₹20 short records the variance against the closer, with an audit row", async () => {
    await reset();
    const sessionId = await openTill("2000");
    await counterCash(org, "300");
    await counterCash(org, "700");
    // float 2000 + 1000 taken = 3000 expected; counted 2980.
    const closer = randomUUID();
    const result = await closeCashSession({ idempotencyKey: crypto.randomUUID(), orgId: org.orgId, actorUserId: closer, sessionId, counted: fromRupees("2980"), note: "Short by a coin" });
    expect(result).toEqual({ ok: true, counted: fromRupees("2980"), expected: fromRupees("3000"), variance: fromRupees("-20") });

    const [row] = await db().select().from(cashSessions).where(eq(cashSessions.id, sessionId));
    expect(row).toMatchObject({ status: "CLOSED", closedBy: closer, countedCash: fromRupees("2980"), expectedCash: fromRupees("3000"), variance: fromRupees("-20"), note: "Short by a coin" });
    const [entry] = await audit("cash_session_closed");
    expect(entry).toMatchObject({ actorUserId: closer, entityId: sessionId, after: { counted: "298000", expected: "300000", variance: "-2000", cashTaken: "100000", cashRefunded: "0" } });
  });

  it("cash refunded out of the till while it was open lowers what it should hold", async () => {
    await reset();
    const sessionId = await openTill("1000");
    const orderId = await counterCash(org, "500");
    const p = await paymentOf(orderId);
    await db().insert(refunds).values({ orgId: org.orgId, paymentId: p.id, orderId, amount: fromRupees("120"), reason: "wrong item", provider: "cash", status: "SUCCEEDED", finalizedAt: sql`clock_timestamp()`, cashSessionId: sessionId });
    await db().update(payments).set({ status: "PARTIALLY_REFUNDED" }).where(eq(payments.id, p.id));
    // 1000 + 500 - 120 = 1380
    const result = await closeCashSession({ idempotencyKey: crypto.randomUUID(), orgId: org.orgId, actorUserId: cashier, sessionId, counted: fromRupees("1380"), note: null });
    expect(result).toMatchObject({ ok: true, expected: fromRupees("1380"), variance: paise(0) });
  });

  it("an exact count is variance zero; a closed till cannot be closed again, and a payment after the close attaches to nothing", async () => {
    await reset();
    const sessionId = await openTill("100");
    await counterCash(org, "50");
    expect(await closeCashSession({ idempotencyKey: crypto.randomUUID(), orgId: org.orgId, actorUserId: cashier, sessionId, counted: fromRupees("150"), note: null })).toMatchObject({ ok: true, variance: paise(0) });
    expect(await closeCashSession({ idempotencyKey: crypto.randomUUID(), orgId: org.orgId, actorUserId: cashier, sessionId, counted: fromRupees("150"), note: null })).toMatchObject({ ok: false, code: "ALREADY_CLOSED" });
    const late = await paymentOf(await counterCash(org, "80"));
    expect(late.cashSessionId).toBeNull();
  });

  it("another organization's till cannot be closed with this org's authority", async () => {
    await reset();
    await reset(other);
    const theirs = await openCashSession({ idempotencyKey: crypto.randomUUID(), orgId: other.orgId, actorUserId: cashier, openingFloat: fromRupees("100"), note: null });
    if (!theirs.ok) throw new Error(theirs.error);
    expect(await closeCashSession({ idempotencyKey: crypto.randomUUID(), orgId: org.orgId, actorUserId: cashier, sessionId: theirs.sessionId, counted: fromRupees("100"), note: null })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    const [row] = await db().select().from(cashSessions).where(eq(cashSessions.id, theirs.sessionId));
    expect(row?.status).toBe("OPEN");
  });

  it("a close waits for a cash payment that is mid-settlement, then counts it (no payment slips past the count)", async () => {
    await reset();
    const sessionId = await openTill("100");
    const orderId = await order(org, "250");
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let attached!: () => void;
    const holding = new Promise<void>((resolve) => (attached = resolve));
    // What settle does: READ the open till (FOR SHARE), and only later write the payment against it. The read alone
    // must hold the till: a close that slipped in between the read and the write would count without this payment
    // and the payment would land on a closed till.
    const inFlight = db().transaction(async (tx) => {
      const id = await openSessionIdForPayment(tx, org.orgId, org.locationId);
      attached();
      await held;
      await tx.insert(payments).values({ orgId: org.orgId, orderId, status: "CAPTURED", method: "CASH", amount: fromRupees("250"), provider: "cash", cashSessionId: id, collectedBy: cashier });
    });
    await holding;

    const closing = closeCashSession({ idempotencyKey: crypto.randomUUID(), orgId: org.orgId, actorUserId: cashier, sessionId, counted: fromRupees("350"), note: null });
    let settled = false;
    void closing.then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(settled).toBe(false); // waiting for the payment, not counting past it

    release();
    await inFlight;
    expect(await closing).toMatchObject({ ok: true, expected: fromRupees("350"), variance: paise(0) });
  });
});

describe("a cash refund and the close of the till", () => {
  it("a cash refund waits for a close that is counting, and is stamped after it (it cannot fall out of every till)", async () => {
    await reset();
    const sessionId = await openTill("1000");
    const orderId = await counterCash(org, "500");
    const p = await paymentOf(orderId);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const holding = new Promise<void>((resolve) => (locked = resolve));
    let closedAt = new Date(0);
    // What a close does: hold the till FOR UPDATE, count, close.
    const closing = db().transaction(async (tx) => {
      await tx.select().from(cashSessions).where(eq(cashSessions.id, sessionId)).for("update");
      locked();
      await held;
      closedAt = new Date();
      await tx.update(cashSessions).set({ status: "CLOSED", closedBy: cashier, closedAt, countedCash: fromRupees("1500"), expectedCash: fromRupees("1500"), variance: paise(0) }).where(eq(cashSessions.id, sessionId));
    });
    await holding;

    const refunding = refundPayment({ paymentId: p.id, amount: fromRupees("120"), reason: "wrong item", actorUserId: cashier, actorRoles: ["OWNER"], orgId: org.orgId, idempotencyKey: randomUUID() });
    let settled = false;
    void refunding.then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(settled).toBe(false); // waiting for the close, not finalizing past it

    release();
    await closing;
    expect(await refunding).toMatchObject({ ok: true });
    const [refund] = await db().select().from(refunds).where(eq(refunds.paymentId, p.id));
    expect(refund!.finalizedAt!.getTime()).toBeGreaterThanOrEqual(closedAt.getTime());
  });
});

describe("rider door cash", () => {
  it("is held by the rider, in no till, until it is handed over", async () => {
    await reset();
    await openTill("500");
    const p = await paymentOf(await doorCash(org, "340"));
    expect(p).toMatchObject({ method: "CASH", heldByRider: true, cashSessionId: null, handoverId: null, collectedBy: rider });
    const outstanding = await getRiderCashOutstanding(org.orgId);
    expect(outstanding).toMatchObject([{ riderUserId: rider, paymentCount: 1, amount: fromRupees("340") }]);
  });

  it("a handover puts it into the open till; the shortfall is recorded against the rider; the till then expects it", async () => {
    await reset();
    const sessionId = await openTill("500");
    const a = await doorCash(org, "340");
    const b = await doorCash(org, "460");
    const result = await recordCashHandover({ idempotencyKey: crypto.randomUUID(), orgId: org.orgId, actorUserId: cashier, riderUserId: rider, declared: fromRupees("780"), note: null });
    expect(result).toMatchObject({ ok: true, expected: fromRupees("800"), declared: fromRupees("780"), variance: fromRupees("-20"), paymentCount: 2 });

    const [handover] = await db().select().from(cashHandovers).where(eq(cashHandovers.orgId, org.orgId));
    expect(handover).toMatchObject({ sessionId, riderUserId: rider, receivedBy: cashier, expectedAmount: fromRupees("800"), declaredAmount: fromRupees("780"), variance: fromRupees("-20") });
    for (const id of [a, b]) expect(await paymentOf(id)).toMatchObject({ heldByRider: true, cashSessionId: sessionId, handoverId: handover!.id });
    expect(await getRiderCashOutstanding(org.orgId)).toEqual([]);
    expect((await audit("cash_handover_recorded"))[0]).toMatchObject({ actorUserId: cashier, after: expect.objectContaining({ riderUserId: rider, variance: "-2000" }) });

    // 500 float + 800 of the books' door cash: the till expects what the payments say, the shortfall is the rider's.
    expect(await closeCashSession({ idempotencyKey: crypto.randomUUID(), orgId: org.orgId, actorUserId: cashier, sessionId, counted: fromRupees("1280"), note: null })).toMatchObject({ ok: true, expected: fromRupees("1300"), variance: fromRupees("-20") });
  });

  it("a rider cannot receive their own cash", async () => {
    await reset();
    await openTill("500");
    const orderId = await doorCash(org, "340");
    const result = await recordCashHandover({ idempotencyKey: crypto.randomUUID(), orgId: org.orgId, actorUserId: rider, riderUserId: rider, declared: fromRupees("340"), note: null });
    expect(result).toMatchObject({ ok: false, code: "INVALID" });
    expect(await paymentOf(orderId)).toMatchObject({ heldByRider: true, handoverId: null, cashSessionId: null });
  });

  it("needs an open till, and hands over nothing twice", async () => {
    await reset();
    await doorCash(org, "200");
    expect(await recordCashHandover({ idempotencyKey: crypto.randomUUID(), orgId: org.orgId, actorUserId: cashier, riderUserId: rider, declared: fromRupees("200"), note: null })).toMatchObject({ ok: false, code: "NO_OPEN_SESSION" });
    await openTill("0");
    expect((await recordCashHandover({ idempotencyKey: crypto.randomUUID(), orgId: org.orgId, actorUserId: cashier, riderUserId: rider, declared: fromRupees("200"), note: null })).ok).toBe(true);
    expect(await recordCashHandover({ idempotencyKey: crypto.randomUUID(), orgId: org.orgId, actorUserId: cashier, riderUserId: rider, declared: fromRupees("200"), note: null })).toMatchObject({ ok: false, code: "NOTHING_TO_HAND_OVER" });
  });

  it("only this org's rider cash is handed over; another org's cash for the same rider id is untouched", async () => {
    await reset();
    await reset(other);
    await openTill("0");
    const mine = await doorCash(org, "100");
    const theirs = await doorCash(other, "999");
    const result = await recordCashHandover({ idempotencyKey: crypto.randomUUID(), orgId: org.orgId, actorUserId: cashier, riderUserId: rider, declared: fromRupees("100"), note: null });
    // The books' figure is THIS org's ₹100 only, never the other org's ₹999 for the same rider id.
    expect(result).toMatchObject({ ok: true, expected: fromRupees("100"), paymentCount: 1, variance: paise(0) });
    expect((await paymentOf(mine)).handoverId).not.toBeNull();
    expect(await paymentOf(theirs)).toMatchObject({ handoverId: null, cashSessionId: null, heldByRider: true });
  });

  it("a manager who completes a delivery takes the cash into the till, not the rider's hands", async () => {
    await reset();
    const sessionId = await openTill("0");
    const orderId = await order(org, "220", "delivery");
    const result = await recordCashPayment({ orderId, actorUserId: cashier, actorRoles: ["MANAGER"], orgId: org.orgId, via: "delivery" });
    expect(result.ok).toBe(true);
    expect(await paymentOf(orderId)).toMatchObject({ heldByRider: false, cashSessionId: sessionId });
  });
});

describe("the reconciliation view", () => {
  it("one row for today: cash in the till, cash still with a rider, unassigned cash, online, refunds, net, and the closed till's variance", async () => {
    await reset();
    const noTill = await counterCash(org, "100"); // before any till: unassigned
    const sessionId = await openTill("1000");
    await counterCash(org, "400");
    await doorCash(org, "250"); // stays with the rider
    const online = await order(org, "600");
    await db().insert(payments).values({ orgId: org.orgId, orderId: online, status: "CAPTURED", method: "UPI", amount: fromRupees("600"), provider: "razorpay", capturedAt: new Date() });
    const p = await paymentOf(noTill);
    await db().insert(refunds).values({ orgId: org.orgId, paymentId: p.id, orderId: noTill, amount: fromRupees("30"), reason: "x", provider: "cash", status: "SUCCEEDED", finalizedAt: sql`clock_timestamp()`, cashSessionId: sessionId });
    await closeCashSession({ idempotencyKey: crypto.randomUUID(), orgId: org.orgId, actorUserId: cashier, sessionId, counted: fromRupees("1390"), note: null });

    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const { days, settlementsConnected } = await getReconciliation(org.orgId, { from: yesterday, to: tomorrow });
    expect(settlementsConnected).toBe(false);
    const day = days.find((d) => d.date === today || d.cashInTill > 0n);
    expect(day).toMatchObject({
      cashInTill: fromRupees("400"),
      cashUnassigned: fromRupees("100"),
      cashWithRiders: fromRupees("250"),
      onlineCaptured: fromRupees("600"),
      cashRefunded: fromRupees("30"),
      cashRefundedNoTill: paise(0), // the refund was paid while the till was open (attributed to it)
      onlineRefunded: paise(0),
      net: fromRupees("1320"), // 400 + 100 + 250 + 600 - 30
      sessionsClosed: 1,
      counted: fromRupees("1390"),
      expected: fromRupees("1370"), // 1000 float + 400 in the till - 30 refunded
      variance: fromRupees("20"), // ₹20 over
    });
  });

  it("another org sees nothing of this one", async () => {
    await reset();
    await reset(other);
    await openTill("0");
    await counterCash(org, "100");
    const today = new Date().toISOString().slice(0, 10);
    expect((await getReconciliation(other.orgId, { from: today, to: today })).days).toEqual([]);
  });
});

describe("the database itself holds the till's rules", () => {
  it("a second OPEN session for the same till is refused", async () => {
    await reset();
    await openTill();
    await expect(db().insert(cashSessions).values({ orgId: org.orgId, locationId: org.locationId, openedBy: cashier, openingFloat: fromRupees("1") })).rejects.toThrow();
  });
  it("a closed session must carry every closing fact, and a negative float or count is refused", async () => {
    await reset();
    await expect(db().insert(cashSessions).values({ orgId: org.orgId, locationId: org.locationId, openedBy: cashier, openingFloat: fromRupees("1"), status: "CLOSED" })).rejects.toThrow();
    await expect(db().insert(cashSessions).values({ orgId: org.orgId, locationId: org.locationId, openedBy: cashier, openingFloat: paise(-1n) })).rejects.toThrow();
  });
  it("a closed session's variance must equal counted minus expected", async () => {
    await reset();
    await expect(
      db().insert(cashSessions).values({ orgId: org.orgId, locationId: org.locationId, openedBy: cashier, openingFloat: fromRupees("1"), status: "CLOSED", closedBy: cashier, closedAt: new Date(), countedCash: fromRupees("10"), expectedCash: fromRupees("12"), variance: fromRupees("5") }),
    ).rejects.toThrow();
  });
  it("a handover row's variance must equal declared minus expected", async () => {
    await reset();
    const sessionId = await openTill();
    await expect(
      db().insert(cashHandovers).values({ orgId: org.orgId, sessionId, riderUserId: rider, receivedBy: cashier, expectedAmount: fromRupees("10"), declaredAmount: fromRupees("8"), variance: fromRupees("-1"), paymentCount: 1 }),
    ).rejects.toThrow();
  });
  it("a payment cannot claim a handover without being rider cash", async () => {
    await reset();
    const sessionId = await openTill();
    const orderId = await order(org, "10");
    const [h] = await db().insert(cashHandovers).values({ orgId: org.orgId, sessionId, riderUserId: rider, receivedBy: cashier, expectedAmount: fromRupees("10"), declaredAmount: fromRupees("10"), variance: paise(0), paymentCount: 1 }).returning({ id: cashHandovers.id });
    await expect(db().insert(payments).values({ orgId: org.orgId, orderId, status: "CAPTURED", method: "CASH", amount: fromRupees("10"), provider: "cash", handoverId: h!.id, heldByRider: false })).rejects.toThrow();
  });
});
