import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaff, staffCan } from "@/lib/auth";
import { listProductsAdmin } from "@/lib/repositories/menu-admin";
import { PermissionDenied } from "@/components/states";

export const metadata: Metadata = { title: "Combos — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * A combo is a regular product that bundles others (see `comboItems` in
 * `src/db/schema/menu.ts`) — there is no separate "combo" entity, so this is
 * the product list again, pointed at each product's combo contents instead
 * of its details.
 */
export default async function CombosPage() {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("menu.view"))) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="manage the menu" />
      </div>
    );
  }

  const products = await listProductsAdmin(staff.orgId);

  return (
    <div className="mx-auto w-full max-w-3xl px-[var(--gutter)] py-8">
      <Link href="/app/iq/menu" className="text-sm text-muted-foreground underline underline-offset-2">
        ← Menu Control Center
      </Link>
      <h1 className="mt-3 font-heading text-3xl font-bold tracking-tight">Combos</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick which product is the combo, then choose what it bundles. Any product can be a combo container.
      </p>

      <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface px-4">
        {products.map((product) => (
          <li key={product.id} className="flex items-center justify-between gap-3 py-3">
            <span className="font-semibold">{product.name}</span>
            <Link href={`/app/iq/menu/combos/${product.id}`} className="text-sm font-semibold text-primary hover:underline">
              Manage items →
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
