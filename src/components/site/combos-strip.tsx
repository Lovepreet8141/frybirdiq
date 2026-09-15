import Image from "next/image";
import Link from "next/link";
import type { MenuCategory } from "@/lib/repositories/menu";
import { Price } from "@/components/menu/price";

/**
 * Combos & party boxes, as a horizontal scroll strip — real products from
 * the real "combos" category (`getMenu("ONLINE")`), same as every other
 * product on the site. Renders nothing if the category doesn't exist, isn't
 * published to the website, or has no in-stock items right now — never a
 * placeholder combo.
 */
export function CombosStrip({ category }: { category: MenuCategory | undefined }) {
  const items = category?.products.filter((product) => product.availability.available) ?? [];
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="combos-heading" className="border-b border-[var(--cream-hi)]/10 bg-[var(--ink)] text-[var(--cream-hi)]">
      <div className="mx-auto w-full max-w-6xl px-[var(--gutter)] py-14 sm:py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">Feeding more than one</p>
        <h2 id="combos-heading" className="mt-2 font-heading text-[clamp(1.75rem,5vw,2.75rem)] font-black italic leading-none tracking-tight [font-stretch:75%]">
          {category?.name ?? "Combos"}
        </h2>
      </div>

      <ul className="no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto px-[var(--gutter)] pb-14 [scroll-padding-inline:var(--gutter)]">
        {items.map((product, index) => (
          <li key={product.slug} className="w-[78vw] shrink-0 snap-start sm:w-[340px]">
            <Link
              href={`/item/${product.slug}`}
              className="group flex h-full flex-col overflow-hidden rounded-2xl border-[2.5px] border-[var(--cream-hi)]/15 bg-[var(--cream-hi)]/[0.04] transition-colors duration-200 hover:border-[var(--cream-hi)]/35"
            >
              {product.image && (
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-[var(--ink-deep)]">
                  <Image
                    src={product.image.url}
                    alt={product.image.alt}
                    fill
                    sizes="(min-width: 640px) 340px, 78vw"
                    priority={index === 0}
                    className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.04]"
                  />
                </div>
              )}
              <div className="flex flex-1 flex-col gap-1.5 p-5">
                <h3 className="font-heading text-lg font-extrabold">{product.name}</h3>
                {product.description && <p className="line-clamp-2 text-sm text-[var(--cream-2)]/75">{product.description}</p>}
                <div className="mt-auto flex items-center justify-between pt-3">
                  <Price amount={product.price} className="font-heading text-xl font-black text-primary" />
                  <span className="text-sm font-semibold text-[var(--cream-2)]/85 transition-transform duration-200 group-hover:translate-x-0.5">
                    View →
                  </span>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
