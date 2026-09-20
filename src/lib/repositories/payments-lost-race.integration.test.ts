/**
 * pay-7: a Razorpay payment is captured at Razorpay before our server ever
 * sees it (auto-capture). If the order can no longer take it — already paid in
 * cash, paid by an earlier Razorpay payment, cancelled — the money is still in
 * our Razorpay account. It must be recorded (a CAPTURED row the refund flow can
 * act on), never dropped, and it must not touch the order: no status move, no
 * second invoice, no loyalty.
 *
 * The gateway is a recorded-shape fetch stub. No provider calls, no real payments.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, orders, payments } from "@/db/schema";
import { fromRupees } from "@/lib/money";
import { paymentSignature } from "@/lib/payments/razorpay";
import { recordCashPayment, recordOnlinePayment, refundPayment } from "./payments";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { ORG_SLUG } from "./org";

const KEY_SECRET = "integration-test-secret";
const AMOUNT = 30000; // ₹300, in paise, as Razorpay reports it

describe("recordOnlinePayment — a capture the order cannot take is recorded for refund (pay-7)", () => {
  let org: TestOrg;
  const saved = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    // ORG_SLUG: recordOnlinePayment binds its reads to getOrg().
    org = await createTestOrg({ slug: ORG_SLUG });
    process.env.RAZORPAY_KEY_ID = "rzp_test_integration";
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    if (saved.id === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = saved.id;
    if (saved.secret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
    else process.env.RAZORPAY_KEY_SECRET = saved.secret;
    await deleteTestOrg(org.orgId);
  });

  /** A takeaway order waiting on a Razorpay payment, as placeOrder leaves it. */
  async function onlineOrder(status: "PENDING_PAYMENT" | "CANCELLED" = "PENDING_PAYMENT") {
    const [order] = await db()
      .insert(orders)
      .values({
        orgId: org.orgId,
        locationId: org.locationId,
        orderNumber: `TEST-${randomUUID().slice(0, 8)}`,
        businessDate: new Date().toISOString().slice(0, 10),
        status,
        channel: "ONLINE",
        fulfilment: "TAKEAWAY",
        grandTotal: fromRupees("300"),
      })
      .returning({ id: orders.id });
    if (!order) throw new Error("fixture: no order");
    const providerOrderId = `order_test_${randomUUID().slice(0, 12)}`;
    await db().insert(payments).values({ orgId: org.orgId, orderId: order.id, status: "PENDING", method: "UPI", amount: fromRupees("300"), provider: "razorpay", providerOrderId });
    return { orderId: order.id, providerOrderId };
  }

  /** Razorpay, asked about any payment, says it is captured for `providerOrderId`. `beforeAnswer` runs first. */
  function gatewayCaptured(providerOrderId: string, beforeAnswer?: () => Promise<void>) {
    let calls = 0;
    vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith("https://api.razorpay.com/")) return realFetch(input as Parameters<typeof fetch>[0], init);
      calls += 1;
      if (calls === 1 && beforeAnswer) await beforeAnswer();
      const id = decodeURIComponent(url.split("/payments/")[1]?.split("/")[0] ?? "");
      return new Response(JSON.stringify({ id, order_id: providerOrderId, amount: AMOUNT, currency: "INR", status: "captured", method: "upi", fee: 0, tax: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch);
  }

  const payCash = (orderId: string) => recordCashPayment({ orderId, actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: org.orgId });
  const rowsFor = (orderId: string) => db().select().from(payments).where(and(eq(payments.orderId, orderId), eq(payments.orgId, org.orgId)));
  const orderRow = async (orderId: string) => (await db().select().from(orders).where(eq(orders.id, orderId)))[0]!;

  it("records a Razorpay payment that arrives after the order was paid in cash, without touching the order", async () => {
    const { orderId, providerOrderId } = await onlineOrder();
    const cash = await payCash(orderId);
    expect(cash.ok).toBe(true);
    const paid = await orderRow(orderId);

    const providerPaymentId = `pay_test_${randomUUID().slice(0, 12)}`;
    gatewayCaptured(providerOrderId);
    const result = await recordOnlinePayment({ orderId, providerPaymentId, providerOrderId });

    expect(result).toMatchObject({ ok: false, code: "RECORDED_FOR_REFUND" });
    const online = (await rowsFor(orderId)).filter((row) => row.providerPaymentId === providerPaymentId);
    expect(online).toHaveLength(1);
    expect(online[0]).toMatchObject({ status: "CAPTURED", provider: "razorpay", amount: 30000n });

    // The order is exactly as the cash settlement left it: no second invoice, no status move.
    const after = await orderRow(orderId);
    expect({ status: after.status, invoiceNumber: after.invoiceNumber, pointsEarned: after.pointsEarned }).toEqual({ status: paid.status, invoiceNumber: paid.invoiceNumber, pointsEarned: paid.pointsEarned });
    const audit = await db().select().from(auditLogs).where(and(eq(auditLogs.entityId, orderId), eq(auditLogs.action, "payment_captured_unapplied")));
    expect(audit).toHaveLength(1);

    // The webhook for the same payment arriving again records nothing more.
    const again = await recordOnlinePayment({ orderId, providerPaymentId, providerOrderId });
    expect(again).toMatchObject({ ok: false, code: "RECORDED_FOR_REFUND" });
    expect((await rowsFor(orderId)).filter((row) => row.providerPaymentId === providerPaymentId)).toHaveLength(1);
  });

  it("records the capture that loses the settle race under the order lock, instead of storing 'already paid' and dropping it", async () => {
    const { orderId, providerOrderId } = await onlineOrder();
    const providerPaymentId = `pay_test_${randomUUID().slice(0, 12)}`;
    // The cashier takes cash while Razorpay is being asked: the fast path saw an
    // unpaid order, the lock sees a paid one.
    gatewayCaptured(providerOrderId, async () => {
      const cash = await payCash(orderId);
      if (!cash.ok) throw new Error(`fixture: cash failed: ${cash.error}`);
    });

    const result = await recordOnlinePayment({ orderId, providerPaymentId, providerOrderId });

    expect(result).toMatchObject({ ok: false, code: "RECORDED_FOR_REFUND" });
    const rows = await rowsFor(orderId);
    expect(rows.filter((row) => row.status === "CAPTURED").map((row) => row.provider).sort()).toEqual(["cash", "razorpay"]);
    const order = await orderRow(orderId);
    expect(order.status).toBe("PAID");
    expect(order.invoiceNumber).not.toBeNull();

    // A retry of the same payment gets the same answer, not a stored "already paid".
    const retry = await recordOnlinePayment({ orderId, providerPaymentId, providerOrderId });
    expect(retry).toMatchObject({ ok: false, code: "RECORDED_FOR_REFUND" });
  });

  it("records a payment against a cancelled order, and the order stays cancelled", async () => {
    const { orderId, providerOrderId } = await onlineOrder("CANCELLED");
    const providerPaymentId = `pay_test_${randomUUID().slice(0, 12)}`;
    gatewayCaptured(providerOrderId);

    const result = await recordOnlinePayment({ orderId, providerPaymentId, providerOrderId });

    expect(result).toMatchObject({ ok: false, code: "RECORDED_FOR_REFUND" });
    expect((await rowsFor(orderId)).find((row) => row.providerPaymentId === providerPaymentId)?.status).toBe("CAPTURED");
    expect((await orderRow(orderId)).status).toBe("CANCELLED");
  });

  it("records a second payment made against the same Razorpay order after the first one settled it (checkout path, signed)", async () => {
    const { orderId, providerOrderId } = await onlineOrder();
    gatewayCaptured(providerOrderId);
    const first = `pay_test_${randomUUID().slice(0, 12)}`;
    const settled = await recordOnlinePayment({ orderId, providerPaymentId: first, providerOrderId, signature: paymentSignature({ providerOrderId, providerPaymentId: first, keySecret: KEY_SECRET }) });
    expect(settled.ok).toBe(true);

    const second = `pay_test_${randomUUID().slice(0, 12)}`;
    const result = await recordOnlinePayment({ orderId, providerPaymentId: second, providerOrderId, signature: paymentSignature({ providerOrderId, providerPaymentId: second, keySecret: KEY_SECRET }) });

    expect(result).toMatchObject({ ok: false, code: "RECORDED_FOR_REFUND" });
    const captured = (await rowsFor(orderId)).filter((row) => row.status === "CAPTURED");
    expect(captured.map((row) => row.providerPaymentId).sort()).toEqual([first, second].sort());
  });

  it("the recorded payment can be refunded in full, and the order keeps its cash sale", async () => {
    const { orderId, providerOrderId } = await onlineOrder();
    await payCash(orderId);
    const providerPaymentId = `pay_test_${randomUUID().slice(0, 12)}`;
    gatewayCaptured(providerOrderId);
    await recordOnlinePayment({ orderId, providerPaymentId, providerOrderId });
    const row = (await rowsFor(orderId)).find((r) => r.providerPaymentId === providerPaymentId)!;

    vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith("https://api.razorpay.com/")) return realFetch(input as Parameters<typeof fetch>[0], init);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { amount: number; notes: Record<string, string> };
        return json({ id: `rfnd_${randomUUID().slice(0, 10)}`, entity: "refund", amount: body.amount, currency: "INR", status: "processed", notes: body.notes });
      }
      return json({ entity: "collection", count: 0, items: [] });
    }) as typeof fetch);

    const refund = await refundPayment({ paymentId: row.id, amount: fromRupees("300"), reason: "Paid twice — cash and online", actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: org.orgId, idempotencyKey: randomUUID() });

    expect(refund.ok).toBe(true);
    const rows = await rowsFor(orderId);
    expect(rows.find((r) => r.id === row.id)?.status).toBe("REFUNDED");
    expect(rows.find((r) => r.provider === "cash")?.status).toBe("CAPTURED");
    expect((await orderRow(orderId)).status).toBe("PAID");
  });

  it("answers with a code, never only a sentence: unknown order, unreachable gateway", async () => {
    const missing = await recordOnlinePayment({ orderId: randomUUID(), providerPaymentId: `pay_test_${randomUUID().slice(0, 12)}` });
    expect(missing).toMatchObject({ ok: false, code: "ORDER_NOT_FOUND" });

    const { orderId, providerOrderId } = await onlineOrder();
    vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith("https://api.razorpay.com/") ? new Response("", { status: 503 }) : realFetch(input as Parameters<typeof fetch>[0], init)) as typeof fetch);
    const down = await recordOnlinePayment({ orderId, providerPaymentId: `pay_test_${randomUUID().slice(0, 12)}`, providerOrderId });
    expect(down).toMatchObject({ ok: false, code: "GATEWAY_UNAVAILABLE" });
    expect((await rowsFor(orderId)).every((row) => row.status === "PENDING")).toBe(true);
  });
});

