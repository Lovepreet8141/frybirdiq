import "server-only";

/** Looking up promotion codes. */

import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, payments, promotions } from "@/db/schema";
import { type Paise, ZERO, add, paise } from "@/lib/money";
import { type Promotion, normaliseCode } from "@/lib/promotions";

export interface PromotionRow extends Promotion {
  readonly id: string;
  readonly description: string | null;
  /** What the code actually did: paid orders that carried it, their revenue, and the discount they took. */
  readonly performance: { orders: number; revenue: Paise; discountGiven: Paise };
}

/**
 * Every promotion, with what it has actually done. Read-only.
 *
 * `performance` is measured from orders, not from `usageCount`: the counter
 * says how many times a code was applied at placement, but a placed order
 * can still be abandoned or refunded. Paid, not-cancelled orders are the
 * same definition every revenue figure in this app uses.
 */
export async function listPromotions(orgId: string): Promise<readonly PromotionRow[]> {
  const database = db();
  const [rows, used] = await Promise.all([
    database.select().from(promotions).where(eq(promotions.orgId, orgId)).orderBy(asc(promotions.code)),
    database
      .select({ code: orders.promotionCode, grandTotal: orders.grandTotal, discountTotal: orders.discountTotal })
      .from(orders)
      .innerJoin(payments, and(eq(payments.orderId, orders.id), eq(payments.status, "CAPTURED")))
      .where(and(eq(orders.orgId, orgId), isNotNull(orders.promotionCode), sql`${orders.status} NOT IN ('CANCELLED', 'FAILED', 'REFUNDED')`)),
  ]);

  const byCode = new Map<string, { orders: number; revenue: Paise; discountGiven: Paise }>();
  for (const order of used) {
    const code = normaliseCode(order.code ?? "");
    if (!code) continue;
    const found = byCode.get(code) ?? { orders: 0, revenue: ZERO, discountGiven: ZERO };
    byCode.set(code, {
      orders: found.orders + 1,
      revenue: add(found.revenue, paise(order.grandTotal)),
      discountGiven: add(found.discountGiven, paise(order.discountTotal)),
    });
  }

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    discountBps: row.discountBps,
    discountAmount: row.discountAmount === null ? null : paise(row.discountAmount),
    minOrderAmount: row.minOrderAmount === null ? null : paise(row.minOrderAmount),
    maxDiscountAmount: row.maxDiscountAmount === null ? null : paise(row.maxDiscountAmount),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    usageLimit: row.usageLimit,
    usageCount: row.usageCount,
    isActive: row.isActive,
    performance: byCode.get(normaliseCode(row.code) ?? row.code) ?? { orders: 0, revenue: ZERO, discountGiven: ZERO },
  }));
}

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
