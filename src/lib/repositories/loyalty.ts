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

import { and, asc, eq, gte, isNull, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { loyaltyAccounts, loyaltyRewards, loyaltyStampEvents, loyaltyTransactions, orders, organizations } from "@/db/schema";
import { pointsReclaimable } from "@/lib/loyalty";
import { type StampConfig, isRewardUnlocked, qualifiesForStamp } from "@/lib/loyalty/stamps";
import { type Paise, ZERO, paise, subtract } from "@/lib/money";
import type { DbTx } from "./inventory";

export interface StampAccountState {
  readonly accountId: string;
  /** Unconsumed stamps toward the next reward. */
  readonly stampCount: number;
  /** Rewards sitting ready to redeem, oldest first. */
  readonly availableRewards: readonly { readonly id: string; readonly unlockedAt: Date }[];
}

async function findOrCreateAccount(tx: DbTx, orgId: string, customerId: string): Promise<string> {
  const [existing] = await tx
    .select({ id: loyaltyAccounts.id })
    .from(loyaltyAccounts)
    .where(eq(loyaltyAccounts.customerId, customerId))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await tx
    .insert(loyaltyAccounts)
    .values({ orgId, customerId })
    .onConflictDoNothing({ target: loyaltyAccounts.customerId })
    .returning({ id: loyaltyAccounts.id });
  if (created) return created.id;

  // Lost the race to create it — read what the other writer just made.
  const [row] = await tx
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
 *
 * Locks the account row FOR UPDATE first, before reading anything else —
 * this is the one place two entirely different order-locked transactions
 * (an award, from `settle()` settling a *different* order of the same
 * customer, and a reversal, from `reverseStampForOrder` voiding *this*
 * order) both ultimately land, and an order-row lock alone cannot
 * serialize them, since they hold locks on two different order rows. Two
 * concurrent settlements for the same account used to each read the same
 * "unconsumed" snapshot and each insert a reward once it looked complete —
 * both really could look complete at once, e.g. one reversal handing back
 * some stamps and a second, concurrent reversal (or award) handing back or
 * adding the rest — producing two AVAILABLE rewards, one of them backed by
 * no stamps at all: a free item the business never actually earned. The
 * account lock makes the loser wait for the winner's whole transaction to
 * commit and then read the genuinely current pool, so at most one of them
 * ever crosses the threshold for the same cycle. Lock order stays
 * order-row-first everywhere this is reachable (`settle()`,
 * `reverseStampForOrder`), so this never introduces a cycle: nothing here
 * locks an order row after taking this account lock.
 */
async function settleAccount(tx: DbTx, accountId: string, orgId: string, config: StampConfig): Promise<number> {
  await tx.select({ id: loyaltyAccounts.id }).from(loyaltyAccounts).where(eq(loyaltyAccounts.id, accountId)).for("update");

  for (;;) {
    const unconsumed = await tx
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
      await tx.update(loyaltyAccounts).set({ stampCount: unconsumed.length, updatedAt: new Date() }).where(eq(loyaltyAccounts.id, accountId));
      return unconsumed.length;
    }

    // Oldest `stampsRequired` unconsumed stamps form this cycle. Any extra
    // stay unconsumed and roll into whatever unlocks next.
    const forThisReward = unconsumed.slice(0, config.stampsRequired);

    const [reward] = await tx.insert(loyaltyRewards).values({ orgId, accountId }).returning({ id: loyaltyRewards.id });
    if (!reward) throw new Error("loyalty: could not create a reward row");

    for (const event of forThisReward) {
      // `rewardId IS NULL` makes this the same kind of write-is-the-check
      // guard as the reward status flip below it: under the account lock
      // above this should never matter (nothing else can be concurrently
      // re-assigning this account's events), but it costs nothing and means
      // this can never silently steal an event a *different*, already-
      // committed cycle claimed off a stale `unconsumed` list.
      await tx
        .update(loyaltyStampEvents)
        .set({ rewardId: reward.id, updatedAt: new Date() })
        .where(and(eq(loyaltyStampEvents.id, event.id), isNull(loyaltyStampEvents.rewardId)));
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
 *
 * Takes an explicit transaction handle — its one caller, `settle()`
 * (payments.ts), runs this as part of one atomic settlement (payment row,
 * invoice number, order status, this award, the stamp reward below, the
 * event and audit rows). A version of this that opened its own transaction
 * would defeat that: a crash after this commits but before the rest of the
 * settlement finishes would leave a stamp awarded for a payment that, from
 * everywhere else in the system, never happened.
 */
export async function awardStampForOrderInTx(
  tx: DbTx,
  input: {
    orgId: string;
    customerId: string;
    orderId: string;
    qualifyingSpend: Paise;
    config: StampConfig;
  },
): Promise<{ awarded: boolean }> {
  if (!qualifiesForStamp(input.qualifyingSpend, input.config)) return { awarded: false };

  const accountId = await findOrCreateAccount(tx, input.orgId, input.customerId);

  const [inserted] = await tx
    .insert(loyaltyStampEvents)
    .values({ orgId: input.orgId, accountId, orderId: input.orderId })
    .onConflictDoNothing({ target: loyaltyStampEvents.orderId })
    .returning({ id: loyaltyStampEvents.id });

  if (!inserted) return { awarded: false }; // already stamped — a retry, not a new visit.

  await settleAccount(tx, accountId, input.orgId, input.config);
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
 *
 * The AVAILABLE → REVERSED write is guarded in its own WHERE clause, not
 * decided by an earlier read — the same reason `redeemStampReward` folds
 * its check into its write. Two different orders can share one reward id
 * (see that function's own doc comment: `getAvailableStampReward` never
 * claims, only reads), so this order's refund and a *different* order's
 * settlement can race the same reward: a read-then-write here would still
 * fire its update after losing that race — clobbering a reward a
 * concurrent, real redemption had just marked REDEEMED back to REVERSED,
 * while leaving that redemption's own `redeemedOrderId`/`redeemedAt`
 * untouched, a self-contradictory row (redeemed and reversed at once) with
 * nothing anywhere pointing at how it got that way.
 *
 * A *different* race — two concurrent reversals of the SAME order (a
 * replayed idempotency key, or POS-ORDERS' F2 convergent follow-up racing
 * a manual REFUNDED transition) — used to be only partly guarded: the
 * top-level "already reversed" check above was a plain read, not decided
 * by the write that follows it, so both callers could read `reversedAt
 * IS NULL` before either committed and both walk the whole body,
 * including a second, concurrent `settleAccount` for the same account
 * (each unaware of the other's in-flight stamp changes). Fixed by locking
 * the order row first, then doing the stamp read and every write inside
 * that same transaction — the same lock, and the same lock-order-first
 * rule, `reversePointsForOrder` and every other order mutation
 * (`advanceOrder`, `settle()`) already use. The loser blocks until the
 * winner's transaction commits, then re-reads under the lock and sees
 * `reversedAt` already set, so it no-ops before touching the reward, the
 * pool, or `settleAccount` at all.
 *
 * The account row is locked here too, right after that check and before
 * any stamp/reward write — not left for `settleAccount` to lock later.
 * `settle()` (payments.ts) takes locks order → account → stamp/reward
 * rows (the account upsert, then the award and `redeemStampRewardInTx`).
 * Locking the account only inside `settleAccount`, at the very end of
 * this function, took them order → stamp/reward rows → account instead —
 * a genuine lock-order inversion: a refund on this order (holding this
 * order's lock, waiting on the account) can deadlock against a
 * same-customer `settle()` on a *different* order (holding that order's
 * lock and the account, waiting on this order's stamp/reward rows).
 * Postgres would abort one of them (`40P01`), and if it picked the
 * reversal, `advanceOrder` had already committed REFUNDED, leaving
 * loyalty unreversed with nothing left to retry it. Taking the account
 * lock here first restores order → account → stamps/rewards everywhere;
 * `settleAccount`'s own lock is then just a harmless re-lock of a row
 * this transaction already holds. No schema change.
 */
export async function reverseStampForOrder(input: { orgId: string; orderId: string; reason: string }): Promise<void> {
  const database = db();
  await database.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.orgId, input.orgId)))
      .for("update")
      .limit(1);
    if (!locked) return; // no such order in this org

    const [event] = await tx
      .select()
      .from(loyaltyStampEvents)
      .where(and(eq(loyaltyStampEvents.orderId, input.orderId), eq(loyaltyStampEvents.orgId, input.orgId)))
      .limit(1);

    if (!event || event.reversedAt) return; // never earned a stamp, or already reversed — checked under the order lock, not a stale read.

    const [account] = await tx.select({ id: loyaltyAccounts.id }).from(loyaltyAccounts).where(eq(loyaltyAccounts.id, event.accountId)).for("update").limit(1);
    if (!account) return;

    // Re-read the event by id now that the account lock is held, and use
    // only THIS row for everything below — not `event` above. Two
    // different orders can share one reward id (see this function's own
    // doc comment above), so between the first read and this lock, a
    // DIFFERENT reversal for a DIFFERENT order sharing this event's
    // reward could already have voided that reward and pooled this very
    // event into a brand new one under the account lock this call just
    // waited on. `event.rewardId` would then be stale: this call would
    // CAS against the old, already-REVERSED reward (a silent no-op) while
    // still marking this event reversed — leaving the NEW reward sitting
    // AVAILABLE though one of its backing stamps just got reversed under
    // it: a free item nobody actually earned.
    const [current] = await tx.select().from(loyaltyStampEvents).where(eq(loyaltyStampEvents.id, event.id)).limit(1);
    if (!current || current.reversedAt) return; // reversed by someone else while this call waited for the account lock

    await tx
      .update(loyaltyStampEvents)
      .set({ reversedAt: new Date(), reversalReason: input.reason, updatedAt: new Date() })
      .where(eq(loyaltyStampEvents.id, current.id));

    if (current.rewardId) {
      const [reversed] = await tx
        .update(loyaltyRewards)
        .set({ status: "REVERSED", reversedAt: new Date(), reversalReason: input.reason, updatedAt: new Date() })
        .where(and(eq(loyaltyRewards.id, current.rewardId), eq(loyaltyRewards.status, "AVAILABLE")))
        .returning({ id: loyaltyRewards.id });

      if (reversed) {
        // Give the reward's other stamps back to the pool — they were paid
        // for and did not stop being real because a different order refunded.
        await tx
          .update(loyaltyStampEvents)
          .set({ rewardId: null, updatedAt: new Date() })
          .where(and(eq(loyaltyStampEvents.rewardId, current.rewardId), isNull(loyaltyStampEvents.reversedAt)));
      } else {
        // Not AVAILABLE by the time this tried to void it. Ordinarily that
        // just means an earlier call already reversed it — a quiet no-op,
        // same as this function's own top-level guard above. The one case
        // worth knowing about is the race this whole guard exists for: the
        // reward was actually redeemed by a different order that shared its
        // id, in which case a real, paid order is now sitting on a reward
        // this refund cannot touch — surfaced rather than swallowed.
        const [rewardRow] = await tx.select({ status: loyaltyRewards.status }).from(loyaltyRewards).where(eq(loyaltyRewards.id, current.rewardId)).limit(1);
        if (rewardRow?.status === "REDEEMED") {
          console.error(`loyalty reward: order ${input.orderId} was refunded but its reward ${current.rewardId} had already been redeemed by a different order sharing the same reward id by the time this refund tried to void it — left REDEEMED, nothing reversed`);
        }
      }
    }

    const [org] = await tx.select().from(organizations).where(eq(organizations.id, input.orgId)).limit(1);
    const config: StampConfig = org
      ? {
          enabled: org.stampRewardEnabled,
          stampsRequired: org.stampsRequired,
          minOrderValue: paise(org.stampMinOrderValue),
          maxRewardValue: paise(org.stampMaxRewardValue),
        }
      : { enabled: false, stampsRequired: 7, minOrderValue: ZERO, maxRewardValue: ZERO };

    // `settleAccount` takes a real transaction handle, and now always gets
    // one — this whole function is one transaction, locked on the order
    // row and then the account row above, so a concurrent reversal or
    // settlement for the same account can never call `settleAccount`
    // while this one is still running.
    await settleAccount(tx, current.accountId, input.orgId, config);
  });
}

/**
 * Reverses the points a refunded order earned, if it earned any.
 *
 * Points and stamps are separate programs (see `src/lib/loyalty/index.ts`'s
 * own header) that happened to share one gap: stamps were reversed on
 * refund, points were not — a customer could pay, earn points, get a full
 * refund, and keep the points, indefinitely. This closes that the same way
 * `reverseStampForOrder` closes its own: on the `REFUNDED` transition,
 * `advanceOrder` calls both.
 *
 * `orders.pointsEarned` is what this order actually earned — read once,
 * from the order itself, never recomputed from `grandTotal` again, so a
 * later change to the earn rate can never rewrite what a past order
 * genuinely earned (the same §51 snapshot principle as a price).
 *
 * Idempotent on `orderId`: a reversal already recorded for this order is
 * matched by its own distinctive `reason` prefix (there is no unique
 * constraint to lean on here the way `loyalty_stamp_events.order_id` gives
 * stamps one — points share one ledger table with every other kind of
 * movement) and short-circuits. In practice `advanceOrder`'s own state
 * machine already makes this unreachable twice for one order (`REFUNDED`
 * has no further transitions), but this mirrors `reverseStampForOrder`'s
 * own defence-in-depth rather than relying on that alone.
 *
 * The balance floors at zero rather than going negative, via
 * `pointsReclaimable` (`src/lib/loyalty/index.ts`, pure and tested): unlike
 * a stamp count (a real count of unconsumed events, incapable of going
 * negative by construction), `loyaltyAccounts.pointsBalance` is a mutable
 * cache, and a customer may have already spent some or all of these points
 * on a later order before this one was refunded. Clawing back more than
 * remains would show the account as owing FRYBIRD points, which is not a
 * real state this program has. The ledger records exactly what was
 * actually removed, not the order's original face value, so the ledger and
 * the balance never disagree.
 *
 * The balance write itself is one atomic SQL statement (`greatest(...)`),
 * not a read-then-write — matching the earn path's own increment
 * (`payments.ts`), which already updates this exact column atomically.
 * `reclaimed` still comes from a snapshot read, used to decide what the
 * ledger entry says; the atomic `GREATEST` on the write is the actual
 * safety net if the real balance had already moved by the time this runs,
 * so the account can never be pushed negative regardless.
 *
 * That atomic write protects the *balance* even under a race, but the
 * idempotency check above it (`already`) was still plain read-then-decide
 * against autocommitted statements: two concurrent callers for the same
 * order — a replayed idempotency key, or a future refund follow-up racing
 * `advanceOrder`'s own post-commit call (`orders.ts`) — could both read
 * "no reversal yet" before either had committed one, and both proceed to
 * debit the balance and insert a ledger row. `GREATEST` stops the balance
 * from going negative but does nothing to stop it being debited *twice*,
 * and nothing stops two ledger rows.
 *
 * Fixed by locking the order row first — the same lock, and the same
 * order (order row before anything else), that every other mutation of an
 * order already takes (`advanceOrder`, `settle` in `payments.ts`) — inside
 * one transaction that also re-checks `already` under that lock. The
 * second concurrent caller blocks on the lock until the first commits, then
 * sees the first's ledger row via the now-committed `already` check and
 * no-ops, rather than reading a stale "not yet reversed" snapshot. No
 * schema change: this is a lock, not a constraint. Deliberately carries no
 * status filter on the order — any order with `pointsEarned > 0`, whatever
 * its current status, is eligible, so a future caller reversing points for
 * a fully refunded CANCELLED or FAILED order (not just REFUNDED) needs no
 * change here.
 */
export async function reversePointsForOrder(input: { orgId: string; orderId: string; reason: string }): Promise<void> {
  const database = db();
  await database.transaction(async (tx) => {
    const [order] = await tx
      .select({ pointsEarned: orders.pointsEarned, customerId: orders.customerId })
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.orgId, input.orgId)))
      .for("update")
      .limit(1);
    if (!order || order.pointsEarned <= 0 || !order.customerId) return; // never earned any, or a guest order

    const REVERSAL_PREFIX = "Reversed —";
    const [already] = await tx
      .select({ id: loyaltyTransactions.id })
      .from(loyaltyTransactions)
      .where(and(eq(loyaltyTransactions.orgId, input.orgId), eq(loyaltyTransactions.orderId, input.orderId), like(loyaltyTransactions.reason, `${REVERSAL_PREFIX}%`)))
      .limit(1);
    if (already) return;

    const [account] = await tx
      .select({ id: loyaltyAccounts.id, pointsBalance: loyaltyAccounts.pointsBalance })
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.customerId, order.customerId))
      .limit(1);
    if (!account) return;

    const reclaimed = pointsReclaimable(account.pointsBalance, order.pointsEarned);
    if (reclaimed <= 0) return; // nothing left on the account to take back

    // The write itself is atomic — correct even if a concurrent spend races
    // this exact account between the read above and this statement —
    // matching how the earn path (payments.ts) already increments this same
    // column, rather than trusting the snapshot read. `reclaimed` (from that
    // snapshot) still decides the ledger entry below; GREATEST is the actual
    // safety net if reality had already moved. The order-row lock above is
    // what stops this whole block from running twice for the same order.
    await tx
      .update(loyaltyAccounts)
      .set({ pointsBalance: sql`greatest(${loyaltyAccounts.pointsBalance} - ${reclaimed}, 0)`, updatedAt: new Date() })
      .where(eq(loyaltyAccounts.id, account.id));

    await tx.insert(loyaltyTransactions).values({
      orgId: input.orgId,
      accountId: account.id,
      points: -reclaimed,
      reason: `${REVERSAL_PREFIX} ${input.reason}`,
      orderId: input.orderId,
    });
  });
}

