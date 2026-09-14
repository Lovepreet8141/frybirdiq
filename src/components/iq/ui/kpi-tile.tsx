"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CountUp } from "./count-up";
import { DeltaFromBps } from "./signals";

/**
 * "The number is the hero. Everything else is quiet."
 *
 * A KPI tile: a 13px label with an optional right-hand meta, the figure in
 * Instrument Serif at 40px (28 on a phone) counting up on load, the delta
 * as a dot-and-word chip beside its comparison, and one line that says why
 * — a real sentence from the data, or what would make the number real.
 * A tile with `emphasis` is the one answer on the screen: white on a grey
 * page, or ink when the whole row is quiet.
 */

export interface KpiTileProps {
  readonly label: string;
  readonly meta?: string;
  /** The figure, already formatted — used as the accessible value and when there is nothing to count. */
  readonly value: string;
  /** The figure as a number plus a formatter, to count up from zero on load. */
  readonly count?: { readonly value: number; readonly format: (value: number) => string; readonly delay?: number };
  readonly deltaBps?: number | null;
  /** Lower is better (food cost %, late orders). */
  readonly deltaInverted?: boolean;
  readonly comparedTo?: string | null;
  readonly note?: ReactNode;
  readonly foot?: ReactNode;
  readonly link?: { readonly label: string; readonly href: string };
  readonly emphasis?: boolean;
  /** No figure yet: a dash, and the note says which input would make it real. */
  readonly missing?: boolean;
  readonly className?: string;
}

export function KpiTile({ label, meta, value, count, deltaBps, deltaInverted, comparedTo, note, foot, link, emphasis = false, missing = false, className }: KpiTileProps) {
  return (
    <article className={cn("flex min-h-[152px] flex-col gap-2 rounded-xl border px-5 py-4", emphasis ? "border-border bg-panel shadow-[0_1px_0_rgba(25,21,18,0.04)]" : "border-border/80 bg-panel", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        {meta && <span className="truncate text-right text-[12px] text-muted-foreground">{meta}</span>}
      </div>
      <div className={cn("tabular font-money text-[28px] leading-none tracking-[-0.01em] md:text-[40px]", missing ? "text-muted-foreground/70" : "text-foreground")}>
        {missing ? "—" : count ? <CountUp value={count.value} format={count.format} delay={count.delay} /> : value}
      </div>
      {!missing && deltaBps !== undefined && (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          <DeltaFromBps bps={deltaBps} invert={deltaInverted} />
          {comparedTo && <span>vs {comparedTo}</span>}
        </div>
      )}
      {missing && <span className="text-[13px] font-semibold text-muted-foreground">Not yet tracked</span>}
      {note && <p className="text-[13px] leading-[1.45] text-foreground/80">{note}</p>}
      {(foot || link) && (
        <div className="mt-auto flex items-end justify-between gap-2 pt-1 text-[12.5px] text-muted-foreground">
          <span className="leading-[1.4]">{foot}</span>
          {link && (
            <Link href={link.href} className="whitespace-nowrap font-semibold text-foreground underline-offset-2 hover:underline">
              {link.label}
            </Link>
          )}
        </div>
      )}
    </article>
  );
}
