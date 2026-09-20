/**
 * The Razorpay webhook route, end to end against a real database (pay-ready).
 *
 * Retry or final is decided by the settlement's result code, never by its
 * wording (pay-7): a 500 makes Razorpay deliver again, for up to a day, so a
 * final answer answered with 500 is an endless loop, and a retryable answer
 * answered with 200 is a payment nobody records.
 *
 * The gateway is a recorded-shape fetch stub. No provider calls, no real payments.
 */
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, payments, webhookEvents } from "@/db/schema";
import { fromRupees } from "@/lib/money";
import { POST } from "@/app/api/payments/razorpay/webhook/route";
import { recordCashPayment } from "./payments";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { ORG_SLUG } from "./org";

const WEBHOOK_SECRET = "integration-webhook-secret";
const AMOUNT = 30000;

describe("POST /api/payments/razorpay/webhook", () => {
  let org: TestOrg;
  let other: TestOrg;
  const saved = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET, hook: process.env.RAZORPAY_WEBHOOK_SECRET };
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    org = await createTestOrg({ slug: ORG_SLUG });
    other = await createTestOrg();
    process.env.RAZORPAY_KEY_ID = "rzp_test_integration";
    process.env.RAZORPAY_KEY_SECRET = "integration-test-secret";
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    for (const [key, value] of [["RAZORPAY_KEY_ID", saved.id], ["RAZORPAY_KEY_SECRET", saved.secret], ["RAZORPAY_WEBHOOK_SECRET", saved.hook]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await deleteTestOrg(org.orgId);
    await deleteTestOrg(other.orgId);
  });

  async function onlineOrder(owner: TestOrg = org, status: "PENDING_PAYMENT" | "CANCELLED" = "PENDING_PAYMENT") {
    const [order] = await db()
      .insert(orders)
      .values({ orgId: owner.orgId, locationId: owner.locationId, orderNumber: `TEST-${randomUUID().slice(0, 8)}`, businessDate: new Date().toISOString().slice(0, 10), status, channel: "ONLINE", fulfilment: "TAKEAWAY", grandTotal: fromRupees("300") })
      .returning({ id: orders.id });
    if (!order) throw new Error("fixture: no order");
    const providerOrderId = `order_test_${randomUUID().slice(0, 12)}`;
    await db().insert(payments).values({ orgId: owner.orgId, orderId: order.id, status: "PENDING", method: "UPI", amount: fromRupees("300"), provider: "razorpay", providerOrderId });
    return { orderId: order.id, providerOrderId };
  }

  function gateway(answer: "captured" | "down", providerOrderId?: string) {
    let calls = 0;
    vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith("https://api.razorpay.com/")) return realFetch(input as Parameters<typeof fetch>[0], init);
      calls += 1;
      if (answer === "down") return new Response("", { status: 502 });
      const id = decodeURIComponent(url.split("/payments/")[1]?.split("/")[0] ?? "");
      return new Response(JSON.stringify({ id, order_id: providerOrderId, amount: AMOUNT, currency: "INR", status: "captured", method: "upi", fee: 0, tax: 0 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch);
    return { calls: () => calls };
  }

  function delivery(event: string, payment: { id: string; order_id: string }, options: { eventId?: string; signature?: string } = {}) {
    const body = JSON.stringify({ event, payload: { payment: { entity: { ...payment, status: event === "payment.failed" ? "failed" : "captured" } } } });
    const signature = options.signature ?? createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
    return new Request("http://localhost/api/payments/razorpay/webhook", {
      method: "POST",
      body,
      headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": options.eventId ?? `evt_${randomUUID()}` },
    });
  }

  const eventRow = async (eventId: string) => (await db().select().from(webhookEvents).where(and(eq(webhookEvents.provider, "razorpay"), eq(webhookEvents.eventId, eventId))))[0];
  const captured = (orderId: string) => db().select().from(payments).where(and(eq(payments.orderId, orderId), eq(payments.status, "CAPTURED")));

  it("refuses a body whose signature does not verify, and records nothing", async () => {
    const { orderId, providerOrderId } = await onlineOrder();
    const eventId = `evt_${randomUUID()}`;
    const response = await POST(delivery("payment.captured", { id: `pay_test_${randomUUID().slice(0, 12)}`, order_id: providerOrderId }, { eventId, signature: "ab".repeat(32) }));
    expect(response.status).toBe(400);
    expect(await eventRow(eventId)).toBeUndefined();
    expect(await captured(orderId)).toHaveLength(0);
  });

  it("settles a captured payment once, and answers a redelivery of the same event from the table", async () => {
    const { orderId, providerOrderId } = await onlineOrder();
    const paymentId = `pay_test_${randomUUID().slice(0, 12)}`;
    const eventId = `evt_${randomUUID()}`;
    const gw = gateway("captured", providerOrderId);

    const first = await POST(delivery("payment.captured", { id: paymentId, order_id: providerOrderId }, { eventId }));
    expect(first.status).toBe(200);
    expect((await eventRow(eventId))?.processedAt).toBeInstanceOf(Date);

    const again = await POST(delivery("payment.captured", { id: paymentId, order_id: providerOrderId }, { eventId }));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ ok: true, duplicate: true });
    expect(gw.calls()).toBe(1);

    // A different event for the same payment (order.paid after payment.captured) settles nothing new.
    const other = await POST(delivery("order.paid", { id: paymentId, order_id: providerOrderId }));
    expect(other.status).toBe(200);
    expect(await captured(orderId)).toHaveLength(1);
    expect((await db().select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)))[0]?.status).toBe("PAID");
  });

  it("a payment the order can no longer take is recorded for refund and acknowledged — not a 500 retry loop ('cannot take payment')", async () => {
    const { orderId, providerOrderId } = await onlineOrder(org, "CANCELLED");
    const eventId = `evt_${randomUUID()}`;
    gateway("captured", providerOrderId);

    const response = await POST(delivery("payment.captured", { id: `pay_test_${randomUUID().slice(0, 12)}`, order_id: providerOrderId }, { eventId }));

    expect(response.status).toBe(200);
    expect((await eventRow(eventId))?.processedAt).toBeInstanceOf(Date);
    expect(await captured(orderId)).toHaveLength(1);
    expect((await db().select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)))[0]?.status).toBe("CANCELLED");
  });

  it("a payment arriving after cash settled the order is recorded for refund, with a 200", async () => {
    const { orderId, providerOrderId } = await onlineOrder();
    const cash = await recordCashPayment({ orderId, actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: org.orgId });
    expect(cash.ok).toBe(true);
    gateway("captured", providerOrderId);

    const response = await POST(delivery("payment.captured", { id: `pay_test_${randomUUID().slice(0, 12)}`, order_id: providerOrderId }));

    expect(response.status).toBe(200);
    expect((await captured(orderId)).map((row) => row.provider).sort()).toEqual(["cash", "razorpay"]);
  });

  it("an order that belongs to another organization is a final answer (200), never a 500 retry loop", async () => {
    const foreign = await onlineOrder(other);
    const eventId = `evt_${randomUUID()}`;
    const gw = gateway("captured", foreign.providerOrderId);

    const response = await POST(delivery("payment.captured", { id: `pay_test_${randomUUID().slice(0, 12)}`, order_id: foreign.providerOrderId }, { eventId }));

    expect(response.status).toBe(200);
    expect((await eventRow(eventId))?.processedAt).toBeInstanceOf(Date);
    expect(await captured(foreign.orderId)).toHaveLength(0);
    expect(gw.calls()).toBe(0);
  });

  it("a gateway that cannot be reached is retried: 500, and the event stays unprocessed so the redelivery runs it", async () => {
    const { orderId, providerOrderId } = await onlineOrder();
    const paymentId = `pay_test_${randomUUID().slice(0, 12)}`;
    const eventId = `evt_${randomUUID()}`;
    gateway("down");

    const response = await POST(delivery("payment.captured", { id: paymentId, order_id: providerOrderId }, { eventId }));
    expect(response.status).toBe(500);
    const row = await eventRow(eventId);
    expect(row?.processedAt).toBeNull();
    expect(row?.error).toBeTruthy();
    expect(await captured(orderId)).toHaveLength(0);

    // Razorpay delivers again once the gateway answers: settled.
    gateway("captured", providerOrderId);
    const retry = await POST(delivery("payment.captured", { id: paymentId, order_id: providerOrderId }, { eventId }));
    expect(retry.status).toBe(200);
    expect(await captured(orderId)).toHaveLength(1);
  });
});