/**
 * Spends points a priced order redeemed, once the order row itself exists.
 *
 * The counterpart to `reversePointsForOrder` above, and atomic for the same
 * reason: the previous version read `pointsBalance` and then wrote
 * `balance - points` computed in JS, with no re-check at all that the
 * balance still covered the spend. Two orders from the same customer placed
 * close enough together would both read the same starting balance, and the
 * second write would silently clobber the first deduction — or the balance
 * could be driven negative outright, since nothing stopped it. The `WHERE
 * pointsBalance >= points` makes the write itself the check: it only
 * applies against whatever the balance actually is at that instant, and
 * updates zero rows — surfaced to the caller, not swallowed — if a
 * concurrent spend already used the balance up.
 *
 * By the time this runs the order has already been written with the
 * discount priced in (matching the comment at this function's call site):
 * a failed spend here cannot be un-ordered, only reported.
 */
export async function spendPointsForOrder(input: { orgId: string; customerId: string; orderId: string; orderNumber: string; points: number }): Promise<{ debited: boolean }> {
  if (input.points <= 0) return { debited: true };
  const database = db();

  const [account] = await database.select({ id: loyaltyAccounts.id }).from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, input.customerId)).limit(1);
  if (!account) return { debited: false };

  const [debited] = await database
    .update(loyaltyAccounts)
    .set({ pointsBalance: sql`${loyaltyAccounts.pointsBalance} - ${input.points}`, updatedAt: new Date() })
    .where(and(eq(loyaltyAccounts.id, account.id), gte(loyaltyAccounts.pointsBalance, input.points)))
    .returning({ id: loyaltyAccounts.id });
  if (!debited) return { debited: false };

  await database.insert(loyaltyTransactions).values({
    orgId: input.orgId,
    accountId: account.id,
    points: -input.points,
    reason: `Spent on order #${input.orderNumber}`,
    orderId: input.orderId,
  });
  return { debited: true };
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
/** The points balance the customer has right now, or null with no account yet. Read-only; scoped to the org. */
export async function getPointsBalance(customerId: string, orgId: string): Promise<number | null> {
  const [account] = await db()
    .select({ pointsBalance: loyaltyAccounts.pointsBalance })
    .from(loyaltyAccounts)
    .where(and(eq(loyaltyAccounts.customerId, customerId), eq(loyaltyAccounts.orgId, orgId)))
    .limit(1);
  return account?.pointsBalance ?? null;
}

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
 *
 * The `status = 'AVAILABLE'` guard makes the write itself the check, so
 * two orders that both captured the same reward id at checkout — a real
 * possibility, since `getAvailableStampReward` only ever reads: it never
 * claims, and a customer can have two unpaid orders open at once,
 * especially for cash/COD, where settlement can be hours after either was
 * placed — can never both flip it to REDEEMED. Returns whether *this* call
 * was the one that actually landed, because the caller already committed
 * the order with the discount priced in either way and has no way to
 * charge for it again if it lost the race; the only thing left to do with
 * a lost race is make sure it is never silent.
 *
 * Takes an explicit transaction handle for the same reason
 * `awardStampForOrderInTx` does — its one caller, `settle()`, runs this as
 * part of one atomic settlement, so a mid-settlement crash never leaves a
 * reward marked spent for a payment nothing else in the system completed.
 */
export async function redeemStampRewardInTx(tx: DbTx, input: { rewardId: string; orgId: string; orderId: string; productSlug: string }): Promise<{ redeemed: boolean }> {
  const [row] = await tx
    .update(loyaltyRewards)
    .set({
      status: "REDEEMED",
      redeemedAt: new Date(),
      redeemedOrderId: input.orderId,
      redeemedProductSlug: input.productSlug,
      updatedAt: new Date(),
    })
    .where(and(eq(loyaltyRewards.id, input.rewardId), eq(loyaltyRewards.orgId, input.orgId), eq(loyaltyRewards.status, "AVAILABLE")))
    .returning({ id: loyaltyRewards.id });
  return { redeemed: row !== undefined };
}

/** What "qualifying spend" means for the stamp program: the same figure points earn on. */
export function qualifyingStampSpend(grandTotal: Paise, deliveryFee: Paise): Paise {
  return subtract(grandTotal, deliveryFee);
}
