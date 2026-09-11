import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaff, staffCan } from "@/lib/auth";
import { listCategoriesAdmin, listDraftItems } from "@/lib/repositories/menu-admin";
import { CategoryRow } from "@/components/iq/menu/category-row";
import { PermissionDenied } from "@/components/states";

export const metadata: Metadata = { title: "Menu Manager — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The Menu Manager's home: categories, in menu order, with the review queue
 * and the other sections one click away. Every product/modifier/combo
 * screen hangs off this page rather than its own top-level nav entry — the
 * category list is the thing staff open most.
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

  const canEdit = await staffCan("menu.edit");
  const canPublish = await staffCan("menu.publish");
  const [categories, drafts] = await Promise.all([listCategoriesAdmin(staff.orgId), listDraftItems(staff.orgId)]);

  return (
    <div className="mx-auto w-full max-w-4xl px-[var(--gutter)] py-8">
      <Link href="/app/iq" className="text-sm text-muted-foreground underline underline-offset-2">
        ← FRYBIRD IQ
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">Menu Manager</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The one place the website, the counter and — later — a kitchen display and delivery partners all read the menu from.
          </p>
        </div>
        {drafts.length > 0 && (
          <Link
            href="/app/iq/menu/review"
            className="inline-flex min-h-[40px] items-center rounded-md bg-[var(--warning)]/20 px-4 text-sm font-semibold text-[var(--warning)]"
          >
            {drafts.length} unpublished {drafts.length === 1 ? "change" : "changes"}
          </Link>
        )}
      </div>

      <nav aria-label="Menu Manager sections" className="mt-6 flex flex-wrap gap-4 text-sm font-semibold">
        <span aria-current="page" className="text-foreground">Categories</span>
        <Link href="/app/iq/menu/products" className="text-muted-foreground transition-colors hover:text-foreground">
          Products
        </Link>
        <Link href="/app/iq/menu/modifiers" className="text-muted-foreground transition-colors hover:text-foreground">
          Modifiers
        </Link>
        <Link href="/app/iq/menu/combos" className="text-muted-foreground transition-colors hover:text-foreground">
          Combos
        </Link>
      </nav>

      {canEdit && (
        <Link
          href="/app/iq/menu/categories/new"
          className="mt-6 inline-flex min-h-[40px] items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-surface-muted"
        >
          + New category
        </Link>
      )}

      <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface px-4">
        {categories.length === 0 ? (
          <li className="py-8 text-center text-sm text-muted-foreground">No categories yet.</li>
        ) : (
          categories.map((category) => <CategoryRow key={category.id} category={category} canPublish={canPublish} />)
        )}
      </ul>
    </div>
  );
}
