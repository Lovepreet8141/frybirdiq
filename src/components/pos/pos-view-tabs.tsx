"use client";

import { useState } from "react";
import { cn } from "cn";

/**
 * "Order" vs "Tables" at the top of the counter screen.
 *
 * Both children stay mounted the whole time and switch on `hidden` rather
 * than on conditional rendering — the draft order being built in `PosShell`
 * (category, lines, channel, the priced total) must survive a trip to check
 * the floor plan and back, and unmounting it would throw all of that away.
 */
export function PosViewTabs({
  order,
  tables,
  headerEnd,
}: {
  order: React.ReactNode;
  tables: React.ReactNode;
  /**
   * Right-hand end of the tab bar, and anything it wraps onto a full row below
   * it — the Close Shop switch and, while closed, its who/when/reopens strip
   * (ops-1). Shown on both tabs: whether the shop is taking orders is not an
   * Order-tab fact.
   */
  headerEnd?: React.ReactNode;
}) {
  const [view, setView] = useState<"order" | "tables">("order");

  return (
    <div className="flex flex-col lg:h-[calc(100dvh-68px)]">
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface px-2 py-1.5">
        <div className="flex items-center gap-1" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={view === "order"}
          onClick={() => setView("order")}
          className={cn(
            "min-h-[36px] rounded-md px-3 text-sm font-semibold transition-colors",
            view === "order" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          Order
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "tables"}
          onClick={() => setView("tables")}
          className={cn(
            "min-h-[36px] rounded-md px-3 text-sm font-semibold transition-colors",
            view === "tables" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          Tables
        </button>
        </div>
        {headerEnd}
      </div>

      <div className="min-h-0 flex-1" hidden={view !== "order"}>
        {order}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" hidden={view !== "tables"}>
        {tables}
      </div>
    </div>
  );
}
