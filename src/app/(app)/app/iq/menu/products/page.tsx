import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaff, staffCan } from "@/lib/auth";
import { formatINR } from "@/lib/money";
import { listCategoriesAdmin, listProductsAdmin } from "@/lib/repositories/menu-admin";
import { PermissionDenied } from "@/components/states";

export const metadata: Metadata = { title: "Products — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string }> }) {
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
  const { q = "", category = "" } = await searchParams;
  const [products, categories] = await Promise.all([
    listProductsAdmin(staff.orgId, { search: q, categoryId: category || undefined }),
    listCategoriesAdmin(staff.orgId),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl px-[var(--gutter)] py-8">
      <Link href="/app/iq/menu" className="text-sm text-muted-foreground underline underline-offset-2">
        ← Menu Manager
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-tight">Products</h1>
        {canEdit && (
          <Link
            href="/app/iq/menu/products/new"
            className="inline-flex min-h-[40px] items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            + New product
          </Link>
        )}
      </div>

      <form method="get" className="mt-6 flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by name or SKU"
          className="h-[40px] flex-1 min-w-[200px] rounded-md border border-border bg-surface px-3 text-sm"
        />
        <select name="category" defaultValue={category} className="h-[40px] rounded-md border border-border bg-surface px-3 text-sm">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="submit" className="h-[40px] rounded-md border border-border px-4 text-sm font-semibold hover:bg-surface-muted">
          Filter
        </button>
      </form>

      <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface px-4">
        {products.length === 0 ? (
          <li className="py-8 text-center text-sm text-muted-foreground">No products match.</li>
        ) : (
          products.map((product) => (
            <li key={product.id} className="flex items-center justify-between gap-3 py-3">
              <Link href={`/app/iq/menu/products/${product.id}`} className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-semibold hover:underline">{product.name}</span>
                  {product.status === "DRAFT" && (
                    <span className="rounded-full bg-[var(--warning)]/20 px-2 py-0.5 text-xs font-semibold text-[var(--warning)]">Draft</span>
                  )}
                  {!product.isActive && <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">Archived</span>}
                </span>
                <p className="text-sm text-muted-foreground">
                  {product.categoryName ?? "Uncategorised"}
                  {product.sku ? ` · ${product.sku}` : ""}
                </p>
              </Link>
              <span className="tabular text-sm font-semibold">{formatINR(product.basePrice)}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
