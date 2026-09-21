/**
 * Till go-live items: open, close and handover are idempotent (`withIdempotency`), a cash refund's audit row names
 * the till it came out of, and while a till is open the reconciliation withholds the cash that would give away what
 * the drawer should hold (the count stays blind).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, cashHandovers, cashSessions, idempotencyKeys, orders, payments, refunds } from "@/db/schema";
import { businessDate } from "@/lib/dates";
import { fromRupees, paise } from "@/lib/money";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { closeCashSession, getReconciliation, openCashSession, recordCashHandover } from "./cash-sessions";
import { IdempotencyConflict } from "./idempotency";
import { recordCashPayment, refundPayment } from "./payments";

let org: TestOrg;
const cashier = randomUUID();
const rider = randomUUID();
const today = businessDate(new Date());

beforeAll(async () => {
  org = await createTestOrg();
});
afterAll(async () => {
  await db().delete(idempotencyKeys).where(eq(idempotencyKeys.orgId, org.orgId));
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

async function newOrder(rupees: string, delivery = false): Promise<string> {
  const [row] = await db()
    .insert(orders)
    .values({
      orgId: org.orgId,
      locationId: org.locationId,
      orderNumber: `G-${randomUUID().slice(0, 8)}`,
      businessDate: today,
      status: delivery ? "OUT_FOR_DELIVERY" : "PENDING_PAYMENT",
      channel: delivery ? "ONLINE" : "TAKEAWAY",
      fulfilment: delivery ? "DELIVERY" : "TAKEAWAY",
      grandTotal: fromRupees(rupees),
    })
    .returning({ id: orders.id });
  return row!.id;
}
async function counterCash(rupees: string) {
  const orderId = await newOrder(rupees);
  const result = await recordCashPayment({ orderId, actorUserId: cashier, actorRoles: ["OWNER"], orgId: org.orgId });
  if (!result.ok) throw new Error(result.error);
  return (await db().select().from(payments).where(eq(payments.orderId, orderId)))[0]!;
}
async function doorCash(rupees: string) {
  const orderId = await newOrder(rupees, true);
  await db().update(orders).set({ riderId: rider }).where(eq(orders.id, orderId)); // door cash only on a delivery the rider holds (reassign-race-1)
  const result = await recordCashPayment({ orderId, actorUserId: rider, actorRoles: ["RIDER"], orgId: org.orgId, via: "delivery" });
  if (!result.ok) throw new Error(result.error);
}
const open = (key: string, float = "1000") => openCashSession({ idempotencyKey: key, orgId: org.orgId, actorUserId: cashier, openingFloat: fromRupees(float), note: null });
const close = (key: string, sessionId: string, counted: string) => closeCashSession({ idempotencyKey: key, orgId: org.orgId, actorUserId: cashier, sessionId, counted: fromRupees(counted), note: null });
const handover = (key: string, declared: string) => recordCashHandover({ idempotencyKey: key, orgId: org.orgId, actorUserId: cashier, riderUserId: rider, declared: fromRupees(declared), note: null });
const cashRefund = (paymentId: string, rupees: string) => refundPayment({ paymentId, amount: fromRupees(rupees), reason: "wrong item", actorUserId: cashier, actorRoles: ["OWNER"], orgId: org.orgId, idempotencyKey: randomUUID() });
const auditCount = async (action: string) => (await db().select().from(auditLogs).where(and(eq(auditLogs.orgId, org.orgId), eq(auditLogs.action, action)))).length;

describe("open, close and handover are idempotent", () => {
  it("open: the same key twice returns the first session and opens one till; a different key is refused as already open", async () => {
    const key = randomUUID();
    const first = await open(key);
    const again = await open(key);
    expect(first.ok && again.ok && first.sessionId === again.sessionId).toBe(true);
    expect(await db().select().from(cashSessions).where(eq(cashSessions.orgId, org.orgId))).toHaveLength(1);
    expect(await auditCount("cash_session_opened")).toBe(1);
    expect(await open(randomUUID())).toMatchObject({ ok: false, code: "ALREADY_OPEN" });
  });

  it("open: two identical requests at once open exactly one till", async () => {
    const key = randomUUID();
    const [a, b] = await Promise.all([open(key), open(key)]);
    expect(a.ok && b.ok).toBe(true);
    expect(await db().select().from(cashSessions).where(eq(cashSessions.orgId, org.orgId))).toHaveLength(1);
  });

  it("open: a key reused with a different float is a conflict, never a replay", async () => {
    const key = randomUUID();
    await open(key, "1000");
    await expect(open(key, "2000")).rejects.toBeInstanceOf(IdempotencyConflict);
  });

  it("close: the same key twice returns the first result (not 'already closed') and closes and audits once; a new key says already closed", async () => {
    const till = await open(randomUUID());
    if (!till.ok) throw new Error("open failed");
    await counterCash("500");
    const key = randomUUID();
    const first = await close(key, till.sessionId, "1480");
    const again = await close(key, till.sessionId, "1480");
    expect(first).toEqual({ ok: true, counted: fromRupees("1480"), expected: fromRupees("1500"), variance: fromRupees("-20") });
    expect(again).toEqual(first);
    expect(await auditCount("cash_session_closed")).toBe(1);
    expect(await close(randomUUID(), till.sessionId, "1480")).toMatchObject({ ok: false, code: "ALREADY_CLOSED" });
    await expect(close(key, till.sessionId, "1400")).rejects.toBeInstanceOf(IdempotencyConflict);
  });

  it("close: two identical requests at once close the till once and both see the same figures", async () => {
    const till = await open(randomUUID());
    if (!till.ok) throw new Error("open failed");
    const key = randomUUID();
    const [a, b] = await Promise.all([close(key, till.sessionId, "1000"), close(key, till.sessionId, "1000")]);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    expect(await auditCount("cash_session_closed")).toBe(1);
  });

  it("handover: the same key twice records one handover and returns the first result; a new key finds nothing left", async () => {
    await open(randomUUID());
    await doorCash("340");
    const key = randomUUID();
    const first = await handover(key, "340");
    const again = await handover(key, "340");
    expect(first).toMatchObject({ ok: true, expected: fromRupees("340"), declared: fromRupees("340"), variance: paise(0), paymentCount: 1 });
    expect(again).toEqual(first);
    expect(await db().select().from(cashHandovers).where(eq(cashHandovers.orgId, org.orgId))).toHaveLength(1);
    expect(await auditCount("cash_handover_recorded")).toBe(1);
    expect(await handover(randomUUID(), "340")).toMatchObject({ ok: false, code: "NOTHING_TO_HAND_OVER" });
  });
});

describe("a cash refund's audit row names the till it came out of", () => {
  const refundAudit = async (paymentId: string) => {
    const rows = await db().select().from(auditLogs).where(and(eq(auditLogs.orgId, org.orgId), eq(auditLogs.action, "payment_refunded"), eq(auditLogs.entityId, paymentId)));
    expect(rows).toHaveLength(1);
    return rows[0]!.after as { cashSessionId?: string | null; provider: string };
  };

  it("refunded while a till is open: the audit row carries that till's id, the same one stored on the refund", async () => {
    const till = await open(randomUUID());
    if (!till.ok) throw new Error("open failed");
    const payment = await counterCash("500");
    expect(await cashRefund(payment.id, "120")).toMatchObject({ ok: true });
    const audit = await refundAudit(payment.id);
    expect(audit.provider).toBe("cash");
    expect(audit.cashSessionId).toBe(till.sessionId);
    expect((await db().select().from(refunds).where(eq(refunds.paymentId, payment.id)))[0]!.cashSessionId).toBe(till.sessionId);
  });

  it("refunded with no till open: the audit row says so explicitly (null), it does not just omit the field", async () => {
    const payment = await counterCash("500");
    expect(await cashRefund(payment.id, "120")).toMatchObject({ ok: true });
    const audit = await refundAudit(payment.id);
    expect("cashSessionId" in audit).toBe(true);
    expect(audit.cashSessionId).toBeNull();
  });
});

describe("the count stays blind while a till is open", () => {
  const range = { from: today, to: today };

  it("an open till withholds this day's till cash, cash refunds and net, and flags the day; provider money is untouched", async () => {
    const till = await open(randomUUID());
    if (!till.ok) throw new Error("open failed");
    const payment = await counterCash("500");
    await cashRefund(payment.id, "120");
    const during = (await getReconciliation(org.orgId, range)).days.find((d) => d.date === today)!;
    expect(during.cashHidden).toBe(true);
    expect(during.cashInTill).toBe(paise(0));
    expect(during.cashRefunded).toBe(paise(0));
    expect(during.net).toBe(paise(0));

    // Closing it releases the figures: the count is already made.
    await close(randomUUID(), till.sessionId, "1380");
    const after = (await getReconciliation(org.orgId, range)).days.find((d) => d.date === today)!;
    expect(after.cashHidden).toBe(false);
    expect(after.cashInTill).toBe(fromRupees("500"));
    expect(after.cashRefunded).toBe(fromRupees("120"));
    expect(after.net).toBe(fromRupees("380"));
  });

  it("no till open: nothing is withheld", async () => {
    await counterCash("500");
    const day = (await getReconciliation(org.orgId, range)).days.find((d) => d.date === today)!;
    expect(day.cashHidden).toBe(false);
  });
});
