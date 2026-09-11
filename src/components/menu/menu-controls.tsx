"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Search and the category rail, as an enhancement over the form underneath.
 *
 * The page filters on the server from the URL, which is why it works with
 * JavaScript off, survives a back button and can be shared. None of that is
 * given up here. This component filters the already-rendered sections in the
 * DOM as you type — hiding what does not match rather than re-fetching — and
 * writes the query into the URL with replaceState so the address bar still
 * describes what is on screen.
 *
 * Filtering 49 items across a network round trip is the difference between
 * a menu that feels considered and one that feels like a form from 2009.
 */

interface Category {
  readonly slug: string;
  readonly name: string;
}

interface Searchable {
  readonly slug: string;
  /** Name, description and category, lowercased once on the server. */
  readonly text: string;
}

export function MenuControls({
  categories,
  products,
  initialQuery,
  vegOnly,
}: {
  categories: readonly Category[];
  products: readonly Searchable[];
  initialQuery: string;
  vegOnly: boolean;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState<string | null>(categories[0]?.slug ?? null);
  const railRef = useRef<HTMLElement>(null);

  const normalised = query.trim().toLowerCase();

  /*
   * What matches is derived here, during render, from the list the server
   * sent — not read back out of the DOM in an effect. The effect below only
   * applies the result.
   */
  const matched = useMemo(() => {
    if (normalised === "") return null;
    return new Set(products.filter((p) => p.text.includes(normalised)).map((p) => p.slug));
  }, [normalised, products]);

  const matches = matched?.size ?? null;

  /* ---------- apply the filter to what is already rendered ---------- */
  useEffect(() => {
    for (const card of document.querySelectorAll<HTMLElement>("[data-slug]")) {
      const hit = matched === null || matched.has(card.dataset.slug ?? "");
      // `hidden` rather than a display:none class, so the element leaves the
      // accessibility tree too — a screen reader should not read out items the
      // sighted user has filtered away.
      card.hidden = !hit;
    }
    for (const section of document.querySelectorAll<HTMLElement>("[data-category]")) {
      section.hidden = section.querySelectorAll<HTMLElement>("[data-slug]:not([hidden])").length === 0;
    }
  }, [matched]);

  /* ---------- keep the URL honest ---------- */
  useEffect(() => {
    const timer = setTimeout(() => {
      const url = new URL(window.location.href);
      if (normalised) url.searchParams.set("q", query.trim());
      else url.searchParams.delete("q");
      // replaceState, not push: typing six characters should not put six
      // entries in the back button.
      window.history.replaceState(null, "", url);
    }, 250);
    return () => clearTimeout(timer);
  }, [normalised, query]);

  /* ---------- scroll spy ---------- */
  useEffect(() => {
    if (normalised !== "") return;
    const sections = categories
      .map((category) => document.getElementById(category.slug))
      .filter((node): node is HTMLElement => node !== null);
    if (sections.length === 0 || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        // The heading nearest the top of the viewport wins, so the rail marks
        // the section being read rather than whichever fired most recently.
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-88px 0px -65% 0px", threshold: 0 },
    );

    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [categories, normalised]);

  /* Keep the active chip in view on a rail that scrolls sideways. */
  useEffect(() => {
    if (!active) return;
    const chip = railRef.current?.querySelector<HTMLElement>(`[data-chip="${active}"]`);
    chip?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [active]);

  const clearHref = useMemo(() => (vegOnly ? "/menu?diet=veg" : "/menu"), [vegOnly]);

  return (
    <>
      <div className="relative flex-1 sm:max-w-xs">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          id="menu-search"
          type="search"
          name="q"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the menu"
          autoComplete="off"
          className="h-[48px] w-full rounded-xl border-[2.5px] border-[var(--ink)] bg-[var(--cream-hi)] pl-9 pr-3 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] focus-visible:ring-offset-2"
        />
        {query !== "" && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <Link
        href={vegOnly ? { pathname: "/menu", query: query ? { q: query } : {} } : { pathname: "/menu", query: { ...(query ? { q: query } : {}), diet: "veg" } }}
        aria-pressed={vegOnly}
        className={`inline-flex min-h-[48px] cursor-pointer items-center rounded-xl border-[2.5px] px-4 text-sm font-bold transition-[transform,box-shadow] duration-200 ease-out ${
          vegOnly
            ? "border-[var(--success)] bg-[var(--success)] text-[var(--cream-hi)] shadow-[4px_4px_0_var(--ink)]"
            : "border-[var(--ink)] bg-[var(--cream-hi)] shadow-[4px_4px_0_var(--ink)] hover:-translate-y-0.5 hover:shadow-[6px_7px_0_var(--ink)]"
        }`}
      >
        Veg only
      </Link>

      {(query !== "" || vegOnly) && (
        <Link
          href={clearHref}
          onClick={() => setQuery("")}
          className="inline-flex min-h-[48px] cursor-pointer items-center gap-1 rounded-xl px-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
          Clear
        </Link>
      )}

      {/* Live count. Polite, so it does not interrupt typing. */}
      <p className="tabular w-full text-sm text-muted-foreground" role="status" aria-live="polite">
        {matches === null ? "" : `${matches} ${matches === 1 ? "item" : "items"} matching “${query.trim()}”`}
      </p>

      {/* The rail. Hidden while searching, when a jump link would lie about
          where it lands. */}
      {normalised === "" && (
        <nav
          ref={railRef}
          aria-label="Menu categories"
          className="-mx-[var(--gutter)] w-[calc(100%+2*var(--gutter))] overflow-x-auto px-[var(--gutter)] pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <ul className="flex w-max gap-2">
            {categories.map((category) => {
              const isActive = active === category.slug;
              return (
                <li key={category.slug}>
                  <a
                    data-chip={category.slug}
                    href={`#${category.slug}`}
                    aria-current={isActive ? "true" : undefined}
                    className={`inline-flex min-h-[44px] cursor-pointer items-center whitespace-nowrap rounded-xl border-[2.5px] border-[var(--ink)] px-4 text-sm font-bold transition-[background-color,color,box-shadow,transform] duration-200 ease-out ${
                      isActive
                        ? "bg-[var(--red)] text-[var(--cream-hi)] shadow-[4px_4px_0_var(--ink)]"
                        : "bg-[var(--cream-hi)] shadow-[3px_3px_0_var(--ink)] hover:-translate-y-0.5 hover:shadow-[5px_6px_0_var(--ink)]"
                    }`}
                  >
                    {category.name}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </>
  );
}
