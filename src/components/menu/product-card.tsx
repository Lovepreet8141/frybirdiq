import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { MenuProduct } from "@/lib/repositories/menu";
import { SpiceMark, VegMark } from "./marks";
import { Price } from "./price";

/**
 * A product on the menu.
 *
 * Every card is the same height and every photograph is the same size on
 * screen, which takes more care than it sounds.
 *
 * The photos are cut-outs at different aspect ratios — a burger is 640×559, a
 * combo 640×381. Fitting each into a fixed *aspect* box with object-contain
 * scales them to different apparent sizes: the wide one ends up short and
 * small, the tall one fills its box. So the image area has a fixed height and
 * the image is sized by that height, exactly as the site design does it. A
 * wide item is then wider on screen, which is true of the actual food.
 *
 * Card height is equalised with h-full plus a clamped description, so a
 * two-line description and a one-line description do not produce two different
 * cards in the same row.
 */
export function ProductCard({
  product,
  /**
   * True for the handful of cards above the fold. Next lazy-loads images by
   * default, which for the first card means the largest element on the page
   * starts downloading only after hydration — reliably the LCP element, and
   * reliably late.
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
      className="group flex h-full min-h-[44px] w-full flex-col rounded-[var(--radius)] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(44,33,27,0.06)] transition-[transform,box-shadow] duration-[var(--duration-standard)] hover:-translate-y-0.5 hover:shadow-[0_6px_16px_-6px_rgba(44,33,27,0.28)] focus-visible:-translate-y-0.5 sm:p-5"
    >
      {product.image ? (
        <div className="flex h-[150px] shrink-0 items-center justify-center">
          <Image
            src={product.image.url}
            alt={product.image.alt}
            width={340}
            height={340}
            sizes="(min-width: 1024px) 22rem, (min-width: 640px) 45vw, 90vw"
            priority={priority}
            className="h-full w-auto object-contain drop-shadow-[0_12px_12px_rgba(44,33,27,0.18)] transition-transform duration-[var(--duration-standard)] group-hover:scale-[1.04]"
          />
        </div>
      ) : (
        /* No photograph for this item. The space is still reserved so the card
           lines up with its neighbours in the row, and the mark carries it —
           an empty gap would read as an image that failed to load. */
        <div className="flex h-[150px] shrink-0 items-center justify-center" aria-hidden="true">
          <span className="font-heading text-5xl font-black italic leading-none text-secondary">F</span>
        </div>
      )}

      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <VegMark veg={product.veg} />
            <SpiceMark level={product.spice} />
          </div>
          <h3 className="font-heading text-lg font-bold leading-snug">{product.name}</h3>
        </div>
        <Price amount={product.price} className="shrink-0 font-heading text-lg font-black text-primary" />
      </div>

      {product.description && (
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {product.description}
        </p>
      )}

      <span className="mt-auto inline-flex items-center gap-1 pt-3 text-sm font-semibold text-primary-strong">
        {hasOptions ? "Choose options" : "Add to order"}
        <ChevronRight className="size-4 transition-transform duration-[var(--duration-standard)] group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </Link>
  );
}
