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
      /*
       * The hard offset shadow is the card, not decoration on it. A blurred
       * drop shadow reads as generic material; a solid red block offset behind
       * a heavy ink rule reads as print, which is what this brand is.
       *
       * The lift is 5px and the shadow grows to meet it, so the card appears to
       * rise off the page rather than slide up it. rotateX needs a perspective
       * on the row — the grid sets one.
       */
      className="group flex h-full min-h-[44px] w-full cursor-pointer flex-col rounded-xl border-[2.5px] border-[var(--ink)] bg-[var(--cream-hi)] p-4 text-center shadow-[6px_6px_0_var(--red)] transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-[5px] hover:shadow-[10px_12px_0_var(--red)] focus-visible:-translate-y-[5px] focus-visible:shadow-[10px_12px_0_var(--red)] motion-safe:hover:[transform:translateY(-5px)_rotateX(5deg)] sm:p-5"
    >
      {product.image ? (
        <div
          data-product-media
          className="flex h-[150px] shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(180deg,var(--stage-yellow)_0%,var(--stage-yellow)_68%,var(--stage-yellow-deep)_100%)] p-3"
        >
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
        <div
          data-product-media
          className="flex h-[150px] shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(180deg,var(--stage-yellow)_0%,var(--stage-yellow)_68%,var(--stage-yellow-deep)_100%)] p-3"
          aria-hidden="true"
        >
          <span className="font-heading text-5xl font-black italic leading-none text-[var(--ink)] opacity-80">F</span>
        </div>
      )}

      <h3 className="mt-3 flex items-center justify-center gap-2 font-heading text-base font-extrabold leading-snug">
        <VegMark veg={product.veg} />
        {product.name}
      </h3>

      {product.description && (
        <p data-product-desc className="mt-1.5 line-clamp-2 min-h-[2.4em] text-[0.83rem] leading-snug text-muted-foreground">
          {product.description}
        </p>
      )}

      <div className="mt-2 flex items-center justify-center gap-2">
        <Price amount={product.price} className="font-heading text-xl font-black text-primary" />
        <SpiceMark level={product.spice} />
      </div>

      <span className="mt-auto inline-flex items-center justify-center gap-1 pt-3 text-sm font-semibold text-primary-strong">
        {hasOptions ? "Choose options" : "Add to order"}
        <ChevronRight className="size-4 transition-transform duration-200 ease-out group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </Link>
  );
}
