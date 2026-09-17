/**
 * recordCashPayment's organization scoping against a real database — the
 * Priority 2 security fix. Until now this was verified only by a single
 * manual read-only check against production (with a wrong-org UUID that
 * matched no real order) and by an independent code-reading security
 * review — never by an automated, repeatable test proving a real order
 * belonging to a DIFFERENT, real organization is genuinely unreachable.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, payments } from "@/db/schema";
import { markOnlinePaymentFailed, recordCashPayment, recordOnlinePayment } from "./payments";
import { paymentSignature } from "@/lib/payments/razorpay";
import { createTestCustomer, createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { fromRupees } from "@/lib/money";

async function createTestOrder(org: TestOrg) {
  const [order] = await db()
    .insert(orders)
    .values({
      orgId: org.orgId,
      locationId: org.locationId,
      orderNumber: `TEST-${randomUUID().slice(0, 8)}`,
      businessDate: new Date().toISOString().slice(0, 10),
      status: "PENDING_PAYMENT",
      channel: "DINE_IN",
      fulfilment: "DINE_IN",
      grandTotal: fromRupees("300"),
    })
    .returning({ id: orders.id });
  if (!order) throw new Error("fixture: order insert returned no row");
  return order.id;
}

describe("recordCashPayment — organization scoping", () => {
  let orgA: TestOrg;
  let orgB: TestOrg;

  beforeAll(async () => {
    orgA = await createTestOrg();
    orgB = await createTestOrg();
  });

  afterAll(async () => {
    await deleteTestOrg(orgA.orgId);
    await deleteTestOrg(orgB.orgId);
  });

  it("refuses to settle org A's order when called with org B's orgId — the exact cross-tenant gap Priority 2 closed", async () => {
    const orderInOrgA = await createTestOrder(orgA);

    const result = await recordCashPayment({
      orderId: orderInOrgA,
      actorUserId: randomUUID(),
      actorRoles: ["OWNER"],
      orgId: orgB.orgId, // the attack: a staff member of org B supplying org A's real order id
      tendered: fromRupees("300"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("That order does not exist.");

    // Nothing was captured — the order is still exactly where it was.
    const [order] = await db().select({ status: orders.status }).from(orders).where(eq(orders.id, orderInOrgA));
    expect(order?.status).toBe("PENDING_PAYMENT");
    const capturedPayments = await db().select().from(payments).where(eq(payments.orderId, orderInOrgA));
    expect(capturedPayments.filter((p) => p.status === "CAPTURED")).toHaveLength(0);
  });

  it("succeeds when called with the order's own, correct orgId", async () => {
    const orderInOrgA = await createTestOrder(orgA);

    const result = await recordCashPayment({
      orderId: orderInOrgA,
      actorUserId: randomUUID(),
      actorRoles: ["OWNER"],
      orgId: orgA.orgId,
      tendered: fromRupees("300"),
    });

    expect(result.ok).toBe(true);

    const [order] = await db().select({ status: orders.status }).from(orders).where(eq(orders.id, orderInOrgA));
    expect(order?.status).toBe("PAID");
    const capturedPayments = await db().select().from(payments).where(eq(payments.orderId, orderInOrgA));
    expect(capturedPayments.filter((p) => p.status === "CAPTURED")).toHaveLength(1);
  });

  it("the wrong-org refusal and a genuinely-missing order are indistinguishable — no cross-org existence leak", async () => {
    const wrongOrg = await recordCashPayment({ orderId: randomUUID(), actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: orgB.orgId, tendered: fromRupees("300") });
    const realOrderWrongOrg = await recordCashPayment({ orderId: await createTestOrder(orgA), actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: orgB.orgId, tendered: fromRupees("300") });

    expect(wrongOrg.ok).toBe(false);
    expect(realOrderWrongOrg.ok).toBe(false);
    if (wrongOrg.ok || realOrderWrongOrg.ok) throw new Error("unreachable");
    expect(wrongOrg.error).toBe(realOrderWrongOrg.error);
  });

  it("a terminal or refunded order in another org is still just 'does not exist' — the pay-6 refusals leak nothing across orgs", async () => {
    const cancelledInOrgA = await createTestOrder(orgA);
    await db().update(orders).set({ status: "CANCELLED" }).where(eq(orders.id, cancelledInOrgA));

    const refundedInOrgA = await createTestOrder(orgA);
    const paid = await recordCashPayment({ orderId: refundedInOrgA, actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: orgA.orgId, tendered: fromRupees("300") });
    if (!paid.ok) throw new Error(`fixture: settlement failed: ${paid.error}`);
    await db().update(payments).set({ status: "REFUNDED" }).where(eq(payments.id, paid.paymentId));

    for (const orderId of [cancelledInOrgA, refundedInOrgA]) {
      const result = await recordCashPayment({ orderId, actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: orgB.orgId, tendered: fromRupees("300") });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error).toBe("That order does not exist.");
    }

    // The same orders, asked from their own org, are refused for what they are.
    const ownCancelled = await recordCashPayment({ orderId: cancelledInOrgA, actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: orgA.orgId, tendered: fromRupees("300") });
    const ownRefunded = await recordCashPayment({ orderId: refundedInOrgA, actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: orgA.orgId, tendered: fromRupees("300") });
    if (ownCancelled.ok || ownRefunded.ok) throw new Error("expected both refused");
    expect(ownCancelled.error).toMatch(/cancelled/);
    expect(ownRefunded.error).toMatch(/refunded/);
  });
});

/**
 * pay-8: the Razorpay order named by the caller must be the one THIS order's
 * pending payment was opened for. Without the binding, a valid signature for
 * one purchase could settle a different order's UUID (a payment for order A
 * marks order B paid). The gateway is a recorded-shape fetch stub — no
 * provider calls, no real payments.
 */
