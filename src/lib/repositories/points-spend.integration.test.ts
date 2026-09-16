/**
 * spendPointsForOrder against a real database — this priority's fix.
 *
 * The bug: `orders.ts` used to read `pointsBalance`, then write
 * `balance - points` computed in JS with no re-check. Two orders from the
 * same customer racing this exact column could both read the same starting
 * balance — the second write would clobber the first deduction, or drive
 * the balance negative outright, since nothing stopped it. The fix is an
 * atomic `UPDATE ... WHERE pointsBalance >= points`, provable only against
 * a real Postgres.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { loyaltyAccounts, loyaltyTransactions, orders } from "@/db/schema";
import { spendPointsForOrder } from "./loyalty";
import { createTestCustomer, createTestOrg, deleteTestOrg, warmPool, type TestOrg } from "./__test-support__/fixtures";
import { fromRupees } from "@/lib/money";

async function createTestOrderRow(org: TestOrg, orderNumber: string) {
  const [order] = await db()
    .insert(orders)
    .values({
      orgId: org.orgId,
      locationId: org.locationId,
      orderNumber,
      businessDate: new Date().toISOString().slice(0, 10),
      status: "PAID",
      channel: "ONLINE",
      fulfilment: "TAKEAWAY",
      grandTotal: fromRupees("300"),
    })
    .returning({ id: orders.id });
  if (!order) throw new Error("fixture: order insert returned no row");
  return order.id;
}

async function seedLoyaltyAccount(orgId: string, customerId: string, pointsBalance: number) {
  const [account] = await db().insert(loyaltyAccounts).values({ orgId, customerId, pointsBalance }).returning({ id: loyaltyAccounts.id });
  if (!account) throw new Error("fixture: loyalty account insert returned no row");
  return account.id;
}

describe("spendPointsForOrder", () => {
  let org: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg();
  });

  afterAll(async () => {
    await deleteTestOrg(org.orgId);
  });

  it("debits the balance and records the ledger entry", async () => {
    const customer = await createTestCustomer(org.orgId);
    await seedLoyaltyAccount(org.orgId, customer.id, 50);
    const orderId = await createTestOrderRow(org, `SPEND-${randomUUID().slice(0, 8)}`);

    const result = await spendPointsForOrder({ orgId: org.orgId, customerId: customer.id, orderId, orderNumber: "SPEND-1", points: 20 });
    expect(result.debited).toBe(true);

    const [account] = await db().select({ pointsBalance: loyaltyAccounts.pointsBalance }).from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, customer.id));
    expect(account?.pointsBalance).toBe(30);

    const [txn] = await db().select().from(loyaltyTransactions).where(and(eq(loyaltyTransactions.orgId, org.orgId), eq(loyaltyTransactions.orderId, orderId)));
    expect(txn?.points).toBe(-20);
  });

  it("refuses to go negative when the balance does not cover the spend", async () => {
    const customer = await createTestCustomer(org.orgId);
    await seedLoyaltyAccount(org.orgId, customer.id, 10);
    const orderId = await createTestOrderRow(org, `SPEND-${randomUUID().slice(0, 8)}`);

    const result = await spendPointsForOrder({ orgId: org.orgId, customerId: customer.id, orderId, orderNumber: "SPEND-2", points: 25 });
    expect(result.debited).toBe(false);

    const [account] = await db().select({ pointsBalance: loyaltyAccounts.pointsBalance }).from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, customer.id));
    expect(account?.pointsBalance).toBe(10); // untouched

    const rows = await db().select().from(loyaltyTransactions).where(eq(loyaltyTransactions.orderId, orderId));
    expect(rows).toHaveLength(0); // no ledger entry for a spend that never happened
  });

  it("Priority's actual design point: two concurrent spends racing the SAME balance never together overdraw it", async () => {
    const customer = await createTestCustomer(org.orgId);
    await seedLoyaltyAccount(org.orgId, customer.id, 30);
    const orderA = await createTestOrderRow(org, `SPEND-${randomUUID().slice(0, 8)}`);
    const orderB = await createTestOrderRow(org, `SPEND-${randomUUID().slice(0, 8)}`);

    // A cold pool's first two concurrent queries can end up serialized by
    // connection-acquisition latency alone, before either ever reaches the
    // guarded UPDATE this test exists to prove — which would let this test
    // pass whether or not that guard is even there. Warm the pool first so
    // the race below is a real one.
    await warmPool();

    // Both orders redeem 25 points at once — a real double-spend race if the
    // decrement were a JS-computed `balance - N` from an earlier read
    // instead of an atomic, guarded SQL write.
    const [a, b] = await Promise.all([
      spendPointsForOrder({ orgId: org.orgId, customerId: customer.id, orderId: orderA, orderNumber: "SPEND-A", points: 25 }),
      spendPointsForOrder({ orgId: org.orgId, customerId: customer.id, orderId: orderB, orderNumber: "SPEND-B", points: 25 }),
    ]);

    const debitedCount = [a, b].filter((r) => r.debited).length;
    expect(debitedCount).toBe(1); // only one of the two ever had the balance to cover it

    const [account] = await db().select({ pointsBalance: loyaltyAccounts.pointsBalance }).from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, customer.id));
    expect(account?.pointsBalance).toBe(5); // 30 - 25, once — never negative, never double-deducted

    const ledgerRows = await db()
      .select()
      .from(loyaltyTransactions)
      .where(and(eq(loyaltyTransactions.orgId, org.orgId), like(loyaltyTransactions.reason, "Spent on order%")));
    const thisTestsRows = ledgerRows.filter((row) => row.orderId === orderA || row.orderId === orderB);
    expect(thisTestsRows).toHaveLength(1); // exactly one ledger entry, matching the one successful debit
  });

  it("is a no-op for zero points, without touching the balance", async () => {
    const customer = await createTestCustomer(org.orgId);
    await seedLoyaltyAccount(org.orgId, customer.id, 15);
    const orderId = await createTestOrderRow(org, `SPEND-${randomUUID().slice(0, 8)}`);

    const result = await spendPointsForOrder({ orgId: org.orgId, customerId: customer.id, orderId, orderNumber: "SPEND-0", points: 0 });
    expect(result.debited).toBe(true);

    const [account] = await db().select({ pointsBalance: loyaltyAccounts.pointsBalance }).from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, customer.id));
    expect(account?.pointsBalance).toBe(15);
  });
});
