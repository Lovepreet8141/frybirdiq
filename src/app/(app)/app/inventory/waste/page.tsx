import type { Metadata } from "next";
import { Panel, PanelBody, PanelHeader } from "@/components/iq/ui";
import { WasteForm } from "@/components/inventory/waste-form";
import { MiniStat } from "@/components/staff/mini-stat";
import { PageHeader } from "@/components/staff/page-header";
import { EmptyState, PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { formatINR } from "@/lib/money";
import { getWasteWeekTotal, listIngredientOptions } from "@/lib/repositories/stock";

export const metadata: Metadata = { title: "Record waste", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * A standalone, minimal waste-recording screen. Roadmap 3.3.
 *
 * Deliberately not a section of `/app/inventory/ingredients/[id]` — that
 * page gates its entire render on `inventory.view`, which KITCHEN does not
 * hold, but KITCHEN does hold `inventory.waste`
 * (docs/INVENTORY-ARCHITECTURE.md §3) and the roadmap is explicit that
 * KITCHEN must be able to record waste. This page gates only on
 * `inventory.waste` and shows nothing else about inventory — no cost, no
 * price history, no stock-on-hand for ingredients other than the one being
 * wasted.
 */
export default async function WastePage() {
  const staff = await requireStaff();
  const canWaste = await staffCan("inventory.waste");
  if (!canWaste) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="record waste" />
      </div>
    );
  }

  const [ingredients, weekTotal] = await Promise.all([listIngredientOptions(staff.orgId), getWasteWeekTotal(staff.orgId)]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader title="Record waste" description="Spoiled, dropped or over-prepped stock that never sold. Every entry lands on the ingredient's movement history." />

      <MiniStat
        label="This week's waste"
        value={weekTotal.entryCount === 0 ? "—" : formatINR(weekTotal.totalCost)}
        hint={weekTotal.entryCount === 0 ? "No waste recorded in the last 7 days" : `${weekTotal.entryCount} ${weekTotal.entryCount === 1 ? "entry" : "entries"} in the last 7 days`}
      />

      <Panel>
        <PanelHeader title="New entry" />
        <PanelBody>
          {ingredients.length === 0 ? (
            <EmptyState title="No ingredients yet" detail="Ask a manager to add ingredients before recording waste." />
          ) : (
            <WasteForm ingredients={ingredients} />
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
