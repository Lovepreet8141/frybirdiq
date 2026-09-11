import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getStaff, staffCan } from "@/lib/auth";
import { getProductAdmin, listComboItems, listModifierGroupsAdmin, listProductsAdmin } from "@/lib/repositories/menu-admin";
import { formatINR, paise } from "@/lib/money";
import { ComboItemsForm } from "@/components/iq/menu/combo-items-form";
import { ProductModifiersForm } from "@/components/iq/menu/product-modifiers-form";

export const metadata: Metadata = { title: "Combo items — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ComboItemsPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("menu.view"))) redirect("/app/iq/menu/combos");

  const { id } = await params;
  const [products, items, groups, comboDetail] = await Promise.all([
    listProductsAdmin(staff.orgId),
    listComboItems(staff.orgId, id),
    listModifierGroupsAdmin(staff.orgId),
    getProductAdmin(staff.orgId, id),
  ]);
  const combo = products.find((p) => p.id === id);
  if (!combo || !comboDetail) notFound();
  if (comboDetail.productType !== "COMBO") redirect(`/app/iq/menu/products/${id}`);

  const candidates = products.filter((p) => p.id !== id);
  const itemsTotal = items.reduce((sum, item) => sum + (products.find((p) => p.id === item.productId)?.basePrice ?? 0n) * BigInt(item.quantity), 0n);
  const savings = itemsTotal - combo.basePrice;

  return (
    <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-8">
      <Link href="/app/iq/menu/combos" className="text-sm text-muted-foreground underline underline-offset-2">
        ← Combos
      </Link>
      <h1 className="mt-3 font-heading text-2xl font-bold tracking-tight">{combo.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        <Link href={`/app/iq/menu/products/${id}`} className="text-primary underline">
          Edit the combo&apos;s own details and price
        </Link>
        .
      </p>

      <section className="mt-6">
        <h2 className="font-heading text-lg font-bold">Fixed items</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Always included in this combo, at the fixed quantity shown.</p>
        <div className="mt-3">
          <ComboItemsForm comboProductId={id} items={items} candidates={candidates.map((c) => ({ id: c.id, name: c.name }))} />
        </div>
        {items.length > 0 && (
          <div className="mt-3 flex items-center justify-between rounded-md border border-border bg-surface-muted px-3 py-2 text-sm">
            <span>
              Items priced separately: <span className="tabular font-semibold">{formatINR(paise(itemsTotal))}</span> vs combo price{" "}
              <span className="tabular font-semibold">{formatINR(combo.basePrice)}</span>
            </span>
            <span className={`tabular font-semibold ${savings > 0n ? "text-[var(--success)]" : "text-[var(--destructive)]"}`}>
              {savings > 0n ? `Saves ${formatINR(paise(savings))}` : "No savings set"}
            </span>
          </div>
        )}
      </section>

      <section className="mt-8 border-t border-border pt-6">
        <h2 className="font-heading text-lg font-bold">Choose-one / choose-any / upgrades</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          &quot;Choose your side&quot;, &quot;extra toppings&quot;, &quot;upgrade to large&quot; — these are modifier groups, the exact mechanism every product uses, so they price through
          the same engine. Set required/optional and min/max on a group in{" "}
          <Link href="/app/iq/menu/modifiers" className="text-primary underline">
            Modifiers
          </Link>
          , then assign it here.
        </p>
        <div className="mt-3">
          <ProductModifiersForm productId={id} groups={groups.map((g) => ({ id: g.id, name: g.name, status: g.status }))} initialSelected={comboDetail.modifierGroupIds} />
        </div>
      </section>
    </div>
  );
}
