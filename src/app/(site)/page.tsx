import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ProductCard } from "@/components/menu/product-card";
import { getAllProducts, getMenu } from "@/lib/repositories/menu";

/**
 * Home. BUILD-PLAN.md §10.
 *
 * "The home page is a conversion surface, not a portfolio piece." Primary goal
 * is to order, so the hero has one clear action and the menu is one tap away.
 *
 * No 3D — deferred out of Phase 0–3 per design-system/3d.md. No stock food
 * photography either: the brand brief is explicit that stock chicken photos
 * read as a template with a logo on it, and the layout is built to be
 * confident without an image and to take a real one when it exists.
 *
 * No AI concierge yet either; §10 lists one but it is Phase 11.
 */

/**
 * The four the menu leads with.
 *
 * A curatorial choice, not a sales statistic. There is no order history yet,
 * so calling anything a "bestseller" would be inventing a fact — §33 applies
 * to marketing copy as much as to the model.
 */
const SIGNATURES = ["og-frybird-classic", "nashville-bomb", "og-smash", "frybird-loaded-fries"];

export default async function HomePage() {
  const [menu, products] = await Promise.all([getMenu(), getAllProducts()]);
  const bySlug = new Map(products.map((product) => [product.slug, product]));
  const signatures = SIGNATURES.map((slug) => bySlug.get(slug)).filter((product) => product !== undefined);

  return (
    <>
      {/* Hero */}
      <section className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-[var(--gutter)] py-16 sm:py-24">
          <div className="flex flex-col gap-5">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">
              Sector 9 · Ambala City
            </p>
            <h1 className="max-w-3xl text-balance font-heading text-5xl font-bold leading-[0.95] tracking-tight sm:text-7xl">
              Born crispy.
              <br />
              Built bold.
            </h1>
            <p className="max-w-prose text-lg leading-relaxed text-muted-foreground">
              Chicken brined overnight, double-dredged, fried to order. Burgers, wraps, wings and loaded fries.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/menu"
              className="inline-flex min-h-[52px] items-center gap-2 rounded-md bg-primary px-6 font-semibold text-primary-foreground transition-opacity duration-[var(--duration-micro)] hover:opacity-90"
            >
              Order now
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <Link
              href="#menu-preview"
              className="inline-flex min-h-[52px] items-center rounded-md border border-border-strong px-6 font-semibold transition-colors duration-[var(--duration-standard)] hover:bg-surface"
            >
              See the menu
            </Link>
          </div>
        </div>
      </section>

      {/* Signatures */}
      <section aria-labelledby="signatures" className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-14 sm:py-20">
          <h2 id="signatures" className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">
            Start here
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {signatures.map((product) => (
              <li key={product.slug} className="flex">
                <div className="flex w-full">
                  <ProductCard product={product} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Categories */}
      <section aria-labelledby="menu-preview" className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-14 sm:py-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 id="menu-preview" className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">
              The whole menu
            </h2>
            <Link href="/menu" className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
              See everything
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>

          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {menu.map((category) => (
              <li key={category.slug}>
                <Link
                  href={`/menu#${category.slug}`}
                  className="flex min-h-[72px] flex-col justify-center gap-1 rounded-lg border border-border bg-surface px-5 py-4 transition-colors duration-[var(--duration-standard)] hover:border-border-strong"
                >
                  <span className="font-heading font-semibold">{category.name}</span>
                  <span className="tabular text-sm text-muted-foreground">
                    {category.products.length} {category.products.length === 1 ? "item" : "items"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Story */}
      <section aria-labelledby="story">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-[var(--gutter)] py-14 sm:py-20">
          <h2 id="story" className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">
            How it&rsquo;s made
          </h2>
          <div className="grid gap-6 sm:grid-cols-3">
            {[
              ["Brined overnight", "Thigh, not breast. Twelve hours in buttermilk before it ever sees flour."],
              ["Double-dredged", "Dipped, rested, dipped again. That is where the crust comes from."],
              ["Fried to order", "Nothing sits under a lamp. It goes in when you order it."],
            ].map(([title, detail]) => (
              <div key={title} className="flex flex-col gap-2 border-t border-border pt-5">
                <h3 className="font-heading text-lg font-semibold">{title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
