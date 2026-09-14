import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IngredientForm } from "@/components/inventory/ingredient-form";
import { PriceForm } from "@/components/inventory/price-form";
import { MiniStat } from "@/components/staff/mini-stat";
import { PageHeader } from "@/components/staff/page-header";
import { PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { unitLabel } from "@/lib/iq/units";
import { formatBps, formatINR } from "@/lib/money";
import { getIngredient, listSuppliers } from "@/lib/repositories/inventory";

export const metadata: Metadata = { title: "Ingredient", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const UNIT = { G: "g", ML: "ml", PIECE: "pc" } as const;

export default async function IngredientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const [{ id }, { created }] = await Promise.all([params, searchParams]);
  const staff = await requireStaff();
  const [canView, canManage] = await Promise.all([staffCan("inventory.view"), staffCan("purchasing.manage")]);
  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view inventory" />
      </div>
    );
  }

  const [ingredient, suppliers] = await Promise.all([getIngredient(staff.orgId, id), listSuppliers(staff.orgId)]);
  if (!ingredient) notFound();

  const unit = UNIT[ingredient.baseUnit];
  const supplierOptions = suppliers.filter((row) => row.isActive).map((row) => ({ id: row.id, name: row.name }));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title={ingredient.name}
        description={[ingredient.sku, ingredient.isPackaging ? "Packaging" : "Ingredient", `measured in ${unitLabel(ingredient.baseUnit)}`].filter(Boolean).join(" · ")}
      />
      {created && (
        <p role="status" className="border-l-2 border-[var(--success)] bg-surface px-4 py-3 text-sm">
          Ingredient added. Record what you last paid for it so recipes can be costed.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MiniStat
          label="Usable cost"
          value={ingredient.costPerBaseUnit === 0n ? "—" : `${formatINR(ingredient.costPerBaseUnit)} / ${unit}`}
          hint={ingredient.costPerBaseUnit === 0n ? "No price recorded yet" : `${ingredient.costPerBaseUnitMilli.toString()} millipaise, exact`}
        />
        <MiniStat label="Yield" value={formatBps(ingredient.yieldBps, 0)} hint="Survives trimming" />
        <MiniStat label="Waste" value={formatBps(ingredient.wasteBps, 1)} hint="Lost after prep" />
        <MiniStat label="On hand" value={`${ingredient.onHand} ${unit}`} hint="Stock movements are a later slice" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="flex flex-col gap-4">
            <h2 className="font-heading text-lg font-semibold">Record a price</h2>
            {canManage ? (
              <PriceForm ingredientId={ingredient.id} baseUnit={ingredient.baseUnit} suppliers={supplierOptions} defaultSupplierId={ingredient.supplierId} />
            ) : (
              <p className="text-sm text-muted-foreground">Recording a price needs the purchasing permission.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-4">
            <h2 className="font-heading text-lg font-semibold">Details</h2>
            {canManage ? (
              <IngredientForm
                initial={{
                  id: ingredient.id,
                  name: ingredient.name,
                  sku: ingredient.sku,
                  baseUnit: ingredient.baseUnit,
                  yieldBps: ingredient.yieldBps,
                  wasteBps: ingredient.wasteBps,
                  supplierId: ingredient.supplierId,
                  isPackaging: ingredient.isPackaging,
                  isActive: ingredient.isActive,
                }}
                suppliers={supplierOptions}
                lockBaseUnit={ingredient.prices.length > 0 || ingredient.recipeLineCount > 0}
              />
            ) : (
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Supplier</dt><dd>{ingredient.supplierName ?? "—"}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Status</dt><dd>{ingredient.isActive ? "Active" : "Inactive"}</dd></div>
              </dl>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold">Price history</h2>
        {ingredient.prices.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">No prices recorded yet.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-panel">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Bought</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Usable cost</TableHead>
                  <TableHead className="hidden sm:table-cell">From</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ingredient.prices.map((price) => (
                  <TableRow key={price.id}>
                    <TableCell className="tabular text-muted-foreground">{price.effectiveFrom.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}</TableCell>
                    <TableCell className="tabular">
                      {price.purchaseQuantity} {unitLabel(price.purchaseUnit)}
                    </TableCell>
                    <TableCell className="tabular text-right">{formatINR(price.purchaseCost)}</TableCell>
                    <TableCell className="tabular text-right font-semibold">
                      {formatINR(price.costPerBaseUnit)} / {unit}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">{price.supplierName ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
