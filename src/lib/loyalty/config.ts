import "server-only";

/** Reads the loyalty scheme from the organization. */

import { type LoyaltyConfig } from "./index";
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
