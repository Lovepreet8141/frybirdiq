import type { Metadata } from "next";
import { PromotionsWorkspace, type SavedPromo } from "@/components/promotions/workspace";
import { PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { businessDate } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { promoToInput } from "@/lib/promotions/form";
import { getMenu } from "@/lib/repositories/menu";
import { listPromotions } from "@/lib/repositories/promotions";

export const metadata: Metadata = { title: "Promotions", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Rows, products and today's date — captured together, not read during render. */
async function snapshot(orgId: string) {
  const [promotions, menu] = await Promise.all([listPromotions(orgId), getMenu(null)]);
  return { promotions, menu, today: businessDate(new Date()) };
}

/**
 * CUSTOMERS › Promotions — the library and the editor (`Promotions.dc.html`,
 * IQ view). Seeing them takes `orders.discount` (if you may apply a code at
 * the counter, you may see the codes); changing them takes
 * `promotions.manage`, because a promotion changes what an order costs.
 */
export default async function PromotionsPage() {
  const staff = await requireStaff();
  const [canView, canEdit] = await Promise.all([staffCan("orders.discount"), staffCan("promotions.manage")]);
  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view promotions" />
      </div>
    );
  }

  const { promotions, menu, today } = await snapshot(staff.orgId);

  const promos: SavedPromo[] = promotions.map(({ promo, performance }) => ({
    input: { ...promoToInput(promo), id: promo.id },
    meta: { status: promo.status, liveSince: promo.liveSince?.toISOString() ?? null, usageCount: promo.usageCount },
    performance: { orders: performance.orders, revenue: formatINR(performance.revenue, "whole"), discountGiven: formatINR(performance.discountGiven, "whole") },
  }));

  const products = menu.flatMap((category) =>
    category.products.map((product) => ({ slug: product.slug, name: product.name, category: category.name, priceRupees: (Number(product.price) / 100).toString() })),
  );

  return (
    <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-6 px-[var(--gutter)] py-8">
      <PromotionsWorkspace promos={promos} products={products} today={today} canEdit={canEdit} />
    </div>
  );
}