/**
 * A capture that did not happen is never stored under the settlement's
 * idempotency key. withIdempotency keeps whatever `work` returns for 24 hours,
 * and the key does not carry what the retry changes (the tendered cash, the
 * gateway's availability), so a stored failure would be replayed to the
 * corrected retry — for cash, the cashier cannot settle the order for a day;
 * for Razorpay, every webhook redelivery gets the stored failure and the
 * payment is never recorded.
 */
describe("settle — a failed capture is not stored as the answer", () => {
  let org: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg();
  });

  afterAll(async () => {
    await deleteTestOrg(org.orgId);
  });

  it("a short cash tender, corrected, settles the order", async () => {
    const [order] = await db()
      .insert(orders)
      .values({ orgId: org.orgId, locationId: org.locationId, orderNumber: `TEST-${randomUUID().slice(0, 8)}`, businessDate: new Date().toISOString().slice(0, 10), status: "PENDING_PAYMENT", channel: "DINE_IN", fulfilment: "DINE_IN", grandTotal: fromRupees("300") })
      .returning({ id: orders.id });
    const orderId = order!.id;
    const take = (tendered: string) => recordCashPayment({ orderId, actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: org.orgId, tendered: fromRupees(tendered) });

    const short = await take("200");
    expect(short).toMatchObject({ ok: false, code: "CAPTURE_FAILED" });

    const corrected = await take("500");
    expect(corrected.ok).toBe(true);
    expect((await db().select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)))[0]?.status).toBe("PAID");
  });
});
