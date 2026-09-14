import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Status and deltas: a dot and the word, never colour alone
 * (design-system/MASTER.md §5 "Status & deltas"). `DeltaChip` is the soft
 * pill beside a KPI ("+8.4%", "+3.3 pts", "— no prior period");
 * `StatusWord` is the dot-and-text line ("● Synced 2 min ago",
 * "● Partial · 13 of 14 rows"); `DataTrust` is a row of them.
 */

export type SignalTone = "gain" | "loss" | "flag" | "neutral";

const CHIP: Record<SignalTone, string> = {
  gain: "bg-gain-soft text-gain",
  loss: "bg-loss-soft text-loss",
  flag: "bg-flag-soft text-flag",
  neutral: "bg-muted text-muted-foreground",
};

const DOT: Record<SignalTone, string> = {
  gain: "bg-gain",
  loss: "bg-loss",
  flag: "bg-flag",
  neutral: "bg-muted-foreground/60",
};

export function DeltaChip({ tone, children, className }: { tone: SignalTone; children: ReactNode; className?: string }) {
  return <span className={cn("tabular inline-flex h-[22px] items-center rounded-full px-2 text-xs font-semibold", CHIP[tone], className)}>{children}</span>;
}

/** "+8.4%" from basis points; "—" with a reason when there is no prior period. */
export function DeltaFromBps({ bps, noPrior = "no prior period", invert = false }: { bps: number | null; noPrior?: string; invert?: boolean }) {
  if (bps === null) return <DeltaChip tone="neutral">— {noPrior}</DeltaChip>;
  const up = bps > 0;
  const good = invert ? !up : up;
  const tone: SignalTone = bps === 0 ? "neutral" : good ? "gain" : "loss";
  return (
    <DeltaChip tone={tone}>
      {up ? "+" : bps < 0 ? "−" : ""}
      {(Math.abs(bps) / 100).toFixed(1)}%
    </DeltaChip>
  );
}

export function StatusWord({ tone, children, className }: { tone: SignalTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px] text-muted-foreground", className)}>
      <span className={cn("size-[7px] shrink-0 rounded-full", DOT[tone])} aria-hidden="true" />
      {children}
    </span>
  );
}

export interface TrustItem {
  readonly tone: SignalTone;
  readonly text: string;
}

/** The data-trust line every data-heavy panel carries: what it covers, how fresh it is, what it excludes. */
export function DataTrust({ items, className }: { items: readonly TrustItem[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <p className={cn("flex flex-wrap items-center gap-x-4 gap-y-1", className)}>
      {items.map((item, index) => (
        <StatusWord key={index} tone={item.tone}>
          {item.text}
        </StatusWord>
      ))}
    </p>
  );
}

/** A dashed pill that says the figures are illustrative. Never appears next to production data. */
export function SampleTag() {
  return <span className="inline-flex h-[22px] items-center rounded-md border border-dashed border-border-strong px-2 text-[11px] font-semibold text-muted-foreground">Sample data</span>;
}
