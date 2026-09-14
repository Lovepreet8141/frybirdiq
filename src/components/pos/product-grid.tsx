"use client";

import { Search, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { formatINR } from "@/lib/money";
import type { MenuProduct } from "@/lib/repositories/menu";
import { VegMark } from "@/components/menu/marks";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/states";

/**
 * The product grid. Tap a plain item to add one; a product with modifiers
 * opens the picker instead, because "medium heat, large" cannot be guessed.
 *
 * No database query here — every product came down from the page, which
 * read it through `src/lib/repositories/menu`. §3.
 */
export function ProductGrid({
  products,
  quantities,
  disabled,
  disabledReason,
  search,
  onSearchChange,
  onTap,
}: {
  products: readonly MenuProduct[];
  /** Total quantity already on the order for each slug, keyed by slug. */
  quantities: ReadonlyMap<string, number>;
  disabled: boolean;
  disabledReason?: string;
  search: string;
  onSearchChange: (value: string) => void;
  onTap: (product: MenuProduct) => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="relative mb-3 shrink-0">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <label htmlFor="pos-search" className="sr-only">
          Search products
        </label>
        <input
          id="pos-search"
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search the whole menu"
          autoComplete="off"
          className="h-11 w-full rounded-md border border-border bg-panel pl-9 pr-9 text-sm transition-[border-color,box-shadow] duration-[var(--duration-micro)] placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20"
        />
        {search !== "" && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 touch-manipulation items-center justify-center rounded-md text-muted-foreground transition-colors duration-[var(--duration-micro)] hover:bg-muted hover:text-foreground active:bg-muted"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {disabled && disabledReason && (
        <p role="status" className="mb-3 rounded-md border border-border bg-panel px-3 py-2 text-sm text-muted-foreground">
          {disabledReason}
        </p>
      )}

      {products.length === 0 ? (
        <EmptyState
          className="m-4"
          title={search ? "Nothing matches that search." : "Nothing in this category."}
          detail={search ? "Try a different search." : "Try another one from the rail."}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {products.map((product) => (
            <ProductTile
              key={product.slug}
              product={product}
              quantity={quantities.get(product.slug) ?? 0}
              disabled={disabled}
              onTap={() => onTap(product)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Exported so the Menu Manager's product preview panel renders the exact tile the counter shows — never a re-implementation of it. */
export function ProductTile({
  product,
  quantity,
  disabled,
  // Optional, defaulted here rather than required — the Menu Manager's
  // preview panel renders this same tile from a Server Component and has
  // nothing real for a tap to do there. Defaulting inside this Client
  // Component means the preview never has to pass a function across the
  // server/client boundary at all; a plain closure created in a Server
  // Component and handed to a Client Component isn't serializable, and
  // that used to crash both the preview and the page around it.
  onTap = () => {},
}: {
  product: MenuProduct;
  quantity: number;
  disabled: boolean;
  onTap?: () => void;
}) {
  const [justAdded, setJustAdded] = useState(false);

  useEffect(() => {
    if (!justAdded) return;
    const timer = setTimeout(() => setJustAdded(false), 500);
    return () => clearTimeout(timer);
  }, [justAdded]);

  const hasOptions = product.modifierGroups.length > 0;
  const unavailable = !product.availability.available;

  return (
    <button
      type="button"
      data-slug={product.slug}
      disabled={disabled || unavailable}
      onClick={() => {
        onTap();
        // A product with options opens the picker rather than adding
        // outright, so the flash belongs to its own "Add" button, not here.
        if (!hasOptions) setJustAdded(true);
      }}
      className={cn(
        "group relative flex min-h-[56px] touch-manipulation select-none flex-col overflow-hidden rounded-xl border border-border bg-panel text-left transition-[border-color,box-shadow,background-color] duration-[var(--duration-micro)]",
        "hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20 active:border-border-strong active:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      {unavailable && (
        <span className="absolute inset-x-1.5 top-1.5 z-10 rounded-md bg-loss px-1.5 py-0.5 text-center text-[11px] font-semibold leading-tight text-white">
          {product.availability.status === "SOLD_OUT_TODAY" ? "Sold out today" : product.availability.reason ?? "Unavailable"}
        </span>
      )}
      {product.image ? (
        <div className="flex h-24 shrink-0 items-center justify-center bg-surface-muted">
          <Image
            src={product.image.url}
            alt=""
            width={160}
            height={160}
            sizes="180px"
            className="h-full w-full object-cover"
          />
        </div>
      ) : (
        <div className="flex h-24 shrink-0 items-center justify-center bg-ramp-4" aria-hidden="true">
          <span className="font-money text-[30px] text-muted-foreground/70">
            {product.name.charAt(0)}
          </span>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-1 p-3">
        <span className="flex items-start gap-1.5 text-sm font-semibold leading-snug">
          <VegMark veg={product.veg} className="mt-0.5" />
          {product.name}
        </span>
        <span className="tabular mt-auto text-sm font-semibold">
          {formatINR(product.price)}
          {hasOptions && <span className="ml-1 font-normal text-muted-foreground">+</span>}
        </span>
      </div>

      {quantity > 0 && (
        <span className="tabular absolute right-1.5 top-1.5 flex min-w-[22px] items-center justify-center rounded-full bg-inverse px-1.5 py-0.5 text-xs font-semibold text-inverse-foreground">
          {quantity}
        </span>
      )}

      {justAdded && (
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center bg-inverse/90 text-sm font-semibold text-inverse-foreground opacity-100 transition-opacity duration-[var(--duration-micro)]"
        >
          Added
        </span>
      )}
    </button>
  );
}
