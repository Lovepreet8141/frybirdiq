import "server-only";

/**
 * Promotions — the one store for every kind of offer the shop runs.
 *
 * The website's coupon path (`findPromotion` + `applyPromotion`) and the
 * product-aware engine (`src/lib/promotions/engine.ts`) read the same rows.
 * Every write leaves an `audit_logs` row: a promotion changes what an order
 * costs, so who changed it and from what is a fact worth keeping.
 */

import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, orders, payments, promotions } from "@/db/schema";
import { businessDate, endOfBusinessDay, startOfBusinessDay } from "@/lib/dates";
import { type Paise, ZERO, add, paise } from "@/lib/money";
import { type Promotion, normaliseCode } from "@/lib/promotions";
import type { CustomerSegment, Promo, PromoStatus, PromoType, Stacking } from "@/lib/promotions/engine";

/* ------------------------------------------------------------------ */
/* Row ↔ Promo                                                         */
/* ------------------------------------------------------------------ */

type Row = typeof promotions.$inferSelect;

function daysFromMask(mask: number): Promo["days"] {
  return [0, 1, 2, 3, 4, 5, 6].map((i) => Boolean(mask & (1 << i))) as unknown as Promo["days"];
}

function maskFromDays(days: Promo["days"]): number {
  return days.reduce((mask, on, i) => (on ? mask | (1 << i) : mask), 0);
}

function toPromo(row: Row): Promo {
  return {
    id: row.id,
    name: row.name,
    type: row.type as PromoType,
    description: row.description ?? "",
    code: row.code ?? "",
    buyQty: row.buyQty,
    buyProducts: row.buyProducts,
    getQty: row.getQty,
    getProducts: row.getProducts,
    getDiscountBps: row.getDiscountBps,
    products: row.products,
    discountBps: row.discountBps,
    discountAmount: row.discountAmount === null ? null : paise(row.discountAmount),
    minOrder: row.minOrderAmount === null ? null : paise(row.minOrderAmount),
    maxDiscount: row.maxDiscountAmount === null ? null : paise(row.maxDiscountAmount),
    comboPrice: row.comboPrice === null ? null : paise(row.comboPrice),
    // Stored as instants (start of the first day, end of the last, IST); shown as dates.
    startDate: row.startsAt ? businessDate(row.startsAt) : null,
    endDate: row.endsAt ? businessDate(new Date(row.endsAt.getTime() - 1)) : null,
    startTime: row.startTime,
    endTime: row.endTime,
    days: daysFromMask(row.daysMask),
    customer: row.customerSegment as CustomerSegment,
    stacking: row.stacking as Stacking,
    channels: { pos: row.channelPos, web: row.channelWeb },
    usageLimit: row.usageLimit,
    perCustomer: row.perCustomerLimit,
    usageCount: row.usageCount,
    status: row.status as PromoStatus,
    liveSince: row.liveSince,
  };
}

function toRow(orgId: string, promo: Promo) {
  return {
    orgId,
    code: promo.type === "coupon" && promo.code ? normaliseCode(promo.code) : null,
    name: promo.name,
    description: promo.description || null,
    discountBps: promo.discountBps,
    discountAmount: promo.discountAmount,
    minOrderAmount: promo.minOrder,
    maxDiscountAmount: promo.maxDiscount,
    startsAt: promo.startDate ? startOfBusinessDay(promo.startDate) : null,
    endsAt: promo.endDate ? endOfBusinessDay(promo.endDate) : null,
    usageLimit: promo.usageLimit,
    isActive: promo.status === "live",
    type: promo.type,
    buyQty: promo.buyQty,
    buyProducts: [...promo.buyProducts],
    getQty: promo.getQty,
    getProducts: [...promo.getProducts],
    getDiscountBps: promo.getDiscountBps,
    products: [...promo.products],
    comboPrice: promo.comboPrice,
    startTime: promo.startTime,
    endTime: promo.endTime,
    daysMask: maskFromDays(promo.days),
    customerSegment: promo.customer,
    stacking: promo.stacking,
    channelPos: promo.channels.pos,
    channelWeb: promo.channels.web,
    perCustomerLimit: promo.perCustomer,
    status: promo.status,
    liveSince: promo.liveSince,
  };
}

