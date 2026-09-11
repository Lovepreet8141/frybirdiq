import "server-only";

/**
 * FRYBIRD REWARDS — the ledger.
 *
 * Three things happen here, all server-side, all validated against the
 * database rather than trusted from a caller: awarding a stamp when a
 * qualifying order is paid, unlocking a reward the moment enough unconsumed
 * stamps exist, and reversing a stamp when its order is refunded. Nothing
 * here trusts a count sent by the browser — see `src/lib/cart` for where a
 * reward is priced, which reads an account's actual ledger state, never a
 * number the client claims to have.
 *
 * Like the rest of the write path, this is untested against a live database
 * beyond the manual verification in this session's deploy — there is no
 * fixture database in CI yet. It is written against the schema and the
 * pure rules in `src/lib/loyalty/stamps.ts`, which do have full coverage.
 */

import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { loyaltyAccounts, loyaltyRewards, loyaltyStampEvents, organizations } from "@/db/schema";
import { type StampConfig, isRewardUnlocked, qualifiesForStamp } from "@/lib/loyalty/stamps";
import { type Paise, ZERO, paise, subtract } from "@/lib/money";

export interface StampAccountState {
  readonly accountId: string;
  /** Unconsumed stamps toward the next reward. */
  readonly stampCount: number;
  /** Rewards sitting ready to redeem, oldest first. */
  readonly availableRewards: readonly { readonly id: string; readonly unlockedAt: Date }[];
}

async function findOrCreateAccount(orgId: string, customerId: string): Promise<string> {
  const database = db();
  const [existing] = await database
    .select({ id: loyaltyAccounts.id })
    .from(loyaltyAccounts)
    .where(eq(loyaltyAccounts.customerId, customerId))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await database
    .insert(loyaltyAccounts)
    .values({ orgId, customerId })
    .onConflictDoNothing({ target: loyaltyAccounts.customerId })
    .returning({ id: loyaltyAccounts.id });
  if (created) return created.id;

  // Lost the race to create it — read what the other writer just made.
  const [row] = await database
    .select({ id: loyaltyAccounts.id })
    .from(loyaltyAccounts)
    .where(eq(loyaltyAccounts.customerId, customerId))
    .limit(1);
  if (!row) throw new Error("loyalty: could not resolve an account for this customer");
  return row.id;
}

/**
 * Groups unconsumed stamps into rewards and writes the resulting count.
 *
 * Called after every ledger change — an award or a reversal — rather than
 * only after an award, because giving stamps back to a reversed reward's
 * other orders can itself complete a fresh cycle. A `while` rather than an
 * `if`: a reversal can hand back more than one cycle's worth at once.
 */
async function settleAccount(accountId: string, orgId: string, config: StampConfig): Promise<number> {
  const database = db();

  for (;;) {
    const unconsumed = await database
      .select({ id: loyaltyStampEvents.id })
      .from(loyaltyStampEvents)
      .where(
        and(
          eq(loyaltyStampEvents.accountId, accountId),
          isNull(loyaltyStampEvents.rewardId),
          isNull(loyaltyStampEvents.reversedAt),
        ),
      )
      .orderBy(asc(loyaltyStampEvents.createdAt));

    if (!isRewardUnlocked(unconsumed.length, config)) {
      await database.update(loyaltyAccounts).set({ stampCount: unconsumed.length, updatedAt: new Date() }).where(eq(loyaltyAccounts.id, accountId));
      return unconsumed.length;
    }

    // Oldest `stampsRequired` unconsumed stamps form this cycle. Any extra
    // stay unconsumed and roll into whatever unlocks next.
    const forThisReward = unconsumed.slice(0, config.stampsRequired);

    const [reward] = await database.insert(loyaltyRewards).values({ orgId, accountId }).returning({ id: loyaltyRewards.id });
    if (!reward) throw new Error("loyalty: could not create a reward row");

    for (const event of forThisReward) {
      await database.update(loyaltyStampEvents).set({ rewardId: reward.id, updatedAt: new Date() }).where(eq(loyaltyStampEvents.id, event.id));
    }
    // Loop again — a reversal can hand back enough stamps to complete more
    // than one cycle in a single settlement.
  }
}

/**
 * Awards a stamp for a paid, qualifying order.
 *
 * Idempotent on `orderId`: a payment webhook or a retried capture calling
 * this twice for the same order inserts once and no-ops the second time,
 * because `loyalty_stamp_events.order_id` is unique. Callers do not need
 * their own idempotency key for this specifically — the ledger enforces it.
 *
 * `qualifyingSpend` is the order's own figure, computed by the caller from
 * columns already on the order row — this function trusts the database, not
 * the browser, because there is nothing here the browser ever sent.
 */
export async function awardStampForOrder(input: {
  orgId: string;
  customerId: string;
  orderId: string;
  qualifyingSpend: Paise;
  config: StampConfig;
}): Promise<{ awarded: boolean }> {
  if (!qualifiesForStamp(input.qualifyingSpend, input.config)) return { awarded: false };

  const accountId = await findOrCreateAccount(input.orgId, input.customerId);

  const [inserted] = await db()
    .insert(loyaltyStampEvents)
    .values({ orgId: input.orgId, accountId, orderId: input.orderId })
    .onConflictDoNothing({ target: loyaltyStampEvents.orderId })
    .returning({ id: loyaltyStampEvents.id });

  if (!inserted) return { awarded: false }; // already stamped — a retry, not a new visit.

  await settleAccount(accountId, input.orgId, input.config);
  return { awarded: true };
}

