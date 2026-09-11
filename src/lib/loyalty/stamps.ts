/**
 * FRYBIRD REWARDS — the one universal stamp card.
 *
 * Spend more than a threshold on a qualifying order, earn one stamp.
 * Collect enough stamps, unlock one free item up to a price cap. There is
 * exactly one card — never a separate one per category, never one per
 * product line. A customer earns this and points from the same order; the
 * two programs do not interact.
 *
 * This module is the pure arithmetic: whether an order's spend qualifies,
 * whether an item is a legal free redemption, and whether a given number of
 * unconsumed stamps unlocks a reward. It knows nothing about orders,
 * customers or the database — the repository layer supplies those and owns
 * the ledger. Every function here is deterministic and has a test.
 */

import { type Paise, ZERO } from "@/lib/money";

export interface StampConfig {
  readonly enabled: boolean;
  /** Stamps needed to unlock a free item. */
  readonly stampsRequired: number;
  /** The qualifying spend must exceed this — reaching it exactly is not enough. */
  readonly minOrderValue: Paise;
  /** An item priced above this cannot be the free redemption. */
  readonly maxRewardValue: Paise;
}

export const STAMP_DISABLED: StampConfig = {
  enabled: false,
  stampsRequired: 7,
  minOrderValue: ZERO,
  maxRewardValue: ZERO,
};

export function isStampProgramEnabled(config: StampConfig): boolean {
  return config.enabled && config.stampsRequired > 0;
}

/**
 * Whether this order's qualifying spend earns a stamp.
 *
 * Strictly greater than, not "at least" — spending exactly the threshold
 * does not qualify. ₹200.00 is 0 stamps; ₹200.01 is 1. A customer earns at
 * most one stamp per order regardless of the amount by construction: this
 * answers "does this order earn a stamp," a yes/no, never a count.
 */
export function qualifiesForStamp(qualifyingSpend: Paise, config: StampConfig): boolean {
  return isStampProgramEnabled(config) && qualifyingSpend > config.minOrderValue;
}

/** Whether `unconsumedStamps` is enough to unlock a reward right now. */
export function isRewardUnlocked(unconsumedStamps: number, config: StampConfig): boolean {
  return isStampProgramEnabled(config) && unconsumedStamps >= config.stampsRequired;
}

/**
 * Whether an item at this listed price is a legal free redemption.
 *
 * Compared against the item's full per-unit price — base plus modifiers,
 * the same "what does this actually cost" figure pricing uses everywhere
 * else — not the bare product price a modifier could push over the cap.
 */
export function isRewardEligibleItem(unitPrice: Paise, config: StampConfig): boolean {
  return isStampProgramEnabled(config) && unitPrice <= config.maxRewardValue;
}
