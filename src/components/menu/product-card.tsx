import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { MenuProduct } from "@/lib/repositories/menu";
import { SpiceMark, VegMark } from "./marks";
import { Price } from "./price";

/**
 * A product on the menu.
 *
 * Takes a photograph when the product has one and stays typographic when it
 * does not — two products have no photo of their own, and the card has to look
 * deliberate either way rather than leaving a grey rectangle.
 *
 * The photos are cut out on a transparent background, so they sit directly on
 * the card's surface with no plate or box behind them. That is why there is no
 * container colour or border on the image: adding one would draw a box around
 * a shape that was cut out precisely to avoid having one.
 *
 * The whole card is one link rather than a card with a nested "view" button,
 * so there is a single large target. §55: 44px minimum, and nothing that
 * depends on hover.
 */
export function ProductCard({
  product,
  /**
   * True for the handful of cards above the fold. Next lazy-loads images by
   * default, which for the first card means the largest element on the page
   * starts downloading only after hydration — it is reliably the LCP element
   * and reliably late.
   */
  priority = false,
}: {
  product: MenuProduct;
  priority?: boolean;
}) {
  const hasOptions = product.modifierGroups.length > 0;

  return (
    <Link
      href={`/item/${product.slug}`}
      className="group flex min-h-[44px] flex-col gap-3 rounded-lg border border-border bg-surface p-4 transition-colors duration-[var(--duration-standard)] hover:border-border-strong focus-visible:border-border-strong sm:p-5"
    >
      {product.image && (
        <div className="relative -mt-1 aspect-[4/3] w-full">
          <Image
            src={product.image.url}
            alt={product.image.alt}
            fill
            // The grid is 1/2/3 across at the documented breakpoints; this
            // stops the browser fetching a 640px file to paint 180px of card.
            sizes="(min-width: 1024px) 22rem, (min-width: 640px) 45vw, 90vw"
            priority={priority}
            className="object-contain transition-transform duration-[var(--duration-standard)] group-hover:scale-[1.03]"
          />
        </div>
      )}

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
