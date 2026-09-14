"use client";

import { useState } from "react";
import Link from "next/link";
import type { RightNowTile } from "@/lib/repositories/overview";
import { cn } from "@/lib/utils";

/**
 * "Right now": eight tiles, each a door. Clicking one opens the drawer
 * below the row with the orders behind that number; clicking it again
 * closes it. Everything shown was measured on the server at render time —
 * this component only chooses which list to show.
 */
export function RightNow({ tiles }: { tiles: readonly RightNowTile[] }) {
  const [open, setOpen] = useState<RightNowTile["key"] | null>(null);
  const focused = tiles.find((tile) => tile.key === open) ?? null;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((tile) => {
          const active = tile.key === open;
          return (
            <button
              key={tile.key}
              type="button"
              aria-pressed={active}
              aria-controls="right-now-drawer"
              onClick={() => setOpen(active ? null : tile.key)}
              className={cn(
                "flex min-h-[108px] flex-col gap-1 rounded-xl border bg-panel px-4 py-3.5 text-left transition-[border-color,background-color] duration-[120ms] hover:border-border-strong focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20",
                active ? "border-foreground bg-secondary/40" : "border-border",
              )}
            >
              <span className="text-[12px] font-medium text-muted-foreground">{tile.label.charAt(0) + tile.label.slice(1).toLowerCase()}</span>
              <span className={cn("tabular font-heading text-[26px] font-semibold leading-[1.1] tracking-[-0.015em]", tile.tone === "alert" ? "text-loss" : tile.tone === "good" ? "text-gain" : "text-foreground")}>
                {tile.value}
              </span>
              <span className="text-[12.5px] leading-[1.35] text-muted-foreground">{tile.sub}</span>
            </button>
          );
        })}
      </div>

      {focused && (
        <div id="right-now-drawer" className="overflow-hidden rounded-xl border border-border bg-panel">
          <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-muted px-5 py-3.5">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-base font-semibold">{focused.drawerTitle}</span>
              <span className="text-[13px] text-muted-foreground">{focused.drawerSub}</span>
            </div>
            <button type="button" onClick={() => setOpen(null)} className="min-h-[36px] shrink-0 rounded-md border border-border bg-surface px-2.5 text-[13px] text-muted-foreground hover:text-foreground">
              Close
            </button>
          </div>

          {focused.orders.length === 0 ? (
            <p className="px-5 py-5 text-sm text-muted-foreground">{focused.empty}</p>
          ) : (
            <ul>
              {focused.orders.map((order) => (
                <li key={order.id} className="border-b border-border px-5 py-3 text-sm last:border-b-0 md:grid md:grid-cols-[90px_1.4fr_2fr_1fr_1fr_1fr_auto] md:items-center md:gap-3.5">
                  <div className="flex items-baseline justify-between gap-3 md:block">
                    <span className="tabular font-semibold">#{order.orderNumber}</span>
                    <span className={cn("md:hidden", order.stateTone === "late" ? "text-destructive" : order.stateTone === "ready" ? "text-success" : "text-foreground")}>{order.state}</span>
                  </div>
                  <span className="block text-muted-foreground">{order.channel}</span>
                  <span className="block truncate">{order.items}</span>
                  <span className={cn("hidden md:block", order.stateTone === "late" ? "text-destructive" : order.stateTone === "ready" ? "text-success" : "text-foreground")}>{order.state}</span>
                  <span className="block text-muted-foreground">{order.timing}</span>
                  <span className="flex items-baseline gap-2 md:flex-col md:items-start md:gap-0">
                    <span className="tabular font-semibold">{order.amount}</span>
                    <span className={cn("text-xs", order.payTone === "due" ? "text-destructive" : "text-muted-foreground")}>{order.pay}</span>
                  </span>
                  <Link href={order.href} className="mt-1 inline-block whitespace-nowrap text-[13px] font-semibold underline underline-offset-2 md:mt-0">
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
