import type { Metadata } from "next";
import { IngredientsTable } from "@/components/inventory/ingredients-table";
import { MiniStat } from "@/components/staff/mini-stat";
import { PageHeader } from "@/components/staff/page-header";
import { PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { listIngredients, listSuppliers } from "@/lib/repositories/inventory";

export const metadata: Metadata = { title: "Ingredients", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * INVENTORY › Ingredients. docs/INVENTORY-ARCHITECTURE.md §12 step 2 —
 * master data. `inventory.view` reads; adding and editing re-check
 * `purchasing.manage` inside every action regardless of the button.
 */
export default async function IngredientsPage() {
  const staff = await requireStaff();
  const [canView, canManage] = await Promise.all([staffCan("inventory.view"), staffCan("purchasing.manage")]);
  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view inventory" />
      </div>
    );
  }

  const [ingredients, suppliers] = await Promise.all([listIngredients(staff.orgId), listSuppliers(staff.orgId)]);
  const priced = ingredients.filter((row) => row.costPerBaseUnit !== 0n).length;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader title="Ingredients" description="What the kitchen buys, in the unit a recipe measures it in, and what each usable unit really costs after yield and waste." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MiniStat label="Ingredients" value={String(ingredients.length)} hint={`${ingredients.filter((row) => row.isActive).length} active`} />
        <MiniStat label="Priced" value={`${priced} / ${ingredients.length}`} hint="Have at least one recorded price" />
        <MiniStat label="Packaging items" value={String(ingredients.filter((row) => row.isPackaging).length)} hint="Costed into products, never eaten" />
        <MiniStat label="Suppliers" value={String(suppliers.filter((row) => row.isActive).length)} hint="Active" />
      </div>

      <IngredientsTable
        ingredients={ingredients.map((row) => ({ ...row, lastPricedAt: row.lastPricedAt?.toISOString() ?? null }))}
        suppliers={suppliers.filter((row) => row.isActive).map((row) => ({ id: row.id, name: row.name }))}
        canManage={canManage}
      />
    </div>
  );
}
