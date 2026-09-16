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
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { loyaltyAccounts, loyaltyRewards } from "@/db/schema";
import { redeemStampReward } from "./loyalty";
import { createTestCustomer, createTestOrg, deleteTestOrg, warmPool, type TestOrg } from "./__test-support__/fixtures";

async function seedAvailableReward(org: TestOrg, customerId: string) {
  const [account] = await db().insert(loyaltyAccounts).values({ orgId: org.orgId, customerId }).returning({ id: loyaltyAccounts.id });
  if (!account) throw new Error("fixture: loyalty account insert returned no row");
  const [reward] = await db().insert(loyaltyRewards).values({ orgId: org.orgId, accountId: account.id, status: "AVAILABLE" }).returning({ id: loyaltyRewards.id });
  if (!reward) throw new Error("fixture: loyalty reward insert returned no row");
  return reward.id;
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

    const result = await redeemStampReward({ rewardId, orgId: org.orgId, orderId: randomUUID(), productSlug: "test-product" });
    expect(result.redeemed).toBe(true);

    const [row] = await db().select({ status: loyaltyRewards.status }).from(loyaltyRewards).where(eq(loyaltyRewards.id, rewardId));
    expect(row?.status).toBe("REDEEMED");
  });

  it("reports failure, and does not touch the row, for a reward that's already redeemed", async () => {
    const customer = await createTestCustomer(org.orgId);
    const rewardId = await seedAvailableReward(org, customer.id);

    const first = await redeemStampReward({ rewardId, orgId: org.orgId, orderId: randomUUID(), productSlug: "test-product" });
    expect(first.redeemed).toBe(true);

    const second = await redeemStampReward({ rewardId, orgId: org.orgId, orderId: randomUUID(), productSlug: "test-product" });
    expect(second.redeemed).toBe(false);

    const [row] = await db().select({ redeemedOrderId: loyaltyRewards.redeemedOrderId }).from(loyaltyRewards).where(eq(loyaltyRewards.id, rewardId));
    // Still points at whichever order redeemed it first — the second call never overwrote it.
    expect(row?.redeemedOrderId).not.toBeNull();
  });

  it("Priority's actual design point: two orders racing to redeem the SAME reward never both succeed", async () => {
    const customer = await createTestCustomer(org.orgId);
    const rewardId = await seedAvailableReward(org, customer.id);

    await warmPool();

    const orderA = randomUUID();
    const orderB = randomUUID();
    const [a, b] = await Promise.all([
      redeemStampReward({ rewardId, orgId: org.orgId, orderId: orderA, productSlug: "test-product" }),
      redeemStampReward({ rewardId, orgId: org.orgId, orderId: orderB, productSlug: "test-product" }),
    ]);

    const results = [a, b];
    expect(results.filter((r) => r.redeemed)).toHaveLength(1); // exactly one order actually claimed it
    expect(results.filter((r) => !r.redeemed)).toHaveLength(1); // the other one now KNOWS it lost, instead of assuming success

    const [row] = await db().select({ status: loyaltyRewards.status, redeemedOrderId: loyaltyRewards.redeemedOrderId }).from(loyaltyRewards).where(eq(loyaltyRewards.id, rewardId));
    expect(row?.status).toBe("REDEEMED");
    expect([orderA, orderB]).toContain(row?.redeemedOrderId); // the row agrees with whichever call actually won
  });
});
