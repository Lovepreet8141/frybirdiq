import "server-only";

/** Reads and writes the loyalty schemes — points and the stamp card — on the organization. */

import { type LoyaltyConfig } from "./index";
import { STAMP_DISABLED, type StampConfig } from "./stamps";
import { type Paise, paise } from "@/lib/money";
import { getOrg } from "@/lib/repositories/org";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function getLoyaltyConfig(): Promise<LoyaltyConfig> {
  const org = await getOrg();
  if (!org) return { earnBps: 0, pointValue: paise(0), minRedeemPoints: 0 };

  const [row] = await db().select().from(organizations).where(eq(organizations.id, org.id)).limit(1);
  if (!row) return { earnBps: 0, pointValue: paise(0), minRedeemPoints: 0 };

  return {
    earnBps: row.loyaltyEarnBps,
    pointValue: paise(row.loyaltyPointValue),
    minRedeemPoints: row.loyaltyMinRedeemPoints,
  };
}

export async function getStampConfig(): Promise<StampConfig> {
  const org = await getOrg();
  if (!org) return STAMP_DISABLED;

  const [row] = await db().select().from(organizations).where(eq(organizations.id, org.id)).limit(1);
  if (!row) return STAMP_DISABLED;

  return {
    enabled: row.stampRewardEnabled,
    stampsRequired: row.stampsRequired,
    minOrderValue: paise(row.stampMinOrderValue),
    maxRewardValue: paise(row.stampMaxRewardValue),
  };
}

/**
 * Writes the stamp card's rules. FRYBIRD IQ's settings screen is the only
 * caller — this is a plain write with no permission check of its own,
 * trusting the caller already required `settings.manage` (see
 * `src/lib/loyalty/actions.ts`), the same division of responsibility every
 * other repository write in this codebase follows.
 */
export async function updateStampConfig(
  orgId: string,
  updates: {
    enabled?: boolean;
    stampsRequired?: number;
    minOrderValue?: Paise;
    maxRewardValue?: Paise;
  },
): Promise<void> {
  await db()
    .update(organizations)
    .set({
      ...(updates.enabled !== undefined ? { stampRewardEnabled: updates.enabled } : {}),
      ...(updates.stampsRequired !== undefined ? { stampsRequired: updates.stampsRequired } : {}),
      ...(updates.minOrderValue !== undefined ? { stampMinOrderValue: updates.minOrderValue } : {}),
      ...(updates.maxRewardValue !== undefined ? { stampMaxRewardValue: updates.maxRewardValue } : {}),
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, orgId));
}
