/**
 * The words for FRYBIRD's loyalty programmes, derived from their config.
 *
 * Every figure in every sentence here comes from the two configs
 * (`getLoyaltyConfig` / `getStampConfig`, the organization's own settings) —
 * nothing is typed in. Change the stamp count, the spend threshold, the
 * reward cap or the earn rate and every surface that renders these
 * (home, menu, account, order page, cart, checkout) changes with it.
 *
 * Pure: no database, no React. Read-only over the programme; it explains
 * and previews, and never decides what is earned or spent (that stays in
 * `./index`, `./stamps` and the loyalty repository).
 */

import { formatBps, formatINR, type Paise } from "@/lib/money";
import { isLoyaltyEnabled, pointsEarned, type LoyaltyConfig } from "./index";
import { isStampProgramEnabled, qualifiesForStamp, type StampConfig } from "./stamps";

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** What earns a stamp and what a full card gives. Null when the card is off. */
export function stampRule(config: StampConfig): string | null {
  if (!isStampProgramEnabled(config)) return null;
  return `When you're signed in, a paid order over ${formatINR(config.minOrderValue)} (food, after offers and points) earns a stamp. Collect ${config.stampsRequired}, and one item up to ${formatINR(config.maxRewardValue)} is free — you pick which one.`;
}

/** One line for tight places (the menu). Null when the card is off. */
export function stampRuleShort(config: StampConfig): string | null {
  if (!isStampProgramEnabled(config)) return null;
  return `Signed in, a paid order over ${formatINR(config.minOrderValue)} (food, after offers and points) earns a stamp. ${config.stampsRequired} stamps = a free item up to ${formatINR(config.maxRewardValue)}.`;
}

/** What points give. Null when points are off. */
export function pointsRule(config: LoyaltyConfig): string | null {
  if (!isLoyaltyEnabled(config)) return null;
  return `Signed in, ${formatBps(config.earnBps, 0)} of what you pay for food (after offers and points) comes back as points on paid orders${config.minRedeemPoints > 0 ? `, spendable once you have ${config.minRedeemPoints}` : ""}.`;
}

export interface StampProgress {
  /** A reward is sitting ready to use. */
  readonly ready: boolean;
  readonly count: number;
  readonly required: number;
  /** Qualifying orders still needed for the next reward; 0 when ready. */
  readonly remaining: number;
  /** "3 of 8". */
  readonly label: string;
  /** "3 of 8 — 5 more orders to a free item (up to ₹200)." */
  readonly text: string;
}

/**
 * Where a customer stands on the card.
 *
 * `count` is unconsumed stamps (what the ledger keeps on the account);
 * `availableRewards` is rewards already unlocked. After a reward is unlocked
 * the count drops by the stamps it used, so the label restarts from what is
 * left over while `ready` tells them the free item is waiting.
 */
export function stampProgress(count: number, availableRewards: number, config: StampConfig): StampProgress | null {
  if (!isStampProgramEnabled(config)) return null;
  const required = config.stampsRequired;
  const safeCount = Math.max(0, Math.floor(count));
  const ready = availableRewards > 0 || safeCount >= required;
  const remaining = ready ? 0 : required - safeCount;
  const label = `${Math.min(safeCount, required)} of ${required}`;
  const cap = formatINR(config.maxRewardValue);
  const text = ready
    ? `Your free item (up to ${cap}) is ready — add it at checkout.`
    : `${label} — ${remaining} more ${plural(remaining, "order", "orders")} over ${formatINR(config.minOrderValue)} to a free item (up to ${cap}).`;
  return { ready, count: safeCount, required, remaining, label, text };
}

/**
 * What placing this order will earn, for the cart and checkout.
 *
 * `spend` must be the ledger's own qualifying spend for the order
 * (`qualifyingStampSpend` in the loyalty repository: what the customer pays,
 * after offers and points, delivery excluded), and the two decisions below are
 * the ledger's own functions — `qualifiesForStamp` and `pointsEarned` — not a
 * copy of their arithmetic. A part that would earn nothing is left out
 * entirely: never "0 stamps", never "0 points".
 */
export function earnPreview(input: { spend: Paise; signedIn: boolean; loyalty: LoyaltyConfig; stamps: StampConfig }): readonly string[] {
  const { spend, signedIn, loyalty, stamps } = input;
  const stamp = qualifiesForStamp(spend, stamps);
  const points = pointsEarned(spend, loyalty);
  const pointsText = `${points} ${plural(points, "point", "points")}`;

  if (!signedIn) {
    const parts = [...(stamp ? ["1 stamp"] : []), ...(points > 0 ? [pointsText] : [])];
    return parts.length > 0 ? [`Sign in to earn ${parts.join(" and ")} on this order.`] : [];
  }
  return [
    ...(stamp ? ["You'll earn 1 stamp when this order is completed."] : []),
    ...(points > 0 ? [`You'll earn ${pointsText} when this order is completed.`] : []),
  ];
}
