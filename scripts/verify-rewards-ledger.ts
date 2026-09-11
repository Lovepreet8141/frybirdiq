/**
 * Integration check for the FRYBIRD REWARDS ledger, against the real
 * database — this codebase has no DB test harness (vitest only covers pure
 * src/lib and src/domain, per vitest.config.mts), so this is the closest
 * thing to an automated test the idempotency, unlock, redemption and
 * refund-reversal behaviour has. The pure decision rules (the ₹200/₹250/7
 * boundaries) have full coverage in src/lib/loyalty/stamps.test.ts; this
 * checks the parts only a real database can prove — a unique constraint
 * actually rejecting a duplicate insert, a transaction actually landing.
 *
 *     pnpm rewards:verify
 *
 * Creates its own throwaway customer and orders under the real FRYBIRD org,
 * exercises the repository functions for real, asserts on the results, and
 * deletes everything it made whether it passes or fails. Not part of
 * `pnpm test` — run by hand after touching src/lib/repositories/loyalty.ts.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../src/db/connection";
import { customers, loyaltyAccounts, loyaltyRewards, loyaltyStampEvents, locations, orders, organizations } from "../src/db/schema";
import { fromRupees } from "../src/lib/money";
import { awardStampForOrder, getAvailableStampReward, getStampAccountState, redeemStampReward, reverseStampForOrder, qualifyingStampSpend } from "../src/lib/repositories/loyalty";
import type { StampConfig } from "../src/lib/loyalty/stamps";

const CONFIG: StampConfig = {
  enabled: true,
  stampsRequired: 7,
  minOrderValue: fromRupees("200"),
  maxRewardValue: fromRupees("250"),
};

let ok = true;
function assert(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) ok = false;
}

async function main() {
  const database = db();
  const [orgRow] = await database.select().from(organizations).where(eq(organizations.slug, "frybird")).limit(1);
  if (!orgRow) throw new Error("No FRYBIRD organization.");
  const org = orgRow;

  const [locationRow] = await database.select().from(locations).where(eq(locations.orgId, org.id)).limit(1);
  if (!locationRow) throw new Error("No location.");
  const location = locationRow;

  const [customerRow] = await database
    .insert(customers)
    .values({ orgId: org.id, name: "Ledger Verification", phone: "9000000000" })
    .returning();
  if (!customerRow) throw new Error("Could not create test customer.");
  const customer = customerRow;

  const orderIds: string[] = [];
  async function makeOrder(): Promise<string> {
    const [order] = await database
      .insert(orders)
      .values({
        orgId: org.id,
        locationId: location.id,
        orderNumber: `TEST-${randomUUID().slice(0, 8)}`,
        businessDate: new Date().toISOString().slice(0, 10),
        status: "PAID",
        channel: "ONLINE",
        fulfilment: "TAKEAWAY",
        customerId: customer.id,
        grandTotal: fromRupees("300"),
      })
      .returning();
    if (!order) throw new Error("Could not create test order.");
    orderIds.push(order.id);
    return order.id;
  }

  try {
    console.log("\n--- Qualifying spend boundary ---");
    // Not asserted through the DB — already covered exhaustively by
    // src/lib/loyalty/stamps.test.ts. Re-derived here only to feed the award call.
    const qualifying300 = qualifyingStampSpend(fromRupees("300"), fromRupees("0"));

    console.log("\n--- Duplicate payment webhook: same order, awarded twice ---");
    const order1 = await makeOrder();
    const first = await awardStampForOrder({ orgId: org.id, customerId: customer.id, orderId: order1, qualifyingSpend: qualifying300, config: CONFIG });
    const second = await awardStampForOrder({ orgId: org.id, customerId: customer.id, orderId: order1, qualifyingSpend: qualifying300, config: CONFIG });
    assert("first call awards a stamp", first.awarded === true);
    assert("retried call (same order id) does not award a second stamp", second.awarded === false);

    const eventsAfterRetry = await database.select().from(loyaltyStampEvents).where(eq(loyaltyStampEvents.orderId, order1));
    assert("exactly one ledger row exists for that order despite two calls", eventsAfterRetry.length === 1);

    console.log("\n--- Cancelled order: never even attempted, but verify a below-threshold spend earns nothing ---");
    const orderLow = await makeOrder();
    const lowResult = await awardStampForOrder({
      orgId: org.id,
      customerId: customer.id,
      orderId: orderLow,
      qualifyingSpend: fromRupees("200"), // exactly the threshold — must NOT qualify
      config: CONFIG,
    });
    assert("₹200 exactly does not earn a stamp", lowResult.awarded === false);

    console.log("\n--- Unlocking a reward: six more qualifying orders (seven total including order1) ---");
    for (let i = 0; i < 5; i++) {
      const id = await makeOrder();
      const result = await awardStampForOrder({ orgId: org.id, customerId: customer.id, orderId: id, qualifyingSpend: qualifying300, config: CONFIG });
      assert(`stamp ${i + 2} awarded`, result.awarded === true);
    }
    let state = await getStampAccountState(customer.id, org.id);
    assert("six stamps banked, no reward yet", state?.stampCount === 6 && state.availableRewards.length === 0);

    const order7 = await makeOrder();
    const seventh = await awardStampForOrder({ orgId: org.id, customerId: customer.id, orderId: order7, qualifyingSpend: qualifying300, config: CONFIG });
    assert("seventh stamp awarded", seventh.awarded === true);

    state = await getStampAccountState(customer.id, org.id);
    assert("count resets to 0 and a reward unlocks at seven", state?.stampCount === 0 && state.availableRewards.length === 1);

    console.log("\n--- Redemption ---");
    const available = await getAvailableStampReward(customer.id, org.id);
    assert("an available reward can be looked up", available !== null);
    const redemptionOrder = await makeOrder();
    if (available) {
      await redeemStampReward({ rewardId: available.id, orgId: org.id, orderId: redemptionOrder, productSlug: "test-product" });
    }
    const [rewardRow] = await database.select().from(loyaltyRewards).where(eq(loyaltyRewards.id, available?.id ?? "")).limit(1);
    assert("reward is marked REDEEMED", rewardRow?.status === "REDEEMED");
    assert("no longer shows as available", (await getAvailableStampReward(customer.id, org.id)) === null);

    console.log("\n--- Refund reversal: void a contributing order after the reward is already redeemed ---");
    // order1 contributed to the (now redeemed) reward. Refunding it should
    // reverse ITS stamp but must NOT try to claw back the already-given item.
    await reverseStampForOrder({ orgId: org.id, orderId: order1, reason: "test refund" });
    const [reversedEvent] = await database.select().from(loyaltyStampEvents).where(eq(loyaltyStampEvents.orderId, order1)).limit(1);
    assert("order1's stamp event is marked reversed", reversedEvent?.reversedAt !== null);
    const [rewardAfterRefund] = await database.select().from(loyaltyRewards).where(eq(loyaltyRewards.id, available?.id ?? "")).limit(1);
    assert("the already-redeemed reward is left alone, not clawed back", rewardAfterRefund?.status === "REDEEMED");

    console.log("\n--- Refund reversal: void a contributing order while the reward is still AVAILABLE ---");
    // Fresh cycle: 7 more orders, then refund one before redeeming.
    const secondCycleOrders: string[] = [];
    for (let i = 0; i < 7; i++) {
      const id = await makeOrder();
      secondCycleOrders.push(id);
      await awardStampForOrder({ orgId: org.id, customerId: customer.id, orderId: id, qualifyingSpend: qualifying300, config: CONFIG });
    }
    state = await getStampAccountState(customer.id, org.id);
    assert("second reward unlocked", state?.availableRewards.length === 1);
    const secondReward = state?.availableRewards[0];

    const orderToRefund = secondCycleOrders[0]!;
    await reverseStampForOrder({ orgId: org.id, orderId: orderToRefund, reason: "test refund before redemption" });

    const [secondRewardRow] = await database.select().from(loyaltyRewards).where(eq(loyaltyRewards.id, secondReward?.id ?? "")).limit(1);
    assert("the still-available reward is reversed when a contributing order refunds", secondRewardRow?.status === "REVERSED");

    state = await getStampAccountState(customer.id, org.id);
    assert("the other six stamps are handed back to the pool, not lost", state?.stampCount === 6);
  } finally {
    console.log("\n--- Cleanup ---");
    await database.delete(loyaltyStampEvents).where(eq(loyaltyStampEvents.accountId, (await database.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, customer.id)).limit(1))[0]?.id ?? ""));
    await database.delete(loyaltyRewards).where(eq(loyaltyRewards.accountId, (await database.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, customer.id)).limit(1))[0]?.id ?? ""));
    await database.delete(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, customer.id));
    for (const id of orderIds) await database.delete(orders).where(eq(orders.id, id));
    await database.delete(customers).where(eq(customers.id, customer.id));
    console.log("Test data removed.");
  }

  console.log(ok ? "\nALL PASS" : "\nSOME FAILED");
  if (!ok) process.exitCode = 1;
}

main()
  .then(async () => {
    await closeDb();
  })
  .catch(async (error) => {
    console.error(error);
    await closeDb();
    process.exitCode = 1;
  });
