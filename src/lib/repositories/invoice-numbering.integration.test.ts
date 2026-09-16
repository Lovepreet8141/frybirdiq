/**
 * Invoice numbering against a real database — this priority's fix.
 *
 * The bug: `settle()` (src/lib/repositories/payments.ts) assigns the next
 * invoice number by counting what's already been issued this financial
 * year, then writing `count + 1`. Two settlements landing close together
 * could both count the same total and both try to write the same number —
 * the unique constraint on (org_id, invoice_number) caught the collision,
 * but nothing retried it, so the LOSING settlement threw an unhandled
 * error. By that point the payment had already been captured as a separate,
 * earlier statement: real money taken, and then an unrelated numbering
 * collision crashing the request back at the cashier, with the order stuck
 * short of PAID despite the till already being correct.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { recordCashPayment } from "./payments";
import { createTestOrg, warmPool, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { fromRupees } from "@/lib/money";
import { financialYear } from "@/lib/invoice";

async function createTestOrderPendingPayment(org: TestOrg) {
  const [order] = await db()
    .insert(orders)
    .values({
      orgId: org.orgId,
      locationId: org.locationId,
      orderNumber: `TEST-${randomUUID().slice(0, 8)}`,
      businessDate: new Date().toISOString().slice(0, 10),
      status: "PENDING_PAYMENT",
      channel: "TAKEAWAY",
      fulfilment: "TAKEAWAY",
      grandTotal: fromRupees("150"),
    })
    .returning({ id: orders.id });
  if (!order) throw new Error("fixture: order insert returned no row");
  return order.id;
}

describe("settle — invoice numbering", () => {
  let org: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg();
  });

  afterAll(async () => {
    await deleteTestOrg(org.orgId);
  });

  it("issues a real, unique invoice number on settlement", async () => {
    const orderId = await createTestOrderPendingPayment(org);
    const result = await recordCashPayment({ orderId, actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: org.orgId, tendered: fromRupees("150") });
    expect(result.ok).toBe(true);

    const [row] = await db().select({ invoiceNumber: orders.invoiceNumber, status: orders.status }).from(orders).where(eq(orders.id, orderId));
    expect(row?.status).toBe("PAID");
    expect(row?.invoiceNumber).toBeTruthy();
  });

  it("two concurrent settlements never crash on the same invoice number — both succeed, both get distinct numbers", async () => {
    const orderA = await createTestOrderPendingPayment(org);
    const orderB = await createTestOrderPendingPayment(org);

    await warmPool();

    const [a, b] = await Promise.all([
      recordCashPayment({ orderId: orderA, actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: org.orgId, tendered: fromRupees("150") }),
      recordCashPayment({ orderId: orderB, actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: org.orgId, tendered: fromRupees("150") }),
    ]);

    // The actual point of the fix: neither call throws, neither returns
    // ok:false because of the race — the retry absorbs the collision.
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);

    const rows = await db()
      .select({ id: orders.id, invoiceNumber: orders.invoiceNumber, status: orders.status })
      .from(orders)
      .where(and(eq(orders.orgId, org.orgId), eq(orders.id, orderA)));
    const [rowB] = await db().select({ invoiceNumber: orders.invoiceNumber, status: orders.status }).from(orders).where(eq(orders.id, orderB));

    expect(rows[0]?.status).toBe("PAID");
    expect(rowB?.status).toBe("PAID");
    expect(rows[0]?.invoiceNumber).toBeTruthy();
    expect(rowB?.invoiceNumber).toBeTruthy();
    expect(rows[0]?.invoiceNumber).not.toBe(rowB?.invoiceNumber); // never a duplicate

    // Both numbers actually belong to this financial year's sequence.
    const year = financialYear(new Date());
    expect(rows[0]?.invoiceNumber).toMatch(new RegExp(`^${year}/`));
    expect(rowB?.invoiceNumber).toMatch(new RegExp(`^${year}/`));
  });

  it("a burst of five concurrent settlements all land with distinct invoice numbers", async () => {
    const orderIds = await Promise.all(Array.from({ length: 5 }, () => createTestOrderPendingPayment(org)));

    await warmPool();

    const results = await Promise.all(
      orderIds.map((orderId) => recordCashPayment({ orderId, actorUserId: randomUUID(), actorRoles: ["OWNER"], orgId: org.orgId, tendered: fromRupees("150") })),
    );
    expect(results.every((r) => r.ok)).toBe(true);

    const rows = await db()
      .select({ invoiceNumber: orders.invoiceNumber })
      .from(orders)
      .where(and(eq(orders.orgId, org.orgId), like(orders.invoiceNumber, `${financialYear(new Date())}/%`)));
    const numbers = rows.map((r) => r.invoiceNumber).filter((n): n is string => n !== null);
    const distinct = new Set(numbers);
    expect(distinct.size).toBe(numbers.length); // no two orders ever share a number
    expect(numbers.length).toBeGreaterThanOrEqual(5);
  });
});
