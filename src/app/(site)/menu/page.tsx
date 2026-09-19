import type { Metadata } from "next";
import Link from "next/link";
import { DensityToggle } from "@/components/menu/density-toggle";
import { MenuControls } from "@/components/menu/menu-controls";
import { ProductCard } from "@/components/menu/product-card";
import { Stagger, StaggerItem } from "@/components/motion/reveal";
import { EmptyState } from "@/components/states";
import { ShopClosedNotice } from "@/components/site/shop-closed-notice";
import { getMenu } from "@/lib/repositories/menu";
import { getOrg } from "@/lib/repositories/org";

export const metadata: Metadata = {
  title: "Menu",
  description: "Burgers, smash burgers, wraps, wings, loaded fries and mac. Sector 9, Ambala City.",
};

/**
 * The full menu. BUILD-PLAN.md §11.
 *
 * Filters live in the URL rather than in client state: the result is
 * server-rendered, shareable, survives a back button, and works with
 * JavaScript disabled. §11 wants the menu "fast enough for real ordering",
 * and the fastest filter is one that never needs to hydrate.
 */

interface SearchParams {
  q?: string;
  diet?: string;
}

export default async function MenuPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { q = "", diet = "" } = await searchParams;
  const [menu, org] = await Promise.all([getMenu("ONLINE"), getOrg()]);

  const query = q.trim().toLowerCase();
  const vegOnly = diet === "veg";

  const filtered = menu
    .map((category) => ({
      ...category,
      products: category.products.filter((product) => {
        if (vegOnly && product.veg !== "VEG") return false;
        if (!query) return true;
        return (
          product.name.toLowerCase().includes(query) ||
          (product.description ?? "").toLowerCase().includes(query) ||
          category.name.toLowerCase().includes(query)
        );
      }),
    }))
    .filter((category) => category.products.length > 0);

  const total = filtered.reduce((count, category) => count + category.products.length, 0);

  return (
    <div className="mx-auto w-full max-w-6xl px-[var(--gutter)] py-10 sm:py-14">
      <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl">Menu</h1>
      {org && <ShopClosedNotice openingTime={org.openingTime} closingTime={org.closingTime} className="mt-4" />}

      {/*
        A GET form still wraps the controls, so pressing Enter without
        JavaScript submits and the server filters exactly as before. With
        JavaScript, MenuControls filters the rendered sections as you type and
        the submit never happens.
      */}
      <form method="get" role="search" className="mt-8 flex flex-wrap items-center gap-3">
        <label htmlFor="menu-search" className="sr-only">
          Search the menu
        </label>
        <DensityToggle />
        <MenuControls
          categories={menu.map((category) => ({ slug: category.slug, name: category.name }))}
          products={menu.flatMap((category) =>
            category.products.map((product) => ({
              slug: product.slug,
              text: `${product.name} ${product.description ?? ""} ${category.name}`.toLowerCase(),
              veg: product.veg === "VEG",
            })),
          )}
          initialQuery={q}
          initialVegOnly={vegOnly}
        />
        <noscript>
          <button
            type="submit"
            className="inline-flex min-h-[48px] items-center rounded-xl border-[2.5px] border-[var(--ink)] bg-[var(--cream-hi)] px-4 text-sm font-bold"
          >
            Search
          </button>
        </noscript>
      </form>

      {total === 0 ? (
        <EmptyState
          className="mt-10"
          title="Nothing matches that"
          detail={
            vegOnly && query
              ? "Try a different search, or turn off the vegetarian filter."
              : "Try a different search."
          }
          action={
            <Link href="/menu" className="mt-1 text-sm font-semibold text-primary">
              Show the whole menu
            </Link>
          }
        />
      ) : (
        <div className="mt-10 flex flex-col gap-12">
          {filtered.map((category, categoryIndex) => (
            <section
              data-category key={category.slug} id={category.slug} aria-labelledby={`${category.slug}-heading`}>
              <h2
                id={`${category.slug}-heading`}
                className="font-heading text-2xl font-bold tracking-tight sm:text-3xl"
              >
                {category.name}
              </h2>
              <Stagger className="menu-grid mt-5 grid gap-5 [perspective:1000px] sm:grid-cols-2 lg:grid-cols-3">
                {category.products.map((product, index) => (
                  <StaggerItem
                    key={product.slug}
                    className="flex"
                    data-slug={product.slug}
                  >
                    <div className="flex w-full">
                      {/* Only the first row of the first category is above the
                          fold. Marking more than that as priority defeats the
                          point — everything urgent means nothing is. */}
                      <ProductCard
                        product={product}
                        priority={categoryIndex === 0 && index < 3}
                      />
                    </div>
                  </StaggerItem>
                ))}
              </Stagger>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
