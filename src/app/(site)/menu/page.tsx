import type { Metadata } from "next";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { ProductCard } from "@/components/menu/product-card";
import { EmptyState } from "@/components/states";
import { getMenu } from "@/lib/repositories/menu";

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
  const menu = await getMenu();

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
  const isFiltered = Boolean(query) || vegOnly;

  return (
    <div className="mx-auto w-full max-w-6xl px-[var(--gutter)] py-10 sm:py-14">
      <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl">Menu</h1>

      {/* Search and filter. A plain GET form, so it needs no JavaScript. */}
      <form method="get" className="mt-8 flex flex-wrap items-center gap-3" role="search">
        <label htmlFor="menu-search" className="sr-only">
          Search the menu
        </label>
        <div className="relative flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            id="menu-search"
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search"
            className="h-[44px] w-full rounded-md border border-border bg-surface pl-9 pr-3 text-base placeholder:text-muted-foreground focus-visible:border-border-strong"
          />
        </div>

        {/* Preserves the current query when toggling diet. */}
        {vegOnly && <input type="hidden" name="diet" value="veg" />}

        <button
          type="submit"
          className="inline-flex min-h-[44px] items-center rounded-md border border-border-strong px-4 text-sm font-semibold transition-colors duration-[var(--duration-standard)] hover:bg-surface"
        >
          Search
        </button>

        <Link
          href={{ pathname: "/menu", query: { ...(q ? { q } : {}), ...(vegOnly ? {} : { diet: "veg" }) } }}
          className={`inline-flex min-h-[44px] items-center rounded-md border px-4 text-sm font-semibold transition-colors duration-[var(--duration-standard)] ${
            vegOnly
              ? "border-[#3F9D52] bg-[#3F9D52]/15 text-foreground"
              : "border-border-strong hover:bg-surface"
          }`}
          aria-pressed={vegOnly}
        >
          Veg only
        </Link>

        {isFiltered && (
          <Link
            href="/menu"
            className="inline-flex min-h-[44px] items-center gap-1 rounded-md px-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
            Clear
          </Link>
        )}
      </form>

      {isFiltered && (
        <p className="tabular mt-4 text-sm text-muted-foreground" role="status" aria-live="polite">
          {total} {total === 1 ? "item" : "items"}
          {query && <> matching &ldquo;{q}&rdquo;</>}
          {vegOnly && <> · vegetarian only</>}
        </p>
      )}

      {/* Category jump links. Hidden while filtering, when they would lie. */}
      {!isFiltered && (
        <nav aria-label="Menu categories" className="mt-8 flex flex-wrap gap-2">
          {menu.map((category) => (
            <a
              key={category.slug}
              href={`#${category.slug}`}
              className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-surface px-4 text-sm font-semibold transition-colors duration-[var(--duration-standard)] hover:border-border-strong"
            >
              {category.name}
            </a>
          ))}
        </nav>
      )}

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
          {filtered.map((category) => (
            <section key={category.slug} id={category.slug} aria-labelledby={`${category.slug}-heading`}>
              <h2
                id={`${category.slug}-heading`}
                className="font-heading text-2xl font-bold tracking-tight sm:text-3xl"
              >
                {category.name}
              </h2>
              <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {category.products.map((product) => (
                  <li key={product.slug} className="flex">
                    <div className="flex w-full">
                      <ProductCard product={product} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
