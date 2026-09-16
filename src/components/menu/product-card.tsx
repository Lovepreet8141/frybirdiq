import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { MenuProduct } from "@/lib/repositories/menu";
import { SpiceMark, VegMark } from "./marks";
import { Price } from "./price";

/**
 * A product on the menu.
 *
 * One continuous yellow surface (--stage-yellow, the same gradient the
 * homepage hero stages food on) rather than a cream card with a smaller
 * yellow image box inset into it — the photo sits directly on the card.
 *
 * The photos are cut-outs at different aspect ratios (0.46:1 portrait to
 * 1.65:1 landscape, sampled across the real catalog) with no baked-in
 * padding, so the image area is a fixed-*aspect* box (not a fixed height)
 * with `fill` + object-contain: every product is shown at its own true
 * proportions, as large as the box allows, never cropped and never
 * stretched, and the box itself scales with the card's own width at every
 * breakpoint rather than needing per-breakpoint overrides.
 *
 * Card height is equalised with h-full plus a clamped description, so a
 * two-line description and a one-line description do not produce two
 * different cards in the same row.
 *
 * Text colours are the yellow-specific tokens from globals.css
 * (--stage-ink-muted, --stage-red) rather than the cream-tuned
 * --muted-foreground/--red/--primary, which fall below 4.5:1 on this
 * yellow — see the comment by --stage-yellow in globals.css for the
 * measured ratios.
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
      className="group flex h-full min-h-[44px] w-full cursor-pointer flex-col gap-3 rounded-xl border-[2.5px] border-[var(--ink)] bg-[linear-gradient(180deg,var(--stage-yellow)_0%,var(--stage-yellow)_68%,var(--stage-yellow-deep)_100%)] p-4 shadow-[6px_6px_0_var(--red)] transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-[5px] hover:shadow-[10px_12px_0_var(--red)] focus-visible:-translate-y-[5px] focus-visible:shadow-[10px_12px_0_var(--red)] motion-safe:hover:[transform:translateY(-5px)_rotateX(5deg)] sm:p-5"
    >
      {product.image ? (
        <div data-product-media className="relative w-full shrink-0 [aspect-ratio:4/3]">
          <Image
            src={product.image.url}
            alt={product.image.alt}
            fill
            sizes="(min-width: 1024px) 22rem, (min-width: 640px) 45vw, 90vw"
            priority={priority}
            className="object-contain drop-shadow-[0_12px_12px_rgba(44,33,27,0.18)] transition-transform duration-[var(--duration-standard)] group-hover:scale-[1.04]"
          />
        </div>
      ) : (
        /* No photograph for this item. The space is still reserved so the card
           lines up with its neighbours in the row, and the mark carries it —
           an empty gap would read as an image that failed to load. */
        <div
          data-product-media
          className="flex w-full shrink-0 items-center justify-center [aspect-ratio:4/3]"
          aria-hidden="true"
        >
          <span className="font-heading text-7xl font-black italic leading-none text-[var(--ink)] opacity-70">F</span>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-2 text-left">
        <h3 className="flex items-center gap-2 font-heading text-base font-extrabold leading-snug text-[var(--ink)]">
          <VegMark tone="stage" veg={product.veg} />
          {product.name}
        </h3>

        {product.description && (
          <p
            data-product-desc
            className="line-clamp-2 min-h-[2.4em] text-[0.83rem] leading-snug text-[var(--stage-ink-muted)]"
          >
            {product.description}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2">
            <Price amount={product.price} className="font-heading text-xl font-black text-[var(--stage-red)]" />
            <SpiceMark level={product.spice} />
          </div>
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--stage-red)]">
            {hasOptions ? "Choose options" : "Add to order"}
            <ChevronRight
              aria-hidden="true"
              className="size-4 transition-transform duration-200 ease-out group-hover:translate-x-0.5"
            />
          </span>
        </div>
      </div>
    </Link>
  );
}
