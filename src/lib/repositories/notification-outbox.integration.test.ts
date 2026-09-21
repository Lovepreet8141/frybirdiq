/** The 7.2 local proof: bumping an order to READY sends one message through the mock, once, even on retries. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationOutbox, orders, payments } from "@/db/schema";
import { fromRupees } from "@/lib/money";
import { MockWhatsappProvider } from "@/lib/notifications/whatsapp-mock";
import { dispatchPending, enqueueOrderUpdate, MAX_SEND_ATTEMPTS } from "./notification-outbox";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

const SITE = "https://example.test";
// Obviously fake: a 555-style number that is a valid shape for the parser.
const FAKE_PHONE = "9000000001";

let org: TestOrg;
let other: TestOrg;

async function makeOrder(o: TestOrg, status: "ACCEPTED" | "READY" | "PENDING_PAYMENT", phone: string | null = FAKE_PHONE) {
  const [row] = await db()
    .insert(orders)
    .values({
      orgId: o.orgId,
      locationId: o.locationId,
      orderNumber: `T-${randomUUID().slice(0, 6)}`,
      businessDate: new Date().toISOString().slice(0, 10),
      status,
      channel: "ONLINE",
      fulfilment: "TAKEAWAY",
      grandTotal: fromRupees("200"),
      customerPhone: phone,
    })
    .returning({ id: orders.id });
  if (!row) throw new Error("fixture");
  return row.id;
}

const outboxOf = (orgId: string, orderId: string) =>
  db().select().from(notificationOutbox).where(and(eq(notificationOutbox.orgId, orgId), eq(notificationOutbox.orderId, orderId)));

describe("notification outbox", () => {
  beforeAll(async () => {
    org = await createTestOrg();
    other = await createTestOrg();
  });
  afterAll(async () => {
    await deleteTestOrg(org.orgId);
    await deleteTestOrg(other.orgId);
  });

  it("enqueues once per status change however often it is asked, and sends one message", async () => {
    const id = await makeOrder(org, "READY");
    const first = await enqueueOrderUpdate({ orgId: org.orgId, orderId: id, toStatus: "READY", siteUrl: SITE });
    const second = await enqueueOrderUpdate({ orgId: org.orgId, orderId: id, toStatus: "READY", siteUrl: SITE });
    const [a, b] = await Promise.all([
      enqueueOrderUpdate({ orgId: org.orgId, orderId: id, toStatus: "READY", siteUrl: SITE }),
      enqueueOrderUpdate({ orgId: org.orgId, orderId: id, toStatus: "READY", siteUrl: SITE }),
    ]);
    expect(first).toEqual({ enqueued: true });
    expect([second, a, b].every((r) => !r.enqueued && "reason" in r && r.reason === "already_queued")).toBe(true);
    expect(await outboxOf(org.orgId, id)).toHaveLength(1);

    const mock = new MockWhatsappProvider();
    const run = await dispatchPending({ orgId: org.orgId, provider: mock });
    expect(run.sent).toBe(1);
    // A second dispatch, or a concurrent one, finds nothing left.
    const [r2, r3] = await Promise.all([dispatchPending({ orgId: org.orgId, provider: mock }), dispatchPending({ orgId: org.orgId, provider: mock })]);
    expect(r2.sent + r3.sent).toBe(0);
    expect(mock.sent).toHaveLength(1);
    expect(mock.sent[0]?.template).toBe("order_ready");
    expect(mock.sent[0]?.to).toBe(`91${FAKE_PHONE}`);
    const [row] = await outboxOf(org.orgId, id);
    expect(row?.status).toBe("SENT");
    expect(row?.provider).toBe("mock");
  });

  it("queues a separate message for a different status of the same order", async () => {
    const id = await makeOrder(org, "ACCEPTED");
    await enqueueOrderUpdate({ orgId: org.orgId, orderId: id, toStatus: "ACCEPTED", siteUrl: SITE });
    await enqueueOrderUpdate({ orgId: org.orgId, orderId: id, toStatus: "READY", siteUrl: SITE });
    expect(await outboxOf(org.orgId, id)).toHaveLength(2);
  });

  it("does not queue statuses nobody is told about, a missing phone, or another org's order", async () => {
    const id = await makeOrder(org, "READY");
    expect(await enqueueOrderUpdate({ orgId: org.orgId, orderId: id, toStatus: "PREPARING", siteUrl: SITE })).toEqual({ enqueued: false, reason: "not_notifiable" });
    const noPhone = await makeOrder(org, "READY", null);
    expect(await enqueueOrderUpdate({ orgId: org.orgId, orderId: noPhone, toStatus: "READY", siteUrl: SITE })).toEqual({ enqueued: false, reason: "no_phone" });
    expect(await enqueueOrderUpdate({ orgId: other.orgId, orderId: id, toStatus: "READY", siteUrl: SITE })).toEqual({ enqueued: false, reason: "order_not_found" });
    const junk = await makeOrder(org, "READY", "12345");
    expect(await enqueueOrderUpdate({ orgId: org.orgId, orderId: junk, toStatus: "READY", siteUrl: SITE })).toEqual({ enqueued: false, reason: "no_phone" });
  });

  it("dispatch is scoped to its own org", async () => {
    const id = await makeOrder(org, "READY");
    await enqueueOrderUpdate({ orgId: org.orgId, orderId: id, toStatus: "READY", siteUrl: SITE });
    const mock = new MockWhatsappProvider();
    expect((await dispatchPending({ orgId: other.orgId, provider: mock })).sent).toBe(0);
    expect(mock.sent).toHaveLength(0);
    await dispatchPending({ orgId: org.orgId, provider: mock });
  });

  it("retries a transient failure, then gives up; a rejected number fails at once", async () => {
    const id = await makeOrder(org, "READY");
    await enqueueOrderUpdate({ orgId: org.orgId, orderId: id, toStatus: "READY", siteUrl: SITE });
    const mock = new MockWhatsappProvider();
    mock.failOnce({ ok: false, retryable: true, error: "timeout" });
    expect(await dispatchPending({ orgId: org.orgId, provider: mock })).toMatchObject({ retryLater: 1, sent: 0 });
    expect((await outboxOf(org.orgId, id))[0]).toMatchObject({ status: "PENDING", attempts: 1, lastError: "timeout" });
    expect(await dispatchPending({ orgId: org.orgId, provider: mock })).toMatchObject({ sent: 1 });

    const id2 = await makeOrder(org, "READY");
    await enqueueOrderUpdate({ orgId: org.orgId, orderId: id2, toStatus: "READY", siteUrl: SITE });
    mock.failOnce({ ok: false, retryable: false, error: "not a whatsapp number" });
    expect(await dispatchPending({ orgId: org.orgId, provider: mock })).toMatchObject({ failed: 1 });
    expect((await outboxOf(org.orgId, id2))[0]?.status).toBe("FAILED");
    expect(MAX_SEND_ATTEMPTS).toBeGreaterThan(1);
  });

  it("tells an order awaiting online payment nothing about paying at the counter", async () => {
    const id = await makeOrder(org, "ACCEPTED");
    await db().insert(payments).values({ orgId: org.orgId, orderId: id, status: "PENDING", method: "UPI", amount: fromRupees("200"), provider: "razorpay" });
    await enqueueOrderUpdate({ orgId: org.orgId, orderId: id, toStatus: "ACCEPTED", siteUrl: SITE });
    const [row] = await outboxOf(org.orgId, id);
    expect(row?.body).not.toContain("counter");
    expect(row?.body).toContain("online payment");
  });

  // outbox-paid-position: the message reads payment state through the same rules as the kitchen guard and the board.
  it("a website order with no payment row yet is told it awaits online payment, not to pay at the counter", async () => {
    const id = await makeOrder(org, "ACCEPTED");
    await enqueueOrderUpdate({ orgId: org.orgId, orderId: id, toStatus: "ACCEPTED", siteUrl: SITE });
    const [row] = await outboxOf(org.orgId, id);
    expect(row?.body).toContain("online payment");
    expect(row?.body).not.toContain("counter");
  });

  it("a capture recorded for a refund (unapplied) is not reported as paid", async () => {
    const paid = await makeOrder(org, "ACCEPTED");
    await db().insert(payments).values({ orgId: org.orgId, orderId: paid, status: "CAPTURED", method: "UPI", amount: fromRupees("200"), provider: "razorpay" });
    const unapplied = await makeOrder(org, "ACCEPTED");
    await db().insert(payments).values({ orgId: org.orgId, orderId: unapplied, status: "CAPTURED", method: "UPI", amount: fromRupees("200"), provider: "razorpay", providerPayload: { unapplied: true } });
    await enqueueOrderUpdate({ orgId: org.orgId, orderId: paid, toStatus: "ACCEPTED", siteUrl: SITE });
    await enqueueOrderUpdate({ orgId: org.orgId, orderId: unapplied, toStatus: "ACCEPTED", siteUrl: SITE });
    const [paidRow] = await outboxOf(org.orgId, paid);
    const [unappliedRow] = await outboxOf(org.orgId, unapplied);
    expect(paidRow?.body).not.toContain("Pay at the counter");
    expect(unappliedRow?.body).toContain("Pay at the counter");
  });
});
