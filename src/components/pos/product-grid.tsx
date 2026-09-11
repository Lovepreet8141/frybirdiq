"use client";

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
  onTap,
}: {
  products: readonly MenuProduct[];
  /** Total quantity already on the order for each slug, keyed by slug. */
  quantities: ReadonlyMap<string, number>;
  disabled: boolean;
  disabledReason?: string;
  onTap: (product: MenuProduct) => void;
}) {
  if (products.length === 0) {
    return <EmptyState className="m-4" title="Nothing in this category." detail="Try another one from the rail." />;
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      {disabled && disabledReason && (
        <p role="status" className="mb-3 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-muted-foreground">
          {disabledReason}
        </p>
      )}
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
    </div>
  );
}

function ProductTile({
  product,
  quantity,
  disabled,
  onTap,
}: {
  product: MenuProduct;
  quantity: number;
  disabled: boolean;
  onTap: () => void;
}) {
  const [justAdded, setJustAdded] = useState(false);

  useEffect(() => {
    if (!justAdded) return;
    const timer = setTimeout(() => setJustAdded(false), 500);
    return () => clearTimeout(timer);
  }, [justAdded]);

  const hasOptions = product.modifierGroups.length > 0;

  return (
    <button
      type="button"
      data-slug={product.slug}
      disabled={disabled}
      onClick={() => {
        onTap();
        // A product with options opens the picker rather than adding
        // outright, so the flash belongs to its own "Add" button, not here.
        if (!hasOptions) setJustAdded(true);
      }}
      className={cn(
        "group relative flex min-h-[56px] flex-col overflow-hidden rounded-lg border border-border bg-surface text-left transition-[border-color,box-shadow] duration-[var(--duration-micro)]",
        "hover:border-border-strong focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
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
        <div className="flex h-24 shrink-0 items-center justify-center bg-surface-muted" aria-hidden="true">
          <span className="font-heading text-2xl font-black text-muted-foreground">
            {product.name.charAt(0)}
          </span>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-1 p-3">
        <span className="flex items-start gap-1.5 text-sm font-semibold leading-snug">
          <VegMark veg={product.veg} className="mt-0.5" />
          {product.name}
        </span>
        <span className="tabular mt-auto text-sm font-bold text-primary">
          {formatINR(product.price)}
          {hasOptions && <span className="ml-1 font-normal text-muted-foreground">+</span>}
        </span>
      </div>

      {quantity > 0 && (
        <span className="tabular absolute right-1.5 top-1.5 flex min-w-[22px] items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-xs font-bold text-primary-foreground">
          {quantity}
        </span>
      )}

      {justAdded && (
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center bg-primary/90 text-sm font-bold text-primary-foreground opacity-100 transition-opacity duration-100"
        >
          Added
        </span>
      )}
    </button>
  );
}
