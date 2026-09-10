import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { MenuProduct } from "@/lib/repositories/menu";
import { SpiceMark, VegMark } from "./marks";
import { Price } from "./price";

/**
 * A product on the menu.
 *
 * Deliberately typographic. There is no food photography yet, and the brand
 * brief is explicit that stock chicken photos are worse than none — they read
 * as a template with a logo on it. The card is built to be confident without
 * an image and to take a real one later without changing shape.
 *
 * The whole card is one link rather than a card with a nested "view" button,
 * so there is a single large target. §55: 44px minimum, and nothing that
 * depends on hover.
 */
export function ProductCard({ product }: { product: MenuProduct }) {
  const hasOptions = product.modifierGroups.length > 0;

  return (
    <Link
      href={`/item/${product.slug}`}
      className="group flex min-h-[44px] flex-col gap-3 rounded-lg border border-border bg-surface p-4 transition-colors duration-[var(--duration-standard)] hover:border-border-strong focus-visible:border-border-strong sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <VegMark veg={product.veg} />
            <SpiceMark level={product.spice} />
          </div>
          <h3 className="font-heading text-lg font-semibold leading-snug">{product.name}</h3>
        </div>
        <Price amount={product.price} className="shrink-0 text-lg font-semibold" />
      </div>

      {product.description && (
        <p className="text-sm leading-relaxed text-muted-foreground">{product.description}</p>
      )}

      <span className="mt-auto inline-flex items-center gap-1 pt-1 text-sm font-semibold text-primary">
        {hasOptions ? "Choose options" : "Add to order"}
        <ChevronRight className="size-4 transition-transform duration-[var(--duration-standard)] group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </Link>
  );
}
