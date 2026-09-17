/**
 * redeemStampReward against a real database — this priority's fix.
 *
 * The bug: `getAvailableStampReward` only ever reads the oldest AVAILABLE
 * reward — it never claims one. Two unpaid orders from the same customer
 * (two tabs, or a cash/COD order left open while a second is placed) can
 * both capture the same reward id at checkout. The DB-level
 * `status = 'AVAILABLE'` guard already stopped both from ever flipping to
 * REDEEMED, but the caller used to ignore whether its own call was the one
 * that actually landed — silently treating a lost race as a success, with
 * no record anywhere that a free item went out unmatched to a redemption.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { loyaltyAccounts, loyaltyRewards, loyaltyStampEvents, orders } from "@/db/schema";
import { redeemStampRewardInTx, reverseStampForOrder } from "./loyalty";
import { createTestCustomer, createTestOrg, deleteTestOrg, warmPool, type TestOrg } from "./__test-support__/fixtures";

async function seedAvailableReward(org: TestOrg, customerId: string) {
  const [account] = await db().insert(loyaltyAccounts).values({ orgId: org.orgId, customerId }).returning({ id: loyaltyAccounts.id });
  if (!account) throw new Error("fixture: loyalty account insert returned no row");
  const [reward] = await db().insert(loyaltyRewards).values({ orgId: org.orgId, accountId: account.id, status: "AVAILABLE" }).returning({ id: loyaltyRewards.id });
  if (!reward) throw new Error("fixture: loyalty reward insert returned no row");
  return reward.id;
}

/**
 * A minimal, directly-inserted order row. `reverseStampForOrder` now locks
 * the order row first (loy-1b), so every order id it's called with here
 * needs a real backing row — `loyalty_stamp_events.order_id` itself carries
 * no foreign key, but the function's own lock requires the order to exist.
 */
async function createTestOrder(org: TestOrg) {
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
    })
    .returning({ id: orders.id });
  if (!order) throw new Error("fixture: order insert returned no row");
  return order.id;
}

