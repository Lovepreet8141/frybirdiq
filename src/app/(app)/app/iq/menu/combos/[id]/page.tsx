import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getStaff, staffCan } from "@/lib/auth";
import { listComboItems, listProductsAdmin } from "@/lib/repositories/menu-admin";
import { ComboItemsForm } from "@/components/iq/menu/combo-items-form";

export const metadata: Metadata = { title: "Combo items — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ComboItemsPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("menu.view"))) redirect("/app/iq/menu/combos");

  const { id } = await params;
  const [products, items] = await Promise.all([listProductsAdmin(staff.orgId), listComboItems(staff.orgId, id)]);
  const combo = products.find((p) => p.id === id);
  if (!combo) notFound();

  const candidates = products.filter((p) => p.id !== id);

  return (
    <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-8">
      <Link href="/app/iq/menu/combos" className="text-sm text-muted-foreground underline underline-offset-2">
        ← Combos
      </Link>
      <h1 className="mt-3 font-heading text-2xl font-bold tracking-tight">{combo.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        What&apos;s bundled in this combo.{" "}
        <Link href={`/app/iq/menu/products/${id}`} className="text-primary underline">
          Edit the combo&apos;s own details and price
        </Link>
        .
      </p>

      <div className="mt-6">
        <ComboItemsForm comboProductId={id} items={items} candidates={candidates.map((c) => ({ id: c.id, name: c.name }))} />
      </div>
    </div>
  );
}