describe("recordOnlinePayment — pending-row binding (pay-8)", () => {
  let org: TestOrg;
  const savedKeyId = process.env.RAZORPAY_KEY_ID;
  const savedKeySecret = process.env.RAZORPAY_KEY_SECRET;
  const KEY_SECRET = "integration-test-secret";
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    org = await createTestOrg();
    process.env.RAZORPAY_KEY_ID = "rzp_test_integration";
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  });

  afterAll(async () => {
    if (savedKeyId === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = savedKeyId;
    if (savedKeySecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
    else process.env.RAZORPAY_KEY_SECRET = savedKeySecret;
    vi.unstubAllGlobals();
    await deleteTestOrg(org.orgId);
  });

  function stubRazorpayPaymentFetch(payment: { id: string; order_id: string; amount: number }) {
    vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("https://api.razorpay.com/")) {
        return new Response(
          JSON.stringify({ ...payment, currency: "INR", status: "captured", method: "upi", fee: 0, tax: 0 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return realFetch(input as Parameters<typeof fetch>[0], init);
    }) as typeof fetch);
  }

  async function createOnlineOrder() {
    const orderId = await createTestOrder(org);
    const providerOrderId = `order_test_${randomUUID().slice(0, 12)}`;
    await db().insert(payments).values({
      orgId: org.orgId,
      orderId,
      status: "PENDING",
      method: "UPI",
      amount: fromRupees("300"),
      provider: "razorpay",
      providerOrderId,
    });
    return { orderId, providerOrderId };
  }

  it("refuses a payment for order A aimed at order B — even with a genuinely valid signature", async () => {
    const victim = await createOnlineOrder();
    const attacker = await createOnlineOrder();
    const providerPaymentId = `pay_test_${randomUUID().slice(0, 12)}`;
    // The attacker really paid THEIR order: this signature is cryptographically
    // valid for (attacker's razorpay order | payment). Only the row binding
    // stands between it and the victim's order.
    const signature = paymentSignature({ providerOrderId: attacker.providerOrderId, providerPaymentId, keySecret: KEY_SECRET });

    const result = await recordOnlinePayment({
      orderId: victim.orderId,
      providerPaymentId,
      providerOrderId: attacker.providerOrderId,
      signature,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/does not belong/);

    // Nothing changed anywhere: no capture, and the probe did not even
    // deface the victim's pending row with a failure note.
    const rows = await db().select().from(payments).where(eq(payments.orderId, victim.orderId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("PENDING");
    expect(rows[0]?.failureReason).toBeNull();
    const [victimOrder] = await db().select({ status: orders.status }).from(orders).where(eq(orders.id, victim.orderId));
    expect(victimOrder?.status).toBe("PENDING_PAYMENT");
  });

  it("settles normally when the named Razorpay order matches the pending row", async () => {
    const own = await createOnlineOrder();
    const providerPaymentId = `pay_test_${randomUUID().slice(0, 12)}`;
    stubRazorpayPaymentFetch({ id: providerPaymentId, order_id: own.providerOrderId, amount: 30000 });
    const signature = paymentSignature({ providerOrderId: own.providerOrderId, providerPaymentId, keySecret: KEY_SECRET });

    const result = await recordOnlinePayment({ orderId: own.orderId, providerPaymentId, providerOrderId: own.providerOrderId, signature });

    expect(result.ok).toBe(true);
    const [order] = await db().select({ status: orders.status }).from(orders).where(eq(orders.id, own.orderId));
    expect(order?.status).toBe("PAID");
    const captured = await db().select().from(payments).where(and(eq(payments.orderId, own.orderId), eq(payments.status, "CAPTURED")));
    expect(captured).toHaveLength(1);
  });

  it("with no pending row there is nothing to verify against, and a signed confirm is refused", async () => {
    const orderId = await createTestOrder(org); // no razorpay pending row at all
    const providerPaymentId = `pay_test_${randomUUID().slice(0, 12)}`;
    const strayProviderOrder = `order_test_${randomUUID().slice(0, 12)}`;
    const signature = paymentSignature({ providerOrderId: strayProviderOrder, providerPaymentId, keySecret: KEY_SECRET });

    const result = await recordOnlinePayment({ orderId, providerPaymentId, providerOrderId: strayProviderOrder, signature });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/No Razorpay order id to verify against/);
    const captured = await db().select().from(payments).where(and(eq(payments.orderId, orderId), eq(payments.status, "CAPTURED")));
    expect(captured).toHaveLength(0);
  });
});

/**
 * pay-5: the anonymous payment-failure write is bound to the order's own
 * customer. The action resolves who is calling (session / checkout cookie);
 * the repository enforces the match, which is what these tests prove — the
 * cookie itself needs a request context vitest does not have.
 */
describe("markOnlinePaymentFailed — ownership binding (pay-5)", () => {
  let orgA: TestOrg;
  let orgB: TestOrg;

  beforeAll(async () => {
    orgA = await createTestOrg();
    orgB = await createTestOrg();
  });

  afterAll(async () => {
    await deleteTestOrg(orgA.orgId);
    await deleteTestOrg(orgB.orgId);
  });

  async function createOnlineOrderWithCustomer(org: TestOrg, opts: { customerId?: string | null; phone?: string | null } = {}) {
    const [order] = await db()
      .insert(orders)
      .values({
        orgId: org.orgId,
        locationId: org.locationId,
        orderNumber: `TEST-${randomUUID().slice(0, 8)}`,
        businessDate: new Date().toISOString().slice(0, 10),
        status: "PENDING_PAYMENT",
        channel: "ONLINE",
        fulfilment: "TAKEAWAY",
        customerId: opts.customerId ?? null,
        customerPhone: opts.phone ?? null,
        grandTotal: fromRupees("300"),
      })
      .returning({ id: orders.id });
    if (!order) throw new Error("fixture: order insert returned no row");
    await db().insert(payments).values({
      orgId: org.orgId,
      orderId: order.id,
      status: "PENDING",
      method: "UPI",
      amount: fromRupees("300"),
      provider: "razorpay",
      providerOrderId: `order_test_${randomUUID().slice(0, 12)}`,
    });
    return order.id;
  }

  async function failureReasonOf(orderId: string) {
    const [row] = await db().select({ failureReason: payments.failureReason }).from(payments).where(eq(payments.orderId, orderId));
    return row?.failureReason ?? null;
  }

  it("writes for the order's own phone, and refuses a stranger, an empty identity, and the wrong customer id", async () => {
    const customer = await createTestCustomer(orgA.orgId);
    const orderId = await createOnlineOrderWithCustomer(orgA, { customerId: customer.id, phone: customer.phone });

    const stranger = await markOnlinePaymentFailed({ orderId, reason: "strange", via: { kind: "customer", customerId: null, phone: "9000000001" } });
    expect(stranger.ok).toBe(false);
    const empty = await markOnlinePaymentFailed({ orderId, reason: "empty", via: { kind: "customer", customerId: null, phone: null } });
    expect(empty.ok).toBe(false);
    const wrongId = await markOnlinePaymentFailed({ orderId, reason: "wrong id", via: { kind: "customer", customerId: randomUUID(), phone: null } });
    expect(wrongId.ok).toBe(false);
    expect(await failureReasonOf(orderId)).toBeNull();

    const owner = await markOnlinePaymentFailed({ orderId, reason: "UPI app timed out", via: { kind: "customer", customerId: null, phone: customer.phone } });
    expect(owner.ok).toBe(true);
    expect(await failureReasonOf(orderId)).toBe("UPI app timed out");

    const byId = await markOnlinePaymentFailed({ orderId, reason: "second try failed too", via: { kind: "customer", customerId: customer.id, phone: null } });
    expect(byId.ok).toBe(true);
    expect(await failureReasonOf(orderId)).toBe("second try failed too");
  });

  it("the verified webhook may always write; an org-A customer id gets nothing on an org-B order", async () => {
    const customerA = await createTestCustomer(orgA.orgId);
    const orderInB = await createOnlineOrderWithCustomer(orgB, { customerId: null, phone: "9000000002" });

    const crossOrg = await markOnlinePaymentFailed({ orderId: orderInB, reason: "cross-org probe", via: { kind: "customer", customerId: customerA.id, phone: null } });
    expect(crossOrg.ok).toBe(false);
    expect(await failureReasonOf(orderInB)).toBeNull();

    const webhook = await markOnlinePaymentFailed({ orderId: orderInB, reason: "Bank declined", via: { kind: "webhook" } });
    expect(webhook.ok).toBe(true);
    expect(await failureReasonOf(orderInB)).toBe("Bank declined");
  });

  it("never touches a non-PENDING payment, even for the rightful owner", async () => {
    const customer = await createTestCustomer(orgA.orgId);
    const orderId = await createOnlineOrderWithCustomer(orgA, { customerId: customer.id, phone: customer.phone });
    await db().update(payments).set({ status: "CAPTURED", capturedAt: new Date() }).where(eq(payments.orderId, orderId));

    const result = await markOnlinePaymentFailed({ orderId, reason: "too late", via: { kind: "customer", customerId: customer.id, phone: customer.phone } });
    expect(result.ok).toBe(false);
    expect(await failureReasonOf(orderId)).toBeNull();
  });
});
