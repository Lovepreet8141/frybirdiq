import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Panel, PanelBody, PanelHeader } from "@/components/iq/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IngredientForm } from "@/components/inventory/ingredient-form";
import { PriceForm } from "@/components/inventory/price-form";
import { StockMovementForms } from "@/components/inventory/stock-forms";
import { MiniStat } from "@/components/staff/mini-stat";
import { PageHeader } from "@/components/staff/page-header";
import { EmptyState, PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { unitLabel } from "@/lib/iq/units";
import { formatBps, formatINR } from "@/lib/money";
import { getIngredient, listSuppliers } from "@/lib/repositories/inventory";
import { listMovements, type MovementType } from "@/lib/repositories/stock";

export const metadata: Metadata = { title: "Ingredient", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const UNIT = { G: "g", ML: "ml", PIECE: "pc" } as const;

const MOVEMENT_TYPE_LABEL: Record<MovementType, string> = {
  PURCHASE: "Received",
  SALE: "Sold",
  WASTE: "Waste",
  ADJUSTMENT: "Adjusted",
  TRANSFER: "Transfer",
  RETURN: "Return",
};

export default async function IngredientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const [{ id }, { created }] = await Promise.all([params, searchParams]);
  const staff = await requireStaff();
  const [canView, canManage, canAdjustStock] = await Promise.all([staffCan("inventory.view"), staffCan("purchasing.manage"), staffCan("inventory.adjust")]);
  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view inventory" />
      </div>
    );
  }

  const [ingredient, suppliers] = await Promise.all([getIngredient(staff.orgId, id), listSuppliers(staff.orgId)]);
  if (!ingredient) notFound();

  const movements = await listMovements(staff.orgId, ingredient.id);

  const unit = UNIT[ingredient.baseUnit];
  const supplierOptions = suppliers.filter((row) => row.isActive).map((row) => ({ id: row.id, name: row.name }));
  const onHandLabel = new Intl.NumberFormat("en-IN").format(ingredient.onHand);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title={ingredient.name}
        description={[ingredient.sku, ingredient.isPackaging ? "Packaging" : "Ingredient", `measured in ${unitLabel(ingredient.baseUnit)}`].filter(Boolean).join(" · ")}
      />
      {created && (
        <p role="status" className="rounded-md border-l-2 border-gain bg-gain-soft/60 px-4 py-3 text-sm">
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
        <MiniStat
          label="On hand"
          value={`${onHandLabel} ${unit}`}
          hint={ingredient.onHand === 0 ? "No stock recorded yet" : "From received, adjusted and counted movements"}
        />
      </div>

      <Panel id="stock" className="scroll-mt-24">
        <PanelHeader title="Stock" description="Receive a delivery, correct a count, or record what's actually on the shelf." />
        <PanelBody>
          {canAdjustStock ? (
            <StockMovementForms ingredientId={ingredient.id} baseUnit={ingredient.baseUnit} suppliers={supplierOptions} defaultSupplierId={ingredient.supplierId} />
          ) : (
            <p className="text-sm text-muted-foreground">Recording stock needs the inventory adjustment permission.</p>
          )}
        </PanelBody>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel id="price" className="scroll-mt-24">
          <PanelHeader title="Record a price" description="What you last paid, in the unit you bought it in. Usable cost follows from yield and waste." />
          <PanelBody>
            {canManage ? (
              <PriceForm ingredientId={ingredient.id} baseUnit={ingredient.baseUnit} suppliers={supplierOptions} defaultSupplierId={ingredient.supplierId} />
            ) : (
              <p className="text-sm text-muted-foreground">Recording a price needs the purchasing permission.</p>
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Details" />
          <PanelBody>
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
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Price history" meta={ingredient.prices.length === 0 ? undefined : `${ingredient.prices.length} ${ingredient.prices.length === 1 ? "price" : "prices"}`} />
        {ingredient.prices.length === 0 ? (
          <PanelBody>
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No prices recorded yet.</p>
          </PanelBody>
        ) : (
          <PanelBody flush className="border-t border-border pb-0">
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
          </PanelBody>
        )}
      </Panel>

      <Panel>
        <PanelHeader title="Movement history" meta={movements.length === 0 ? undefined : `${movements.length} recent`} />
        {movements.length === 0 ? (
          <PanelBody>
            <EmptyState title="No movements yet" detail="Receive stock, record an adjustment, or count what's on the shelf to start this ingredient's ledger." />
          </PanelBody>
        ) : (
          <PanelBody flush className="border-t border-border pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="hidden md:table-cell">Notes</TableHead>
                  <TableHead className="hidden sm:table-cell">By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((movement) => (
                  <TableRow key={movement.id}>
                    <TableCell className="tabular text-muted-foreground">
                      {movement.occurredAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                    </TableCell>
                    <TableCell>{MOVEMENT_TYPE_LABEL[movement.type]}</TableCell>
                    <TableCell className={`tabular text-right font-semibold ${movement.quantityBase < 0 ? "text-loss" : "text-gain"}`}>
                      {movement.quantityBase > 0 ? "+" : ""}
                      {new Intl.NumberFormat("en-IN").format(movement.quantityBase)} {unit}
                    </TableCell>
                    <TableCell className="tabular text-right">{movement.totalCost === 0n ? "—" : formatINR(movement.totalCost)}</TableCell>
                    <TableCell className="hidden max-w-[280px] truncate text-muted-foreground md:table-cell">{movement.notes ?? "—"}</TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">{movement.actorName ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </PanelBody>
        )}
      </Panel>
    </div>
  );
}