/**
 * Runs `start()` while a separate transaction holds `lock`'s row FOR
 * UPDATE; releases it only once `waiters` backends are waiting on a lock,
 * then resolves with the started calls' results. Same technique as
 * `settle-atomicity.integration.test.ts`'s `withOrderRowHeld`, generalised
 * to whatever row the caller wants held — here, an order row (same-order
 * races) or a loyalty account row (cross-order races that only collide
 * inside `settleAccount`) — so overlap is forced rather than hoped for.
 */
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
async function withRowHeld<T>(lock: (tx: Tx) => Promise<unknown>, waiters: number, start: () => Promise<T>[]): Promise<T[]> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let locked!: () => void;
  const lockTaken = new Promise<void>((resolve) => (locked = resolve));

  const holder = db().transaction(async (tx) => {
    await lock(tx);
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
      if (Date.now() > deadline) throw new Error(`test: only ${row?.waiting ?? 0} of ${waiters} calls reached the row lock`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    release();
    await holder;
  }
  return Promise.all(calls);
}

describe("redeemStampReward", () => {
  let org: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg();
  });

  afterAll(async () => {
    await deleteTestOrg(org.orgId);
  });

  it("redeems an available reward and reports success", async () => {
    const customer = await createTestCustomer(org.orgId);
    const rewardId = await seedAvailableReward(org, customer.id);

    const result = await db().transaction((tx) => redeemStampRewardInTx(tx, { rewardId, orgId: org.orgId, orderId: randomUUID(), productSlug: "test-product" }));
    expect(result.redeemed).toBe(true);

    const [row] = await db().select({ status: loyaltyRewards.status }).from(loyaltyRewards).where(eq(loyaltyRewards.id, rewardId));
    expect(row?.status).toBe("REDEEMED");
  });

  it("reports failure, and does not touch the row, for a reward that's already redeemed", async () => {
    const customer = await createTestCustomer(org.orgId);
    const rewardId = await seedAvailableReward(org, customer.id);

    const first = await db().transaction((tx) => redeemStampRewardInTx(tx, { rewardId, orgId: org.orgId, orderId: randomUUID(), productSlug: "test-product" }));
    expect(first.redeemed).toBe(true);

    const second = await db().transaction((tx) => redeemStampRewardInTx(tx, { rewardId, orgId: org.orgId, orderId: randomUUID(), productSlug: "test-product" }));
    expect(second.redeemed).toBe(false);

    const [row] = await db().select({ redeemedOrderId: loyaltyRewards.redeemedOrderId }).from(loyaltyRewards).where(eq(loyaltyRewards.id, rewardId));
    // Still points at whichever order redeemed it first — the second call never overwrote it.
    expect(row?.redeemedOrderId).not.toBeNull();
  });

  it("two orders racing to redeem the SAME reward never both succeed", async () => {
    const customer = await createTestCustomer(org.orgId);
    const rewardId = await seedAvailableReward(org, customer.id);

    await warmPool();

    const orderA = randomUUID();
    const orderB = randomUUID();
    const [a, b] = await Promise.all([
      db().transaction((tx) => redeemStampRewardInTx(tx, { rewardId, orgId: org.orgId, orderId: orderA, productSlug: "test-product" })),
      db().transaction((tx) => redeemStampRewardInTx(tx, { rewardId, orgId: org.orgId, orderId: orderB, productSlug: "test-product" })),
    ]);

    const results = [a, b];
    expect(results.filter((r) => r.redeemed)).toHaveLength(1); // exactly one order actually claimed it
    expect(results.filter((r) => !r.redeemed)).toHaveLength(1); // the other one now KNOWS it lost, instead of assuming success

    const [row] = await db().select({ status: loyaltyRewards.status, redeemedOrderId: loyaltyRewards.redeemedOrderId }).from(loyaltyRewards).where(eq(loyaltyRewards.id, rewardId));
    expect(row?.status).toBe("REDEEMED");
    expect([orderA, orderB]).toContain(row?.redeemedOrderId); // the row agrees with whichever call actually won
  });
});

