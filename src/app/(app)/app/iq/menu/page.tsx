import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/staff/page-header";
import { getStaff, staffCan } from "@/lib/auth";
import { getMenuHealth, listCategoriesAdmin, listDraftItems, listProductsAdmin } from "@/lib/repositories/menu-admin";
import { MenuControlCenter } from "@/components/iq/menu/menu-control-center";
import { PermissionDenied } from "@/components/states";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Menu Manager — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** One health figure: the number in the serif, the label under it, a tone only when something needs doing. */
function HealthTile({ label, value, tone }: { label: string; value: string | number; tone?: "flag" | "loss" }) {
  return (
    <div className="flex min-w-[112px] flex-1 flex-col gap-1 border-r border-border px-4 py-3 last:border-r-0">
      <p className={cn("tabular font-money text-[28px] leading-none tracking-[-0.01em]", tone === "flag" && "text-flag", tone === "loss" && "text-loss")}>{value}</p>
      <p className="text-[12.5px] text-muted-foreground">{label}</p>
    </div>
  );
}

/**
 * The Menu Control Center: one screen for categories, products, health and
 * publishing — the single source of truth admin surface for the website,
 * POS, and every future ordering surface. §"MAIN MENU SCREEN".
 */
export default async function MenuManagerPage() {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("menu.view"))) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="manage the menu" />
      </div>
    );
  }

  const [canEdit, canPublish, categories, products, health, drafts] = await Promise.all([
    staffCan("menu.edit"),
    staffCan("menu.publish"),
    listCategoriesAdmin(staff.orgId),
    listProductsAdmin(staff.orgId),
    getMenuHealth(staff.orgId),
    listDraftItems(staff.orgId),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title="Menu Control Center"
        description="The single source the website, the counter and every future ordering surface read from."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/app/iq/menu/media">Media library</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/app/iq/menu/modifiers">Modifiers</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/app/iq/menu/combos">Combos</Link>
            </Button>
            <Button variant="outline" asChild className={cn(drafts.length > 0 && "border-flag/30 bg-flag-soft text-flag hover:bg-flag-soft/70")}>
              <Link href="/app/iq/menu/review">Review changes{drafts.length > 0 ? ` (${drafts.length})` : ""}</Link>
            </Button>
          </>
        }
      />

      {/* Menu health — one strip, the figures in the serif, a tone only where something is missing. */}
      <div className="flex flex-wrap rounded-xl border border-border bg-panel" aria-label="Menu health">
        <HealthTile label="Menu complete" value={`${health.completenessPct}%`} />
        <HealthTile label="Products" value={health.totalProducts} />
        <HealthTile label="With photos" value={`${health.withPhotos}/${health.totalProducts}`} tone={health.withPhotos < health.totalProducts ? "flag" : undefined} />
        <HealthTile label="With descriptions" value={`${health.withDescriptions}/${health.totalProducts}`} tone={health.withDescriptions < health.totalProducts ? "flag" : undefined} />
        <HealthTile label="With modifiers" value={health.withModifiers} />
        <HealthTile label="Unavailable now" value={health.unavailable} tone={health.unavailable > 0 ? "loss" : undefined} />
        <HealthTile label="Drafts" value={health.drafts} tone={health.drafts > 0 ? "flag" : undefined} />
        <HealthTile label="Missing tax rate" value={health.missingTaxRate} tone={health.missingTaxRate > 0 ? "loss" : undefined} />
      </div>

      <MenuControlCenter categories={categories} products={products} canEdit={canEdit} canPublish={canPublish} />
    </div>
  );
}
