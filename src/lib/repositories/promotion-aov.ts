import "server-only";

/**
 * Promotion measurement (roadmap 7.3): read-only. Average order value with and
 * without each promotion over a stated window, from stored orders only. It
 * never touches how a discount is computed or stored.
 *
 * The sale set is `saleSetWhere` (paid, not cancelled/failed/refunded, created
 * in [from, to)), the same filter every revenue figure uses, and scoped to the
 * org. An order is linked to a promotion by the code stored on it
 * (`orders.promotion_code`); a promotion without a code cannot be linked.
 * Definitions live in `src/lib/promotions/aov.ts`.
 */

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, promotions } from "@/db/schema";
import type { DateRange } from "@/lib/dates";
import { paise } from "@/lib/money";
import { type PromotionComparison, comparePromotion } from "@/lib/promotions/aov";
import { normaliseCode } from "@/lib/promotions";
import { saleSetWhere } from "./analytics";

export interface PromotionAovRow {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
  readonly status: string;
  /** Null when the promotion has no code, so no order can be tied to it. */
  readonly comparison: PromotionComparison | null;
}

export async function listPromotionAov(orgId: string, range: Pick<DateRange, "from" | "to">): Promise<readonly PromotionAovRow[]> {
  const [promos, sold] = await Promise.all([
    db()
      .select({ id: promotions.id, name: promotions.name, code: promotions.code, status: promotions.status })
      .from(promotions)
      .where(eq(promotions.orgId, orgId))
      .orderBy(asc(promotions.createdAt)),
    db()
      .select({ code: orders.promotionCode, taxableTotal: orders.taxableTotal, discountTotal: orders.discountTotal })
      .from(orders)
      .where(saleSetWhere(orgId, range)),
  ]);

  const figures = sold.map((row) => ({
    code: row.code ? normaliseCode(row.code) : "",
    taxableTotal: paise(row.taxableTotal),
    discountTotal: paise(row.discountTotal),
  }));

  return promos.map((promo) => {
    const code = promo.code ? normaliseCode(promo.code) : "";
    if (!code) return { ...promo, comparison: null };
    return {
      ...promo,
      comparison: comparePromotion(
        figures.filter((f) => f.code === code),
        figures.filter((f) => f.code !== code),
      ),
    };
  });
}
