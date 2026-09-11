"use client";

import { cn } from "@/lib/utils";

export interface PosCategory {
  readonly slug: string;
  readonly name: string;
  readonly count: number;
}

/**
 * Categories, as a vertical rail.
 *
 * Vertical rather than the customer site's horizontal scroller: on a
 * landscape tablet the rail sits beside the grid for the whole shift, and a
 * column of 56px targets is faster to scan and to hit than a strip that
 * scrolls sideways. §7 — POS touch targets are 56×56px, not the 44px floor.
 */
export function CategoryRail({
  categories,
  active,
  onSelect,
}: {
  categories: readonly PosCategory[];
  active: string | null;
  onSelect: (slug: string) => void;
}) {
  return (
    <nav aria-label="Menu categories" className="flex h-full flex-col gap-1 overflow-y-auto border-r border-border bg-surface p-2">
      {categories.map((category) => {
        const isActive = category.slug === active;
        return (
          <button
            key={category.slug}
            type="button"
            aria-current={isActive ? "true" : undefined}
            onClick={() => onSelect(category.slug)}
            className={cn(
              "flex min-h-[56px] w-full flex-col items-start justify-center gap-0.5 rounded-md px-3 text-left transition-colors duration-[var(--duration-micro)]",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-surface-muted",
            )}
          >
            <span className="text-sm font-semibold leading-tight">{category.name}</span>
            <span className={cn("tabular text-xs", isActive ? "text-primary-foreground/80" : "text-muted-foreground")}>
              {category.count} {category.count === 1 ? "item" : "items"}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
