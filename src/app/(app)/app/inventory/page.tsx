import type { Metadata } from "next";
import Link from "next/link";
import { Truck } from "lucide-react";
import { IngredientsTable } from "@/components/inventory/ingredients-table";
import { BarList, type BarRow, type Capability, CapabilityPanel, DataTrust, KpiTile, Panel, PanelBody, PanelHeader, SectionHeading, StatusWord } from "@/components/iq/ui";
import { PageHeader } from "@/components/staff/page-header";
import { PermissionDenied } from "@/components/states";
import { Button } from "@/components/ui/button";
import { requireStaff, staffCan } from "@/lib/auth";
import { STALE_PRICE_DAYS, inventoryAttention } from "@/lib/inventory/attention";
import { listIngredients, listSuppliers } from "@/lib/repositories/inventory";

export const metadata: Metadata = { title: "Inventory", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const ATTENTION_SHOWN = 6;

/** Which ledgers exist behind this screen, and which roadmap slice (docs/ROADMAP.md, Phase 3) connects the rest. */
const CAPABILITIES: readonly Capability[] = [
  { name: "Ingredients and suppliers", connected: true, note: "Master data, editable under purchasing" },
  { name: "Price records and usable cost", connected: true, note: "Every price recorded moves the ingredient's cost" },
  { name: "Stock on hand and movements", connected: false, note: "Needs receive, adjust and count — roadmap 3.2" },
  { name: "Waste log", connected: false, note: "Roadmap 3.3" },
  { name: "Consumption on order", connected: false, note: "Roadmap 3.4, after recipes" },
  { name: "Purchase orders and receiving", connected: false, note: "Roadmap 3.7" },
];

/**
 * INVENTORY — the workspace. Reads only the master data that exists
 * (ingredients, suppliers, price records) and says plainly which ledgers
 * are not connected yet rather than rendering their zeros as facts.
 * `inventory.view` reads; adding and pricing re-check `purchasing.manage`
 * inside every action regardless of what rendered.
 */
export default async function InventoryPage() {
  const staff = await requireStaff();
  const [canView, canManage, canExport] = await Promise.all([staffCan("inventory.view"), staffCan("purchasing.manage"), staffCan("reports.export")]);
  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view inventory" />
      </div>
    );
  }

  const [ingredients, suppliers] = await Promise.all([listIngredients(staff.orgId), listSuppliers(staff.orgId)]);
  const now = new Date();

  const active = ingredients.filter((row) => row.isActive);
  const packaging = ingredients.filter((row) => row.isPackaging).length;
  const priced = ingredients.filter((row) => row.costPerBaseUnit !== 0n).length;
  const unpriced = ingredients.length - priced;
  const activeSuppliers = suppliers.filter((row) => row.isActive);
  const unsourced = active.filter((row) => row.supplierId === null).length;

  const attention = inventoryAttention(ingredients, now);
  const shown = attention.slice(0, ATTENTION_SHOWN);

  const sourced = ingredients.filter((row) => row.supplierId !== null).length;
  const supplierRows: BarRow[] = activeSuppliers
    .filter((row) => row.ingredientCount > 0)
    .sort((a, b) => b.ingredientCount - a.ingredientCount)
    .slice(0, 5)
    .map((row) => ({
      key: row.id,
      label: row.name,
      share: sourced === 0 ? 0 : row.ingredientCount / sourced,
      shareLabel: sourced === 0 ? "—" : `${Math.round((row.ingredientCount / sourced) * 100)}%`,
      amount: `${row.ingredientCount} ${row.ingredientCount === 1 ? "item" : "items"}`,
    }));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title="Inventory"
        description="What the kitchen buys, who it comes from, and what each usable unit really costs after yield and waste."
        actions={
          <Button variant="outline" asChild>
            <Link href="/app/inventory/suppliers">
              <Truck data-icon="inline-start" aria-hidden="true" />
              Suppliers
            </Link>
          </Button>
        }
      />

      <DataTrust
        items={[
          { tone: "gain", text: `Master data live · ${ingredients.length} ${ingredients.length === 1 ? "ingredient" : "ingredients"}, ${activeSuppliers.length} active ${activeSuppliers.length === 1 ? "supplier" : "suppliers"}` },
          { tone: "flag", text: "Stock, waste and purchasing not connected" },
        ]}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile label="Ingredients" value={String(ingredients.length)} note={ingredients.length === 0 ? "None yet" : `${active.length} active · ${packaging} packaging`} link={{ label: "See the list", href: "#ingredients" }} />
        <KpiTile
          label="Priced"
          meta={ingredients.length > 0 ? `of ${ingredients.length}` : undefined}
          value={String(priced)}
          note={ingredients.length === 0 ? "Record a price once an ingredient exists" : unpriced === 0 ? "Every ingredient has a recorded price" : `${unpriced} still ${unpriced === 1 ? "needs" : "need"} a price before recipes can be costed`}
          emphasis={unpriced > 0}
        />
        <KpiTile
          label="Suppliers"
          value={String(activeSuppliers.length)}
          note={activeSuppliers.length === 0 ? "No active suppliers yet" : unsourced === 0 ? "Every active ingredient has a usual supplier" : `${unsourced} active ${unsourced === 1 ? "ingredient has" : "ingredients have"} no usual supplier`}
          link={{ label: "Suppliers", href: "/app/inventory/suppliers" }}
        />
        <KpiTile label="Stock on hand" value="—" missing note="Needs stock movements — receive, adjust and count (roadmap 3.2). Nothing here is a real quantity yet." />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader
            title="Needs attention"
            description={`From prices and suppliers only. A price older than ${STALE_PRICE_DAYS} days counts as stale.`}
            meta={attention.length > 0 ? `${attention.length} ${attention.length === 1 ? "item" : "items"}` : undefined}
          />
          <PanelBody className="pt-0">
            {attention.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
                {ingredients.length === 0 ? "Nothing to check until an ingredient exists." : "Nothing needs attention. Every active ingredient is priced, fresh and sourced."}
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {shown.map((item) => (
                  <li key={`${item.kind}-${item.ingredientId}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                    <StatusWord tone={item.kind === "unpriced" ? "loss" : "flag"} className="text-foreground">
                      <Link href={`/app/inventory/ingredients/${item.ingredientId}`} className="font-medium hover:underline">
                        {item.name}
                      </Link>
                    </StatusWord>
                    <span className="pl-[15px] text-[13px] text-muted-foreground sm:pl-0">{item.detail}</span>
                  </li>
                ))}
              </ul>
            )}
            {attention.length > ATTENTION_SHOWN && <p className="mt-3 text-[12.5px] text-muted-foreground">+{attention.length - ATTENTION_SHOWN} more — filter the list below by “No price yet” to work through them.</p>}
          </PanelBody>
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel>
            <PanelHeader title="Where ingredients come from" meta={sourced > 0 ? `${sourced} of ${ingredients.length} sourced` : undefined} />
            <PanelBody className="pt-0">
              {supplierRows.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-[13px] text-muted-foreground">
                  {activeSuppliers.length === 0 ? "No suppliers yet." : "No ingredient names a supplier yet."}
                </p>
              ) : (
                <BarList rows={supplierRows} />
              )}
            </PanelBody>
          </Panel>
          <CapabilityPanel items={CAPABILITIES} />
        </div>
      </div>

      <section id="ingredients" className="flex scroll-mt-24 flex-col gap-4">
        <SectionHeading title="Ingredients" note="Usable cost is per base unit, at full paise, because bulk ingredients genuinely cost fractions of a rupee per gram." />
        <IngredientsTable
          ingredients={ingredients.map((row) => ({
            id: row.id,
            name: row.name,
            sku: row.sku,
            baseUnit: row.baseUnit,
            costPerBaseUnit: row.costPerBaseUnit,
            yieldBps: row.yieldBps,
            wasteBps: row.wasteBps,
            isPackaging: row.isPackaging,
            isActive: row.isActive,
            supplierName: row.supplierName,
            lastPricedAt: row.lastPricedAt?.toISOString() ?? null,
          }))}
          suppliers={activeSuppliers.map((row) => ({ id: row.id, name: row.name }))}
          canManage={canManage}
          canExport={canExport}
        />
      </section>
    </div>
  );
}
