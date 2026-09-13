"use client";

import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { PickerProduct } from "@/lib/promotions/form";
import { priceLabel } from "@/lib/promotions/form";

/**
 * The product multi-select from `ProductPicker.dc.html`: chips for what is
 * chosen, a dropdown with search and checkboxes, Done to close. Products
 * are the real menu, by slug.
 */
export function ProductPicker({
  products,
  selected,
  onChange,
  label,
}: {
  products: readonly PickerProduct[];
  selected: readonly string[];
  onChange: (slugs: readonly string[]) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const options = products.filter((product) => q === "" || product.name.toLowerCase().includes(q) || product.category.toLowerCase().includes(q));
  const chosen = selected.map((slug) => products.find((product) => product.slug === slug) ?? { slug, name: slug, category: "", priceRupees: "0" });

  const toggle = (slug: string) => onChange(selected.includes(slug) ? selected.filter((s) => s !== slug) : [...selected, slug]);

  return (
    <div className="relative">
      <div className="flex min-h-[44px] flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-1.5 py-1">
        {chosen.map((product) => (
          <span key={product.slug} className="inline-flex items-center gap-1.5 rounded-md bg-surface-muted py-1 pl-2.5 pr-1.5 text-[13px] font-medium">
            {product.name}
            <button type="button" onClick={() => toggle(product.slug)} aria-label={`Remove ${product.name}`} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => {
            setOpen((value) => !value);
            setQuery("");
          }}
          aria-expanded={open}
          aria-label={`${label}: ${selected.length ? "change products" : "select products"}`}
          className="ml-auto inline-flex min-h-[36px] items-center gap-1 whitespace-nowrap px-2 text-[13px] text-muted-foreground hover:text-foreground"
        >
          {selected.length ? "Change" : "Select product"}
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-[10px] border border-border bg-popover shadow-lg">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search products…"
            autoFocus
            aria-label="Search products"
            className="w-full border-b border-border px-3.5 py-2.5 text-sm outline-none"
          />
          <div className="max-h-60 overflow-auto">
            {options.length === 0 ? (
              <p className="px-3.5 py-3 text-sm text-muted-foreground">No products match.</p>
            ) : (
              options.map((product) => (
                <label key={product.slug} className="flex cursor-pointer items-center gap-2.5 px-3.5 py-2 text-sm hover:bg-surface-muted">
                  <input type="checkbox" checked={selected.includes(product.slug)} onChange={() => toggle(product.slug)} className="size-[15px] accent-[var(--primary)]" />
                  <span className="flex-1">{product.name}</span>
                  <span className="text-xs text-muted-foreground">{product.category}</span>
                  <span className="tabular w-16 text-right text-[13px] text-muted-foreground">{priceLabel(product)}</span>
                </label>
              ))
            )}
          </div>
          <div className="flex justify-end border-t border-border px-2.5 py-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-md bg-foreground px-3.5 py-1.5 text-[13px] font-semibold text-background">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
