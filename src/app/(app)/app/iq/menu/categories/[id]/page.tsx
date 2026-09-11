import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getStaff, staffCan } from "@/lib/auth";
import { getCategoryAdmin, listCategoryAvailabilityRules } from "@/lib/repositories/menu-admin";
import { CategoryForm } from "@/components/iq/menu/category-form";
import { CategoryAvailabilityForm } from "@/components/iq/menu/category-availability-form";

export const metadata: Metadata = { title: "Edit category — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function EditCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("menu.view"))) redirect("/app/iq/menu");

  const { id } = await params;
  const [category, rules] = await Promise.all([getCategoryAdmin(staff.orgId, id), listCategoryAvailabilityRules(staff.orgId, id)]);
  if (!category) notFound();

  return (
    <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-8">
      <Link href="/app/iq/menu" className="text-sm text-muted-foreground underline underline-offset-2">
        ← Menu Control Center
      </Link>
      <h1 className="mt-3 font-heading text-2xl font-bold tracking-tight">{category.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {category.status === "DRAFT" ? "Draft — not visible yet." : "Live."} Changes here take effect immediately on save. {category.productCount} {category.productCount === 1 ? "product" : "products"}.
      </p>
      <div className="mt-6 flex flex-col gap-8">
        <CategoryForm id={id} initial={category} />

        <section className="border-t border-border pt-6">
          <h2 className="font-heading text-lg font-bold">Channel visibility &amp; schedule</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Hide this whole category from a channel, or schedule when it comes back, without touching each product.</p>
          <div className="mt-4">
            <CategoryAvailabilityForm categoryId={id} rules={rules} />
          </div>
        </section>
      </div>
    </div>
  );
}
