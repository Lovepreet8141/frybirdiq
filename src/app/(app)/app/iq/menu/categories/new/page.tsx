import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaff, staffCan } from "@/lib/auth";
import { CategoryForm } from "@/components/iq/menu/category-form";

export const metadata: Metadata = { title: "New category — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewCategoryPage() {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("menu.edit"))) redirect("/app/iq/menu");

  return (
    <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-8">
      <Link href="/app/iq/menu" className="text-sm text-muted-foreground underline underline-offset-2">
        ← Menu Control Center
      </Link>
      <h1 className="mt-3 font-heading text-2xl font-bold tracking-tight">New category</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Saves as a draft — it won&apos;t show on the website or the counter until you publish it from the review screen.
      </p>
      <div className="mt-6">
        <CategoryForm />
      </div>
    </div>
  );
}
