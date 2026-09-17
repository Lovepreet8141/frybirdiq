/**
 * reversePointsForOrder against a real database — the Priority 5 fix.
 * Verifies the floor-at-zero clamp and the idempotency guard for real,
 * against the actual loyaltyAccounts/loyaltyTransactions tables.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { loyaltyAccounts, loyaltyTransactions, orders } from "@/db/schema";
import { reversePointsForOrder } from "./loyalty";
import { createTestCustomer, createTestOrg, deleteTestOrg, warmPool, type TestOrg } from "./__test-support__/fixtures";
import { fromRupees } from "@/lib/money";

/**
 * Runs `start()` while a separate transaction holds the order row FOR
 * UPDATE; releases it only once `waiters` backends are waiting on a lock,
 * then resolves with the started calls' results. Same technique as
 * `settle-atomicity.integration.test.ts`'s `withOrderRowHeld` — forces the
 * two reversal calls to genuinely overlap at the lock, rather than relying
 * on `Promise.all` scheduling them close enough by luck (RELIABILITY's
 * note on the earlier version of this test).
 */
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
async function withOrderRowHeld<T>(orderId: string, waiters: number, start: () => Promise<T>[]): Promise<T[]> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let locked!: () => void;
  const lockTaken = new Promise<void>((resolve) => (locked = resolve));

  const holder = db().transaction(async (tx: Tx) => {
    await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId)).for("update");
    locked();
    await released;
  });
  await lockTaken;

  const calls = start();
  try {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const [row] = await db().execute<{ waiting: number }>(
        sql`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
      );
      if ((row?.waiting ?? 0) >= waiters) break;
      if (Date.now() > deadline) throw new Error(`test: only ${row?.waiting ?? 0} of ${waiters} calls reached the order-row lock`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    release();
    await holder;
  }
  return Promise.all(calls);
}

/** A minimal, directly-inserted order row — reversePointsForOrder only ever reads pointsEarned/customerId off it. */
async function createTestOrderWithPointsEarned(org: TestOrg, customerId: string, pointsEarned: number) {
  const [order] = await db()
    .insert(orders)
    .values({
      orgId: org.orgId,
      locationId: org.locationId,
      orderNumber: `TEST-${randomUUID().slice(0, 8)}`,
      businessDate: new Date().toISOString().slice(0, 10),
      status: "PAID",
      channel: "DINE_IN",
      fulfilment: "DINE_IN",
      customerId,
      grandTotal: fromRupees("300"),
      pointsEarned,
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

describe("reversePointsForOrder", () => {
  let org: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg();
  });

  afterAll(async () => {
    await deleteTestOrg(org.orgId);
  });

  it("reverses the full amount when the customer still has it all", async () => {
    const customer = await createTestCustomer(org.orgId);
    await seedLoyaltyAccount(org.orgId, customer.id, 50);
    const orderId = await createTestOrderWithPointsEarned(org, customer.id, 15);

    await reversePointsForOrder({ orgId: org.orgId, orderId, reason: "test refund" });

    const [account] = await db().select({ pointsBalance: loyaltyAccounts.pointsBalance }).from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, customer.id));
    expect(account?.pointsBalance).toBe(35); // 50 - 15

    const [txn] = await db()
      .select()
      .from(loyaltyTransactions)
      .where(and(eq(loyaltyTransactions.orgId, org.orgId), eq(loyaltyTransactions.orderId, orderId), like(loyaltyTransactions.reason, "Reversed —%")));
    expect(txn?.points).toBe(-15);
  });

  it("Priority 5's actual design point: floors at what remains, never goes negative, when the customer already spent some on a different order", async () => {
    const customer = await createTestCustomer(org.orgId);
    await seedLoyaltyAccount(org.orgId, customer.id, 8); // customer already spent down to 8
    const orderId = await createTestOrderWithPointsEarned(org, customer.id, 15); // this order originally earned 15

    await reversePointsForOrder({ orgId: org.orgId, orderId, reason: "test refund after partial spend" });

    const [account] = await db().select({ pointsBalance: loyaltyAccounts.pointsBalance }).from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, customer.id));
    expect(account?.pointsBalance).toBe(0); // floored, not -7

    const [txn] = await db()
      .select()
      .from(loyaltyTransactions)
      .where(and(eq(loyaltyTransactions.orgId, org.orgId), eq(loyaltyTransactions.orderId, orderId), like(loyaltyTransactions.reason, "Reversed —%")));
    expect(txn?.points).toBe(-8); // the ledger records what was ACTUALLY reclaimed, not the original 15
  });

  it("is idempotent — a retried reversal for the same order never claws back twice", async () => {
    const customer = await createTestCustomer(org.orgId);
    await seedLoyaltyAccount(org.orgId, customer.id, 100);
    const orderId = await createTestOrderWithPointsEarned(org, customer.id, 20);

    await reversePointsForOrder({ orgId: org.orgId, orderId, reason: "first attempt" });
    await reversePointsForOrder({ orgId: org.orgId, orderId, reason: "retried attempt" });

    const [account] = await db().select({ pointsBalance: loyaltyAccounts.pointsBalance }).from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, customer.id));
    expect(account?.pointsBalance).toBe(80); // 100 - 20, once — not 60

    const reversalRows = await db()
      .select()
      .from(loyaltyTransactions)
      .where(and(eq(loyaltyTransactions.orgId, org.orgId), eq(loyaltyTransactions.orderId, orderId), like(loyaltyTransactions.reason, "Reversed —%")));
    expect(reversalRows).toHaveLength(1);
  });

  it("loy-1: two concurrent reversals of the same order claw back exactly once, with exactly one ledger row", async () => {
    const customer = await createTestCustomer(org.orgId);
    await seedLoyaltyAccount(org.orgId, customer.id, 100);
    const orderId = await createTestOrderWithPointsEarned(org, customer.id, 20);

    await warmPool();

    await withOrderRowHeld(orderId, 2, () => [
      reversePointsForOrder({ orgId: org.orgId, orderId, reason: "concurrent caller A" }),
      reversePointsForOrder({ orgId: org.orgId, orderId, reason: "concurrent caller B" }),
    ]);

    const [account] = await db().select({ pointsBalance: loyaltyAccounts.pointsBalance }).from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, customer.id));
    expect(account?.pointsBalance).toBe(80); // 100 - 20, once — not 60

    const reversalRows = await db()
      .select()
      .from(loyaltyTransactions)
      .where(and(eq(loyaltyTransactions.orgId, org.orgId), eq(loyaltyTransactions.orderId, orderId), like(loyaltyTransactions.reason, "Reversed —%")));
    expect(reversalRows).toHaveLength(1);
  });

  it("does nothing for an order that never earned points", async () => {
    const customer = await createTestCustomer(org.orgId);
    await seedLoyaltyAccount(org.orgId, customer.id, 30);
    const orderId = await createTestOrderWithPointsEarned(org, customer.id, 0);

    await reversePointsForOrder({ orgId: org.orgId, orderId, reason: "no points earned" });

    const [account] = await db().select({ pointsBalance: loyaltyAccounts.pointsBalance }).from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, customer.id));
    expect(account?.pointsBalance).toBe(30); // untouched
  });
});
