import "server-only";

/** Looking up promotion codes. */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { promotions } from "@/db/schema";
import { type Paise, paise } from "@/lib/money";
import { type Promotion, normaliseCode } from "@/lib/promotions";

export async function findPromotion(orgId: string, code: string): Promise<Promotion | null> {
  const normalised = normaliseCode(code);
  if (!normalised) return null;

  const [row] = await db()
    .select()
    .from(promotions)
    .where(and(eq(promotions.orgId, orgId), eq(promotions.code, normalised)))
    .limit(1);

  if (!row) return null;

  return {
    code: row.code,
    name: row.name,
    discountBps: row.discountBps,
    discountAmount: row.discountAmount === null ? null : (paise(row.discountAmount) as Paise),
    minOrderAmount: row.minOrderAmount === null ? null : (paise(row.minOrderAmount) as Paise),
    maxDiscountAmount: row.maxDiscountAmount === null ? null : (paise(row.maxDiscountAmount) as Paise),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    usageLimit: row.usageLimit,
    usageCount: row.usageCount,
    isActive: row.isActive,
  };
}

/**
 * Counts a use, once the order is safely written.
 *
 * Incremented in SQL rather than read-modify-written, so two orders placed at
 * the same moment cannot both read the same count and let a limited code go
 * one over.
 */
export async function countPromotionUse(orgId: string, code: string): Promise<void> {
  await db()
    .update(promotions)
    .set({ usageCount: sql`${promotions.usageCount} + 1`, updatedAt: new Date() })
    .where(and(eq(promotions.orgId, orgId), eq(promotions.code, normaliseCode(code))));
}
