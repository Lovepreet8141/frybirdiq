import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getStaff, staffCan } from "@/lib/auth";
import { getCategoryAdmin } from "@/lib/repositories/menu-admin";
import { CategoryForm } from "@/components/iq/menu/category-form";

export const metadata: Metadata = { title: "Edit category — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function EditCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("menu.view"))) redirect("/app/iq/menu");

  const { id } = await params;
  const category = await getCategoryAdmin(staff.orgId, id);
  if (!category) notFound();

  return (
    <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-8">
      <Link href="/app/iq/menu" className="text-sm text-muted-foreground underline underline-offset-2">
        ← Menu Manager
      </Link>
      <h1 className="mt-3 font-heading text-2xl font-bold tracking-tight">{category.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {category.status === "DRAFT" ? "Draft — not visible yet." : "Live."} Changes here take effect immediately on save.
      </p>
      <div className="mt-6">
        <CategoryForm id={id} initial={category} />
      </div>
    </div>
  );
}