/**
 * Reverses the stamp a refunded order earned, if it earned one.
 *
 * A stamp already spent into a *redeemed* reward is left alone — the free
 * item already went out, and there is nothing here to claw back. A stamp
 * that only contributed to a reward still sitting *available* voids that
 * reward too, and hands its other stamps back to the pool so the customer
 * does not lose progress on visits that were never refunded.
 */
export async function reverseStampForOrder(input: { orgId: string; orderId: string; reason: string }): Promise<void> {
  const database = db();
  const [event] = await database
    .select()
    .from(loyaltyStampEvents)
    .where(and(eq(loyaltyStampEvents.orderId, input.orderId), eq(loyaltyStampEvents.orgId, input.orgId), isNull(loyaltyStampEvents.reversedAt)))
    .limit(1);

  if (!event) return; // never earned a stamp, or already reversed.

  await database
    .update(loyaltyStampEvents)
    .set({ reversedAt: new Date(), reversalReason: input.reason, updatedAt: new Date() })
    .where(eq(loyaltyStampEvents.id, event.id));

  if (event.rewardId) {
    const [reward] = await database.select().from(loyaltyRewards).where(eq(loyaltyRewards.id, event.rewardId)).limit(1);

    if (reward && reward.status === "AVAILABLE") {
      await database
        .update(loyaltyRewards)
        .set({ status: "REVERSED", reversedAt: new Date(), reversalReason: input.reason, updatedAt: new Date() })
        .where(eq(loyaltyRewards.id, reward.id));

      // Give the reward's other stamps back to the pool — they were paid
      // for and did not stop being real because a different order refunded.
      await database
        .update(loyaltyStampEvents)
        .set({ rewardId: null, updatedAt: new Date() })
        .where(and(eq(loyaltyStampEvents.rewardId, reward.id), isNull(loyaltyStampEvents.reversedAt)));
    }
  }

  const [account] = await database.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.id, event.accountId)).limit(1);
  if (!account) return;

  const [org] = await database.select().from(organizations).where(eq(organizations.id, input.orgId)).limit(1);
  const config: StampConfig = org
    ? {
        enabled: org.stampRewardEnabled,
        stampsRequired: org.stampsRequired,
        minOrderValue: paise(org.stampMinOrderValue),
        maxRewardValue: paise(org.stampMaxRewardValue),
      }
    : { enabled: false, stampsRequired: 7, minOrderValue: ZERO, maxRewardValue: ZERO };

  await settleAccount(event.accountId, input.orgId, config);
}

/** The oldest reward still sitting available for a customer, if any. Redeem oldest first. */
export async function getAvailableStampReward(customerId: string, orgId: string): Promise<{ id: string; unlockedAt: Date } | null> {
  const database = db();
  const [account] = await database.select({ id: loyaltyAccounts.id }).from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, customerId)).limit(1);
  if (!account) return null;

  const [reward] = await database
    .select({ id: loyaltyRewards.id, unlockedAt: loyaltyRewards.unlockedAt })
    .from(loyaltyRewards)
    .where(and(eq(loyaltyRewards.accountId, account.id), eq(loyaltyRewards.orgId, orgId), eq(loyaltyRewards.status, "AVAILABLE")))
    .orderBy(asc(loyaltyRewards.unlockedAt))
    .limit(1);

  return reward ?? null;
}

/** Current stamp progress and how many rewards are waiting, for the account screen. */
export async function getStampAccountState(customerId: string, orgId: string): Promise<StampAccountState | null> {
  const database = db();
  const [account] = await database.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, customerId)).limit(1);
  if (!account) return null;

  const available = await database
    .select({ id: loyaltyRewards.id, unlockedAt: loyaltyRewards.unlockedAt })
    .from(loyaltyRewards)
    .where(and(eq(loyaltyRewards.accountId, account.id), eq(loyaltyRewards.orgId, orgId), eq(loyaltyRewards.status, "AVAILABLE")))
    .orderBy(asc(loyaltyRewards.unlockedAt));

  return { accountId: account.id, stampCount: account.stampCount, availableRewards: available };
}

/**
 * Marks a reward redeemed against the order that carried its free item.
 *
 * Called once, at the same payment-capture moment the discount it granted
 * is actually charged — never at cart-pricing time, when the order could
 * still be abandoned before payment. `productSlug` is a convenience
 * snapshot; the order's own `order_items` row is the immutable record.
 */
export async function redeemStampReward(input: { rewardId: string; orgId: string; orderId: string; productSlug: string }): Promise<void> {
  await db()
    .update(loyaltyRewards)
    .set({
      status: "REDEEMED",
      redeemedAt: new Date(),
      redeemedOrderId: input.orderId,
      redeemedProductSlug: input.productSlug,
      updatedAt: new Date(),
    })
    .where(and(eq(loyaltyRewards.id, input.rewardId), eq(loyaltyRewards.orgId, input.orgId), eq(loyaltyRewards.status, "AVAILABLE")));
}

/** What "qualifying spend" means for the stamp program: the same figure points earn on. */
export function qualifyingStampSpend(grandTotal: Paise, deliveryFee: Paise): Paise {
  return subtract(grandTotal, deliveryFee);
}
