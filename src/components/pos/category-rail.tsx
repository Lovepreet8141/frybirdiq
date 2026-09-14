"use client";

import { cn } from "@/lib/utils";

export interface PosCategory {
  readonly slug: string;
  readonly name: string;
  readonly count: number;
}

/**
 * Categories, as a vertical rail. The active row is the shell's cream row
 * with the brand-red bar — identity, not a red block — and every row is a
 * 56px target with a press state inside the 120ms micro ceiling.
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
              "relative flex min-h-[56px] w-full touch-manipulation select-none flex-col items-start justify-center gap-0.5 rounded-lg px-3 text-left transition-colors duration-[var(--duration-micro)] active:bg-surface-muted",
              isActive
                ? "bg-sidebar-accent text-foreground before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-r-full before:bg-primary"
                : "text-foreground/85 hover:bg-surface-muted hover:text-foreground",
            )}
          >
            <span className={cn("text-sm leading-tight", isActive ? "font-semibold" : "font-medium")}>{category.name}</span>
            <span className="tabular text-xs text-muted-foreground">
              {category.count} {category.count === 1 ? "item" : "items"}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
