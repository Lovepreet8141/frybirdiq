/**
 * recordCashPayment's organization scoping against a real database — the
 * Priority 2 security fix. Until now this was verified only by a single
 * manual read-only check against production (with a wrong-org UUID that
 * matched no real order) and by an independent code-reading security
 * review — never by an automated, repeatable test proving a real order
 * belonging to a DIFFERENT, real organization is genuinely unreachable.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, payments } from "@/db/schema";
import { recordCashPayment } from "./payments";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
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