describe("reverseStampForOrder", () => {
  let org: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg();
  });

  afterAll(async () => {
    await deleteTestOrg(org.orgId);
  });

  async function seedAccount(customerId: string) {
    const [account] = await db().insert(loyaltyAccounts).values({ orgId: org.orgId, customerId }).returning({ id: loyaltyAccounts.id });
    if (!account) throw new Error("fixture: loyalty account insert returned no row");
    return account.id;
  }

  it("voids an AVAILABLE reward and hands the stamp back to the pool", async () => {
    const customer = await createTestCustomer(org.orgId);
    const accountId = await seedAccount(customer.id);
    const [reward] = await db().insert(loyaltyRewards).values({ orgId: org.orgId, accountId, status: "AVAILABLE" }).returning({ id: loyaltyRewards.id });
    if (!reward) throw new Error("fixture");
    const orderId = await createTestOrder(org);
    await db().insert(loyaltyStampEvents).values({ orgId: org.orgId, accountId, orderId, rewardId: reward.id });

    await reverseStampForOrder({ orgId: org.orgId, orderId, reason: "test refund" });

    const [row] = await db().select({ status: loyaltyRewards.status }).from(loyaltyRewards).where(eq(loyaltyRewards.id, reward.id));
    expect(row?.status).toBe("REVERSED");
  });

  it("loy-1b: two concurrent reversals of DIFFERENT orders whose combined pooled-back stamps complete a new cycle create exactly one new reward", async () => {
    const customer = await createTestCustomer(org.orgId);
    const accountId = await seedAccount(customer.id);

    // The org's default stampsRequired is 7. Reward A carries 4 events
    // (order A + 3 others); reward B carries 5 (order B + 4 others).
    // Reversing either order ALONE frees fewer than 7 stamps — 3, or 4 —
    // so neither alone completes a cycle. Only the combined 3 + 4 = 7
    // does, and that must produce exactly one new reward, not two (the
    // POS-ORDERS-reported bug: two concurrent `settleAccount` runs each
    // reading the same "not quite enough yet" pool and each inserting
    // one) and not zero (each call, missing the other's contribution,
    // wrongly deciding on its own that nothing unlocked).
    const [rewardA] = await db().insert(loyaltyRewards).values({ orgId: org.orgId, accountId, status: "AVAILABLE" }).returning({ id: loyaltyRewards.id });
    const [rewardB] = await db().insert(loyaltyRewards).values({ orgId: org.orgId, accountId, status: "AVAILABLE" }).returning({ id: loyaltyRewards.id });
    if (!rewardA || !rewardB) throw new Error("fixture");

    const orderA = await createTestOrder(org);
    const orderB = await createTestOrder(org);
    await db().insert(loyaltyStampEvents).values({ orgId: org.orgId, accountId, orderId: orderA, rewardId: rewardA.id });
    for (let i = 0; i < 3; i++) {
      await db().insert(loyaltyStampEvents).values({ orgId: org.orgId, accountId, orderId: randomUUID(), rewardId: rewardA.id });
    }
    await db().insert(loyaltyStampEvents).values({ orgId: org.orgId, accountId, orderId: orderB, rewardId: rewardB.id });
    for (let i = 0; i < 4; i++) {
      await db().insert(loyaltyStampEvents).values({ orgId: org.orgId, accountId, orderId: randomUUID(), rewardId: rewardB.id });
    }

    await warmPool();

    // The account row is the actual point of contention: both reversals
    // lock their own, different order rows without conflict, and only
    // collide inside `settleAccount`'s account-row lock. Holding that row
    // externally until both calls are genuinely blocked on it — rather
    // than hoping `Promise.all` schedules them close enough — is the
    // deterministic-overlap barrier RELIABILITY asked for.
    await withRowHeld(
      async (tx) => tx.select({ id: loyaltyAccounts.id }).from(loyaltyAccounts).where(eq(loyaltyAccounts.id, accountId)).for("update"),
      2,
      () => [
        reverseStampForOrder({ orgId: org.orgId, orderId: orderA, reason: "concurrent refund A" }),
        reverseStampForOrder({ orgId: org.orgId, orderId: orderB, reason: "concurrent refund B" }),
      ],
    );

    const [rowA] = await db().select({ status: loyaltyRewards.status }).from(loyaltyRewards).where(eq(loyaltyRewards.id, rewardA.id));
    const [rowB] = await db().select({ status: loyaltyRewards.status }).from(loyaltyRewards).where(eq(loyaltyRewards.id, rewardB.id));
    expect(rowA?.status).toBe("REVERSED");
    expect(rowB?.status).toBe("REVERSED");

    const allRewards = await db().select({ id: loyaltyRewards.id }).from(loyaltyRewards).where(eq(loyaltyRewards.accountId, accountId));
    const newRewards = allRewards.filter((r) => r.id !== rewardA.id && r.id !== rewardB.id);
    expect(newRewards).toHaveLength(1); // exactly one new reward from the combined 7 pooled stamps

    const [account] = await db().select({ stampCount: loyaltyAccounts.stampCount }).from(loyaltyAccounts).where(eq(loyaltyAccounts.id, accountId));
    expect(account?.stampCount).toBe(0); // all 7 pooled stamps consumed into the one new reward, none left dangling
  });

  it("loy-1b: two concurrent reversals of the SAME order reverse the reward exactly once, deterministically", async () => {
    const customer = await createTestCustomer(org.orgId);
    const accountId = await seedAccount(customer.id);
    const [reward] = await db().insert(loyaltyRewards).values({ orgId: org.orgId, accountId, status: "AVAILABLE" }).returning({ id: loyaltyRewards.id });
    if (!reward) throw new Error("fixture");
    const orderId = await createTestOrder(org);
    await db().insert(loyaltyStampEvents).values({ orgId: org.orgId, accountId, orderId, rewardId: reward.id });
    await db().insert(loyaltyStampEvents).values({ orgId: org.orgId, accountId, orderId: randomUUID(), rewardId: reward.id });

    await warmPool();

    // Both callers race for the SAME order row, so holding that row
    // externally — rather than the account row — is what forces the
    // genuine overlap here.
    await withRowHeld(
      async (tx) => tx.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId)).for("update"),
      2,
      () => [
        reverseStampForOrder({ orgId: org.orgId, orderId, reason: "concurrent caller A" }),
        reverseStampForOrder({ orgId: org.orgId, orderId, reason: "concurrent caller B" }),
      ],
    );

    const [row] = await db().select({ status: loyaltyRewards.status }).from(loyaltyRewards).where(eq(loyaltyRewards.id, reward.id));
    expect(row?.status).toBe("REVERSED");

    const allRewards = await db().select({ id: loyaltyRewards.id }).from(loyaltyRewards).where(eq(loyaltyRewards.accountId, accountId));
    expect(allRewards).toHaveLength(1); // still just the one — no phantom reward from a doubled settleAccount

    const [account] = await db().select({ stampCount: loyaltyAccounts.stampCount }).from(loyaltyAccounts).where(eq(loyaltyAccounts.id, accountId));
    expect(account?.stampCount).toBe(1); // the one pooled-back stamp, counted once
  });

  it("a reversal that reads a reward already redeemed by a different order never touches it", async () => {
    // Deterministic, but — checked by hand — this does NOT distinguish the
    // pre-fix code from the fix: with the redemption fully committed
    // *before* the reversal ever starts, the old code's plain JS
    // `reward.status === "AVAILABLE"` check already read the true,
    // up-to-date state and correctly skipped the update on its own. The
    // bug this priority closes was specifically a TORN read — the
    // reversal's read landing *before* the redemption's write, with the
    // redemption committing in the gap before the reversal's own write —
    // which by definition requires real, interleaved concurrency to
    // reproduce; there is no fully sequential setup that exercises it.
    // This test still earns its place as a basic correctness check (the
    // guard must never misfire even in the easy, non-racing case, and it
    // proves the "give it back to the pool" step is skipped too), not as
    // proof the race itself is closed — that's what the test above
    // attempts, with its own honestly-stated limits.
    const customer = await createTestCustomer(org.orgId);
    const accountId = await seedAccount(customer.id);
    const [reward] = await db().insert(loyaltyRewards).values({ orgId: org.orgId, accountId, status: "AVAILABLE" }).returning({ id: loyaltyRewards.id });
    if (!reward) throw new Error("fixture");
    const orderA = await createTestOrder(org); // the one about to be refunded
    const orderB = randomUUID(); // the one that already, genuinely redeemed this reward
    await db().insert(loyaltyStampEvents).values({ orgId: org.orgId, accountId, orderId: orderA, rewardId: reward.id });
    // A second, unrelated unconsumed stamp on the same account+reward, to
    // prove the "give it back to the pool" step is correctly skipped too —
    // not just the status write.
    await db().insert(loyaltyStampEvents).values({ orgId: org.orgId, accountId, orderId: randomUUID(), rewardId: reward.id });

    const redeemed = await db().transaction((tx) => redeemStampRewardInTx(tx, { rewardId: reward.id, orgId: org.orgId, orderId: orderB, productSlug: "test-product" }));
    expect(redeemed.redeemed).toBe(true);

    await reverseStampForOrder({ orgId: org.orgId, orderId: orderA, reason: "test refund, too late" });

    const [row] = await db()
      .select({ status: loyaltyRewards.status, redeemedOrderId: loyaltyRewards.redeemedOrderId, redeemedAt: loyaltyRewards.redeemedAt, reversedAt: loyaltyRewards.reversedAt })
      .from(loyaltyRewards)
      .where(eq(loyaltyRewards.id, reward.id));
    expect(row?.status).toBe("REDEEMED"); // untouched by the refund that lost the race
    expect(row?.redeemedOrderId).toBe(orderB);
    expect(row?.redeemedAt).not.toBeNull();
    expect(row?.reversedAt).toBeNull(); // never stamped REVERSED over a real redemption

    // The other order's stamp was never handed back to the pool either —
    // this reward is still legitimately spoken for by order B.
    const untouched = await db().select({ rewardId: loyaltyStampEvents.rewardId }).from(loyaltyStampEvents).where(eq(loyaltyStampEvents.rewardId, reward.id));
    expect(untouched.length).toBeGreaterThan(0);
  });

  it("a refund's reversal never corrupts a reward a DIFFERENT order genuinely redeemed at the same moment", async () => {
    // The precondition this whole bug depends on: two different orders
    // sharing one reward id (redeemStampReward's own doc comment explains
    // how — getAvailableStampReward only ever reads). Order A is about to
    // be refunded; order B is, at the very same moment, actually settling
    // and redeeming that same reward.
    //
    // Honest limitation: the actual bug required a specific interleaving —
    // reverseStampForOrder's READ of the reward landing before
    // redeemStampReward's write, and its OWN write landing after. Verified
    // by hand against the pre-fix code that this is hard to force locally:
    // reverseStampForOrder does an earlier, unrelated round trip of its own
    // (the stamp event's reversedAt) before it ever touches the reward, so
    // redeemStampReward's single fast UPDATE usually lands well before
    // reverseStampForOrder's reward read even fires on a near-zero-latency
    // local database — 25 repeated trials against the *reverted*, buggy
    // code never once reproduced the corruption. This loop is kept anyway,
    // both because it still verifies the fixed code behaves correctly
    // under real concurrent load (not a no-op assertion), and because a
    // production database — real network latency, real connection
    // contention — has a wider window than this one does; the fix's
    // correctness rests on the same atomic-WHERE-guard pattern already
    // proven, by an actual revert-and-fail test, in every sibling fix this
    // priority followed (refundPayment, spendPointsForOrder,
    // claimPromotionUse, redeemStampReward itself just above), not on this
    // loop catching the exact race by chance.
    const customer = await createTestCustomer(org.orgId);
    const accountId = await seedAccount(customer.id);

    for (let trial = 0; trial < 25; trial++) {
      const [reward] = await db().insert(loyaltyRewards).values({ orgId: org.orgId, accountId, status: "AVAILABLE" }).returning({ id: loyaltyRewards.id });
      if (!reward) throw new Error("fixture");
      const orderA = await createTestOrder(org);
      const orderB = randomUUID();
      await db().insert(loyaltyStampEvents).values({ orgId: org.orgId, accountId, orderId: orderA, rewardId: reward.id });

      await Promise.all([
        reverseStampForOrder({ orgId: org.orgId, orderId: orderA, reason: "test refund" }),
        db().transaction((tx) => redeemStampRewardInTx(tx, { rewardId: reward.id, orgId: org.orgId, orderId: orderB, productSlug: "test-product" })),
      ]);

      const [row] = await db()
        .select({ status: loyaltyRewards.status, redeemedOrderId: loyaltyRewards.redeemedOrderId, redeemedAt: loyaltyRewards.redeemedAt, reversedAt: loyaltyRewards.reversedAt })
        .from(loyaltyRewards)
        .where(eq(loyaltyRewards.id, reward.id));

      // Exactly one consistent outcome, never a row that looks reversed AND
      // redeemed at once — the actual corruption this fix closes.
      const looksRedeemed = row?.status === "REDEEMED" && row.redeemedOrderId === orderB && row.redeemedAt !== null && row.reversedAt === null;
      const looksReversed = row?.status === "REVERSED" && row.redeemedOrderId === null && row.redeemedAt === null && row.reversedAt !== null;
      expect(looksRedeemed || looksReversed, `trial ${trial}: got status=${row?.status} redeemedOrderId=${row?.redeemedOrderId} redeemedAt=${row?.redeemedAt} reversedAt=${row?.reversedAt}`).toBe(true);
    }
  });
});
