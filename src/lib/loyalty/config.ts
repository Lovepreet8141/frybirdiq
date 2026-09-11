import "server-only";

/** Reads the loyalty schemes — points and the stamp card — from the organization. */

import { type LoyaltyConfig } from "./index";
import { STAMP_DISABLED, type StampConfig } from "./stamps";
import { paise } from "@/lib/money";
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

  return { enabled: row.stampRewardEnabled, goal: row.stampRewardGoal };
}
