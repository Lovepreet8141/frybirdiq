/**
 * Order history's paid and refund state against a real database (kub-f1).
 *
 * The bug: history counted an order as paid only while a payment was
 * CAPTURED, so an order refunded afterwards, in part or in full, showed
 * "Not paid". Paid now means ever captured, and each row carries its refund
 * state.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { orders, payments } from "@/db/schema";
import type { OrderStatus } from "@/domain/order-status";
import type { PaymentRowStatus } from "@/domain/order-payment-state";
import { fromRupees } from "@/lib/money";
import { listOrderHistory } from "./order-history";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

const range = { from: new Date(Date.now() - 60 * 60 * 1000), to: new Date(Date.now() + 60 * 60 * 1000), label: "test" };

async function createOrder(org: TestOrg, status: OrderStatus, paymentStatuses: readonly PaymentRowStatus[]) {
  const [order] = await db()
    .insert(orders)
    .values({
      orgId: org.orgId,
      locationId: org.locationId,
      orderNumber: `TEST-${randomUUID().slice(0, 8)}`,
      businessDate: new Date().toISOString().slice(0, 10),
      status,
      channel: "TAKEAWAY",
      fulfilment: "TAKEAWAY",
      grandTotal: fromRupees("340"),
    })
    .returning({ id: orders.id });
  if (!order) throw new Error("fixture: order insert returned no row");
  for (const paymentStatus of paymentStatuses) {
    const everCaptured = paymentStatus === "CAPTURED" || paymentStatus === "PARTIALLY_REFUNDED" || paymentStatus === "REFUNDED";
    await db()
      .insert(payments)
      .values({
        orgId: org.orgId,
        orderId: order.id,
        status: paymentStatus,
        method: "CASH",
        amount: fromRupees("340"),
        provider: "cash",
        capturedAt: everCaptured ? new Date() : null,
      });
  }
  return order.id;
}

describe("listOrderHistory payment state", () => {
  let org: TestOrg;
  let otherOrg: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg();
    otherOrg = await createTestOrg();
  });

  afterAll(async () => {
    await deleteTestOrg(org.orgId);
    await deleteTestOrg(otherOrg.orgId);
  });

  it("reads each payment state as paid-ever-captured plus its refund state", async () => {
    const cases = [
      { name: "no payment", status: "CANCELLED", payments: [], isPaid: false, paymentState: "UNPAID" },
      { name: "pending", status: "FAILED", payments: ["PENDING"], isPaid: false, paymentState: "UNPAID" },
      { name: "authorized", status: "CANCELLED", payments: ["AUTHORIZED"], isPaid: false, paymentState: "UNPAID" },
      { name: "failed", status: "FAILED", payments: ["FAILED"], isPaid: false, paymentState: "UNPAID" },
      { name: "captured", status: "COMPLETED", payments: ["CAPTURED"], isPaid: true, paymentState: "PAID" },
      { name: "failed then captured", status: "COMPLETED", payments: ["FAILED", "CAPTURED"], isPaid: true, paymentState: "PAID" },
      { name: "partly refunded", status: "COMPLETED", payments: ["PARTIALLY_REFUNDED"], isPaid: true, paymentState: "PARTIALLY_REFUNDED" },
      { name: "one of two refunded", status: "COMPLETED", payments: ["CAPTURED", "REFUNDED"], isPaid: true, paymentState: "PARTIALLY_REFUNDED" },
      { name: "fully refunded", status: "REFUNDED", payments: ["REFUNDED"], isPaid: true, paymentState: "REFUNDED" },
    ] as const;

    const ids = new Map<string, (typeof cases)[number]>();
    for (const c of cases) ids.set(await createOrder(org, c.status, c.payments), c);

    const rows = await listOrderHistory(org.orgId, range);
    for (const [id, c] of ids) {
      const row = rows.find((r) => r.id === id);
      expect(row, c.name).toBeDefined();
      expect({ isPaid: row?.isPaid, paymentState: row?.paymentState }, c.name).toEqual({ isPaid: c.isPaid, paymentState: c.paymentState });
    }
  });

  it("never returns another organization's orders", async () => {
    const foreign = await createOrder(otherOrg, "COMPLETED", ["CAPTURED"]);
    const rows = await listOrderHistory(org.orgId, range);
    expect(rows.some((row) => row.id === foreign)).toBe(false);
  });
});
