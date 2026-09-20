/**
 * pay-ready Q3: can an UNPAID online order reach the kitchen?
 *
 * Before this: yes. PENDING_PAYMENT → ACCEPTED is legal in the domain
 * (order-status.ts, for cash on collection and cash on delivery), the staff
 * order card offers "Accept" on every PENDING_PAYMENT order (order-card.tsx
 * nextStep), and advanceOrder checked payment only at COMPLETED. An online
 * order whose Razorpay payment never finished — a closed tab, a declined
 * card — could be accepted and shown on the KDS (isLiveInKitchen(ACCEPTED)),
 * and food cooked for a customer who never paid and never chose cash.
 *
 * Now: an order waiting on a Razorpay payment reaches the kitchen only once
 * the money is recorded. Cash orders are unchanged — cooking them unpaid is
 * the design.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, payments } from "@/db/schema";
import { fromRupees } from "@/lib/money";
import { advanceOrder } from "./orders";
import { recordCashPayment } from "./payments";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

describe("advanceOrder — an unpaid online order does not reach the kitchen", () => {
  let org: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg();
  });

  afterAll(async () => {
    await deleteTestOrg(org.orgId);
  });

  async function pendingOrder(provider: "razorpay" | "cash") {
    const [order] = await db()
      .insert(orders)
      .values({ orgId: org.orgId, locationId: org.locationId, orderNumber: `TEST-${randomUUID().slice(0, 8)}`, businessDate: new Date().toISOString().slice(0, 10), status: "PENDING_PAYMENT", channel: "ONLINE", fulfilment: "TAKEAWAY", grandTotal: fromRupees("300") })
      .returning({ id: orders.id });
    await db()
      .insert(payments)
      .values({ orgId: org.orgId, orderId: order!.id, status: "PENDING", method: provider === "cash" ? "CASH" : "UPI", amount: fromRupees("300"), provider, providerOrderId: provider === "razorpay" ? `order_test_${randomUUID().slice(0, 12)}` : null });
    return order!.id;
  }

  const accept = (orderId: string) => advanceOrder({ orderId, to: "ACCEPTED", actorUserId: randomUUID(), orgId: org.orgId });
  const statusOf = async (orderId: string) => (await db().select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)))[0]?.status;

  it("refuses to accept an order still waiting on its online payment, and it stays off the kitchen display", async () => {
    const orderId = await pendingOrder("razorpay");
    const result = await accept(orderId);
    expect(result.ok).toBe(false);
    expect(await statusOf(orderId)).toBe("PENDING_PAYMENT");
  });

  async function orderWithNoPaymentRow(channel: "ONLINE" | "TAKEAWAY") {
    const [order] = await db()
      .insert(orders)
      .values({ orgId: org.orgId, locationId: org.locationId, orderNumber: `TEST-${randomUUID().slice(0, 8)}`, businessDate: new Date().toISOString().slice(0, 10), status: "PENDING_PAYMENT", channel, fulfilment: "TAKEAWAY", grandTotal: fromRupees("300") })
      .returning({ id: orders.id });
    return order!.id;
  }

  it("fails closed: a website order with NO payment row (a crash between the order and its payment row) cannot be accepted", async () => {
    const orderId = await orderWithNoPaymentRow("ONLINE");
    const result = await accept(orderId);
    expect(result.ok).toBe(false);
    expect(await statusOf(orderId)).toBe("PENDING_PAYMENT");
  });

  it("a counter order with no payment row is unchanged (only the website channel fails closed)", async () => {
    const orderId = await orderWithNoPaymentRow("TAKEAWAY");
    expect((await accept(orderId)).ok).toBe(true);
  });

  it("accepts a pay-on-collection online order unpaid, as before", async () => {
    const orderId = await pendingOrder("cash");
    expect((await accept(orderId)).ok).toBe(true);
    expect(await statusOf(orderId)).toBe("ACCEPTED");
  });

  it("accepts an online order once its money is recorded — here the customer paid cash at the counter instead", async () => {
    const orderId = await pendingOrder("razorpay");
    const paid = await recordCashPayment({ orderId, actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: org.orgId });
    expect(paid.ok).toBe(true);
    expect((await accept(orderId)).ok).toBe(true);
    expect(await statusOf(orderId)).toBe("ACCEPTED");
  });
});
