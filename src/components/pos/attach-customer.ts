import { lookupCustomerAction } from "@/lib/pos/actions";
import { rewardsSummary } from "@/lib/pos/rewards-enrolment";

/** The customer this order is for, once they have offered a number. The phone travels; the server resolves it against the org. */
export interface PosCustomer {
  readonly phone: string;
  readonly name: string | null;
  /** "3/7 stamps · 120 points", or "New — enrolled with this order". */
  readonly summary: string;
  /** Something is usable on this visit — a stamp reward unlocked, or points on the balance. Shown; not yet redeemable at the till. */
  readonly redeemable: { readonly rewards: number; readonly points: number } | null;
}

/**
 * One lookup for both entry points — the Customer control at the top of the
 * POS and "Rewards · add mobile" on the tender — so they cannot disagree
 * about what a number means. Nothing is written here: the record for a new
 * number is created when the order is placed (`ensureCustomerByPhone`).
 */
export async function attachCustomerByPhone(phone: string): Promise<{ ok: true; customer: PosCustomer } | { ok: false; error: string }> {
  const result = await lookupCustomerAction(phone);
  if (!result.ok) return { ok: false, error: result.error };
  if (!result.found) {
    return { ok: true, customer: { phone: result.phone, name: null, summary: rewardsSummary({ found: false, rewards: null, points: null }), redeemable: null } };
  }
  const rewards = result.rewards?.availableRewardCount ?? 0;
  const points = result.points ?? 0;
  return {
    ok: true,
    customer: {
      phone: result.phone,
      name: result.name,
      summary: rewardsSummary({ found: true, rewards: result.rewards, points: result.points }),
      redeemable: rewards > 0 || points > 0 ? { rewards, points } : null,
    },
  };
}