/** Before/after for the audit row — everything the editor can change, money as strings. */
function snapshot(row: Row | null) {
  if (!row) return null;
  const rest: Record<string, unknown> = { ...row };
  delete rest.orgId;
  delete rest.createdAt;
  delete rest.updatedAt;
  return JSON.parse(JSON.stringify(rest, (_key, value) => (typeof value === "bigint" ? value.toString() : value))) as Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export interface PromotionPerformance {
  readonly orders: number;
  readonly revenue: Paise;
  readonly discountGiven: Paise;
}

export interface PromotionRow {
  readonly promo: Promo & { readonly id: string };
  /** What it actually did: paid orders that carried it, their revenue, and the discount they took. */
  readonly performance: PromotionPerformance;
}

/**
 * Every promotion, with what it has actually done. `performance` is
 * measured from paid, not-cancelled orders — the same definition every
 * revenue figure in this app uses — not from `usageCount`. Net of GST
 * (`taxableTotal`), same rule as `src/lib/repositories/analytics.ts`'s
 * `paidOrders`/`netRevenueOf` — GST collected is never revenue, promo
 * performance included.
 */
export async function listPromotions(orgId: string): Promise<readonly PromotionRow[]> {
  const database = db();
  const [rows, used] = await Promise.all([
    database.select().from(promotions).where(eq(promotions.orgId, orgId)).orderBy(asc(promotions.createdAt)),
    database
      .select({ code: orders.promotionCode, taxableTotal: orders.taxableTotal, discountTotal: orders.discountTotal })
      .from(orders)
      .innerJoin(payments, and(eq(payments.orderId, orders.id), eq(payments.status, "CAPTURED")))
      .where(and(eq(orders.orgId, orgId), isNotNull(orders.promotionCode), sql`${orders.status} NOT IN ('CANCELLED', 'FAILED', 'REFUNDED')`)),
  ]);

  const byCode = new Map<string, PromotionPerformance>();
  for (const order of used) {
    const code = normaliseCode(order.code ?? "");
    if (!code) continue;
    const found = byCode.get(code) ?? { orders: 0, revenue: ZERO, discountGiven: ZERO };
    byCode.set(code, { orders: found.orders + 1, revenue: add(found.revenue, paise(order.taxableTotal)), discountGiven: add(found.discountGiven, paise(order.discountTotal)) });
  }

  return rows.map((row) => ({
    promo: { ...toPromo(row), id: row.id },
    performance: (row.code && byCode.get(normaliseCode(row.code))) || { orders: 0, revenue: ZERO, discountGiven: ZERO },
  }));
}

export async function getPromotion(orgId: string, id: string): Promise<(Promo & { readonly id: string }) | null> {
  const [row] = await db().select().from(promotions).where(and(eq(promotions.orgId, orgId), eq(promotions.id, id))).limit(1);
  return row ? { ...toPromo(row), id: row.id } : null;
}

/** The website's coupon lookup — unchanged shape, so `applyPromotion` keeps working for every existing code. */
export async function findPromotion(orgId: string, code: string): Promise<Promotion | null> {
  const normalised = normaliseCode(code);
  if (!normalised) return null;

  const [row] = await db()
    .select()
    .from(promotions)
    .where(and(eq(promotions.orgId, orgId), eq(promotions.code, normalised)))
    .limit(1);

  if (!row || !row.code) return null;

  return {
    code: row.code,
    name: row.name,
    discountBps: row.discountBps,
    discountAmount: row.discountAmount === null ? null : paise(row.discountAmount),
    minOrderAmount: row.minOrderAmount === null ? null : paise(row.minOrderAmount),
    maxDiscountAmount: row.maxDiscountAmount === null ? null : paise(row.maxDiscountAmount),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    usageLimit: row.usageLimit,
    usageCount: row.usageCount,
    isActive: row.isActive,
  };
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export type SavePromotionResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Creates or updates a promotion from the editor. Saving never changes the
 * status: a draft stays a draft, a live one stays live with its new rules
 * (`status` here is whatever the caller resolved — see the actions).
 */
export async function savePromotion(orgId: string, actorUserId: string, promo: Promo): Promise<SavePromotionResult> {
  return db().transaction(async (tx) => {
    const values = toRow(orgId, promo);
    if (values.code) {
      const [clash] = await tx
        .select({ id: promotions.id })
        .from(promotions)
        .where(and(eq(promotions.orgId, orgId), eq(promotions.code, values.code), promo.id ? sql`${promotions.id} <> ${promo.id}` : sql`true`))
        .limit(1);
      if (clash) return { ok: false, error: `The code ${values.code} is already used by another promotion.` };
    }

    if (promo.id) {
      const [before] = await tx.select().from(promotions).where(and(eq(promotions.orgId, orgId), eq(promotions.id, promo.id))).limit(1);
      if (!before) return { ok: false, error: "That promotion no longer exists." };
      const [after] = await tx.update(promotions).set({ ...values, updatedAt: new Date() }).where(eq(promotions.id, promo.id)).returning();
      await tx.insert(auditLogs).values({ orgId, actorUserId, action: "promotion_updated", entity: "promotions", entityId: promo.id, before: snapshot(before), after: snapshot(after ?? null) });
      return { ok: true, id: promo.id };
    }

    const [created] = await tx.insert(promotions).values(values).returning();
    if (!created) return { ok: false, error: "The promotion could not be saved." };
    await tx.insert(auditLogs).values({ orgId, actorUserId, action: "promotion_created", entity: "promotions", entityId: created.id, after: snapshot(created) });
    return { ok: true, id: created.id };
  });
}

export async function deletePromotion(orgId: string, actorUserId: string, id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(promotions).where(and(eq(promotions.orgId, orgId), eq(promotions.id, id))).limit(1);
    if (!before) return { ok: false, error: "That promotion no longer exists." };
    await tx.delete(promotions).where(eq(promotions.id, id));
    await tx.insert(auditLogs).values({ orgId, actorUserId, action: "promotion_deleted", entity: "promotions", entityId: id, before: snapshot(before) });
    return { ok: true };
  });
}

/**
 * Counts a use, once the order is safely written. Incremented in SQL rather
 * than read-modify-written, so two orders placed at the same moment cannot
 * both read the same count and let a limited code go one over.
 */
export async function countPromotionUse(orgId: string, code: string): Promise<void> {
  await db()
    .update(promotions)
    .set({ usageCount: sql`${promotions.usageCount} + 1`, updatedAt: new Date() })
    .where(and(eq(promotions.orgId, orgId), eq(promotions.code, normaliseCode(code))));
}
