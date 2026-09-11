import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaff, staffCan } from "@/lib/auth";
import { listCategoriesAdmin } from "@/lib/repositories/menu-admin";
import { ProductCreateForm } from "@/components/iq/menu/product-create-form";

export const metadata: Metadata = { title: "New product — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("menu.edit"))) redirect("/app/iq/menu/products");

  const categories = await listCategoriesAdmin(staff.orgId);

  return (
    <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-8">
      <Link href="/app/iq/menu/products" className="text-sm text-muted-foreground underline underline-offset-2">
        ← Products
      </Link>
      <h1 className="mt-3 font-heading text-2xl font-bold tracking-tight">New product</h1>
      <p className="mt-1 text-sm text-muted-foreground">Starts as a draft. Everything else — price, photos, modifiers — is set on the next screen.</p>
      <div className="mt-6">
        <ProductCreateForm categories={categories.map((c) => ({ id: c.id, name: c.name }))} />
      </div>
    </div>
  );
}
