"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CategoryAdminRow, ProductAdminRow } from "@/lib/repositories/menu-admin";
import { moveCategoryAction, publishCategoryAction, setCategoryActiveAction } from "@/lib/menu-admin/actions";
import { ActionButton } from "./action-button";
import { BulkActionBar } from "./bulk-action-bar";
import { ProductAdminCard } from "./product-admin-card";

type AvailabilityFilter = "all" | "available" | "unavailable";
type SortKey = "menu-order" | "az" | "price-asc" | "price-desc" | "newest";

export function MenuControlCenter({
  categories,
  products,
  canEdit,
  canPublish,
}: {
  categories: readonly CategoryAdminRow[];
  products: readonly ProductAdminRow[];
  canEdit: boolean;
  canPublish: boolean;
}) {
  const [selectedCategory, setSelectedCategory] = useState<string | "all">("all");
  const [search, setSearch] = useState("");
  const [availability, setAvailability] = useState<AvailabilityFilter>("all");
  const [vegOnly, setVegOnly] = useState(false);
  const [draftOnly, setDraftOnly] = useState(false);
  const [noPhotoOnly, setNoPhotoOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("menu-order");
  // Selection survives a filter change on purpose — ticking six items across
  // two categories and then archiving them is the whole point of bulk.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());

  const categoryOptions = useMemo(() => categories.map((c) => ({ id: c.id, name: c.name })), [categories]);

  const normalisedSearch = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    let list = products.filter((p) => {
      if (selectedCategory !== "all" && p.categoryId !== selectedCategory) return false;
      if (normalisedSearch && !p.name.toLowerCase().includes(normalisedSearch) && !(p.sku ?? "").toLowerCase().includes(normalisedSearch)) return false;
      if (availability === "available" && p.availabilityStatus !== "AVAILABLE") return false;
      if (availability === "unavailable" && p.availabilityStatus === "AVAILABLE") return false;
      if (vegOnly && !p.isVegetarian) return false;
      if (draftOnly && p.status !== "DRAFT") return false;
      if (noPhotoOnly && p.image) return false;
      return true;
    });

    list = [...list];
    switch (sort) {
      case "az":
        list.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "price-asc":
        list.sort((a, b) => (a.basePrice < b.basePrice ? -1 : a.basePrice > b.basePrice ? 1 : 0));
        break;
      case "price-desc":
        list.sort((a, b) => (a.basePrice > b.basePrice ? -1 : a.basePrice < b.basePrice ? 1 : 0));
        break;
      case "menu-order":
      default:
        list.sort((a, b) => a.position - b.position);
        break;
      // "newest" falls back to menu order — there is no created-at column surfaced on this row yet.
    }
    return list;
  }, [products, selectedCategory, normalisedSearch, availability, vegOnly, draftOnly, noPhotoOnly, sort]);

  const selectedProducts = useMemo(() => products.filter((p) => selectedIds.has(p.id)), [products, selectedIds]);
  const allShownSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id));

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllShown() {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const p of filtered) {
        if (allShownSelected) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });
  }

  const selectedCategoryName = selectedCategory === "all" ? null : categories.find((c) => c.id === selectedCategory)?.name;
  const addProductHref = selectedCategory === "all" ? "/app/iq/menu/products/new" : `/app/iq/menu/products/new?category=${selectedCategory}`;

  return (
    <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
      {/* Category sidebar */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Categories</h2>
          {canEdit && (
            <Link href="/app/iq/menu/categories/new" className="text-xs font-semibold text-primary hover:underline">
              + Add
            </Link>
          )}
        </div>

        <nav className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => setSelectedCategory("all")}
            aria-current={selectedCategory === "all" ? "true" : undefined}
            className={`flex min-h-[40px] items-center justify-between rounded-md px-3 text-left text-sm font-semibold transition-colors ${
              selectedCategory === "all" ? "bg-secondary text-secondary-foreground" : "text-foreground hover:bg-surface-muted"
            }`}
          >
            All products
            <span className="tabular text-xs font-normal text-muted-foreground">{products.length}</span>
          </button>

          {categories.map((category) => (
            <div key={category.id} className="group flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setSelectedCategory(category.id)}
                aria-current={selectedCategory === category.id ? "true" : undefined}
                className={`flex min-h-[40px] flex-1 items-center justify-between rounded-md px-3 text-left text-sm font-semibold transition-colors ${
                  selectedCategory === category.id ? "bg-secondary text-secondary-foreground" : "text-foreground hover:bg-surface-muted"
                }`}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">{category.name}</span>
                  {category.status === "DRAFT" && <span className="shrink-0 text-[10px] font-bold uppercase text-[var(--warning)]">Draft</span>}
                  {!category.isActive && <span className="shrink-0 text-[10px] font-bold uppercase text-muted-foreground">Off</span>}
                </span>
                <span className="tabular shrink-0 text-xs font-normal text-muted-foreground">{category.productCount}</span>
              </button>
              {canEdit && (
                <div className="hidden items-center group-hover:flex">
                  <ActionButton action={() => moveCategoryAction(category.id, "up")} variant="ghost" className="!min-h-0 !px-1.5 !py-1 text-xs">
                    ↑
                  </ActionButton>
                  <ActionButton action={() => moveCategoryAction(category.id, "down")} variant="ghost" className="!min-h-0 !px-1.5 !py-1 text-xs">
                    ↓
                  </ActionButton>
                </div>
              )}
            </div>
          ))}
        </nav>

        {selectedCategory !== "all" && canEdit && (
          <div className="mt-2 flex flex-col gap-1.5 rounded-md border border-border bg-surface p-2">
            <Link href={`/app/iq/menu/categories/${selectedCategory}`} className="text-xs font-semibold text-primary hover:underline">
              Edit this category →
            </Link>
            <div className="flex gap-1.5">
              {categories.find((c) => c.id === selectedCategory)?.status === "DRAFT" && canPublish && (
                <ActionButton action={() => publishCategoryAction(selectedCategory)} className="!min-h-0 !px-2 !py-1 text-xs">
                  Publish
                </ActionButton>
              )}
              <ActionButton
                action={() => setCategoryActiveAction(selectedCategory, !categories.find((c) => c.id === selectedCategory)?.isActive)}
                variant="ghost"
                className="!min-h-0 !px-2 !py-1 text-xs"
              >
                {categories.find((c) => c.id === selectedCategory)?.isActive ? "Archive category" : "Restore category"}
              </ActionButton>
            </div>
          </div>
        )}
      </div>

      {/* Product grid */}
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products or SKU"
            className="h-[40px] min-w-[200px] flex-1 rounded-md border border-border bg-surface px-3 text-sm"
          />
          <select value={availability} onChange={(e) => setAvailability(e.target.value as AvailabilityFilter)} className="h-[40px] rounded-md border border-border bg-surface px-2 text-sm">
            <option value="all">Any availability</option>
            <option value="available">Available now</option>
            <option value="unavailable">Unavailable now</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-[40px] rounded-md border border-border bg-surface px-2 text-sm">
            <option value="menu-order">Menu order</option>
            <option value="az">A–Z</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
          </select>
          <label className="flex h-[40px] cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-sm">
            <input type="checkbox" checked={vegOnly} onChange={(e) => setVegOnly(e.target.checked)} className="size-4 accent-primary" />
            Veg only
          </label>
          <label className="flex h-[40px] cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-sm">
            <input type="checkbox" checked={draftOnly} onChange={(e) => setDraftOnly(e.target.checked)} className="size-4 accent-primary" />
            Drafts only
          </label>
          <label className="flex h-[40px] cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-sm">
            <input type="checkbox" checked={noPhotoOnly} onChange={(e) => setNoPhotoOnly(e.target.checked)} className="size-4 accent-primary" />
            Missing photo
          </label>
          {canEdit && (
            <label className="flex h-[40px] cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-sm">
              <input type="checkbox" checked={allShownSelected} onChange={toggleAllShown} disabled={filtered.length === 0} className="size-4 accent-primary" />
              Select all shown
            </label>
          )}

          {canEdit && (
            <Link href={addProductHref} className="ml-auto inline-flex h-[40px] items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
              + Add product{selectedCategoryName ? ` to ${selectedCategoryName}` : ""}
            </Link>
          )}
        </div>

        {canEdit && selectedProducts.length > 0 && (
          <BulkActionBar
            selected={selectedProducts.map((p) => ({ id: p.id, status: p.status, isActive: p.isActive }))}
            categories={categoryOptions}
            canPublish={canPublish}
            onDone={() => setSelectedIds(new Set())}
            onClear={() => setSelectedIds(new Set())}
          />
        )}

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {products.length === 0 ? "No products yet." : selectedCategory !== "all" ? "This category has no products yet." : "Nothing matches those filters."}
            </p>
            {canEdit && (
              <Link href={addProductHref} className="inline-flex min-h-[40px] items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
                + Add product
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {filtered.map((product) => (
              <ProductAdminCard
                key={product.id}
                product={product}
                categories={categoryOptions}
                canPublish={canPublish}
                showCategoryName={selectedCategory === "all"}
                selected={selectedIds.has(product.id)}
                onToggleSelect={canEdit ? () => toggleSelected(product.id) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
