import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaff, staffCan } from "@/lib/auth";
import { getMenuHealth, listCategoriesAdmin, listDraftItems, listProductsAdmin } from "@/lib/repositories/menu-admin";
import { MenuControlCenter } from "@/components/iq/menu/menu-control-center";
import { PermissionDenied } from "@/components/states";

export const metadata: Metadata = { title: "Menu Manager — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function HealthTile({ label, value, tone }: { label: string; value: string | number; tone?: "warning" | "destructive" }) {
  return (
    <div className="flex flex-col gap-0.5 border-r border-border px-4 py-3 last:border-0">
      <p className="tabular font-heading text-2xl font-bold leading-none" style={tone ? { color: `var(--${tone})` } : undefined}>
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
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
    <div className="mx-auto w-full max-w-7xl px-[var(--gutter)] py-8">
      <Link href="/app/iq" className="text-sm text-muted-foreground underline underline-offset-2">
        ← FRYBIRD IQ
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">Menu Control Center</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The single source the website, the counter and every future ordering surface read from.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/app/iq/menu/media" className="inline-flex min-h-[40px] items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-surface-muted">
            Media library
          </Link>
          <Link href="/app/iq/menu/modifiers" className="inline-flex min-h-[40px] items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-surface-muted">
            Modifiers
          </Link>
          <Link href="/app/iq/menu/combos" className="inline-flex min-h-[40px] items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-surface-muted">
            Combos
          </Link>
          <Link
            href="/app/iq/menu/review"
            className={
              drafts.length > 0
                ? "inline-flex min-h-[40px] items-center rounded-md bg-[var(--warning)]/20 px-4 text-sm font-semibold text-[var(--warning)]"
                : "inline-flex min-h-[40px] items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-surface-muted"
            }
          >
            Review changes{drafts.length > 0 ? ` (${drafts.length})` : ""}
          </Link>
        </div>
      </div>

      {/* Menu health */}
      <div className="mt-6 flex flex-wrap items-center rounded-lg border border-border bg-surface">
        <div className="flex flex-col gap-0.5 border-r border-border px-4 py-3">
          <p className="tabular font-heading text-2xl font-bold leading-none">{health.completenessPct}%</p>
          <p className="text-xs text-muted-foreground">Menu complete</p>
        </div>
        <HealthTile label="Products" value={health.totalProducts} />
        <HealthTile label="With photos" value={`${health.withPhotos}/${health.totalProducts}`} tone={health.withPhotos < health.totalProducts ? "warning" : undefined} />
        <HealthTile label="With descriptions" value={`${health.withDescriptions}/${health.totalProducts}`} tone={health.withDescriptions < health.totalProducts ? "warning" : undefined} />
        <HealthTile label="With modifiers" value={health.withModifiers} />
        <HealthTile label="Unavailable now" value={health.unavailable} tone={health.unavailable > 0 ? "destructive" : undefined} />
        <HealthTile label="Drafts" value={health.drafts} tone={health.drafts > 0 ? "warning" : undefined} />
        <HealthTile label="Missing tax rate" value={health.missingTaxRate} tone={health.missingTaxRate > 0 ? "destructive" : undefined} />
      </div>

      <MenuControlCenter categories={categories} products={products} canEdit={canEdit} canPublish={canPublish} />
    </div>
  );
}
