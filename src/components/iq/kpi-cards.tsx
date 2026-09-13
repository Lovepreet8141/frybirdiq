"use client";

import Link from "next/link";
import { Bar, BarChart, Line, LineChart } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

/**
 * The KPI row. Three cards are real — a figure, its delta against the
 * chosen comparison, and the last seven days as a shape. Five are the
 * spec's "missing" cards: a dash, one line saying which input would make
 * the number real, and where to record it. A partial profit figure is
 * never shown.
 *
 * Charts draw in `--chart-1`, the neutral (MASTER.md §5 "Charts").
 */

export interface SparkPoint {
  readonly date: string;
  readonly rupees: number;
  readonly orders: number;
}

export interface RealKpi {
  readonly kind: "real";
  readonly title: string;
  readonly tag: string;
  readonly value: string;
  /** Basis points vs the comparison; null when there is nothing to compare against. */
  readonly deltaBps: number | null;
  /** "vs ₹4,580" — the comparison figure itself. */
  readonly comparedTo: string | null;
  readonly chart: "line" | "bars";
  readonly series: readonly SparkPoint[];
  readonly seriesKey: "rupees" | "orders";
  readonly foot: string;
  readonly link: { readonly label: string; readonly href: string };
}

export interface MissingKpi {
  readonly kind: "missing";
  readonly title: string;
  readonly tag: string;
  readonly why: string;
  readonly foot: string;
  readonly link: { readonly label: string; readonly href: string };
}

export type Kpi = RealKpi | MissingKpi;

const config = { rupees: { label: "Revenue", color: "var(--chart-1)" }, orders: { label: "Orders", color: "var(--chart-1)" } } satisfies ChartConfig;

function Delta({ bps, comparedTo }: { bps: number | null; comparedTo: string | null }) {
  if (bps === null) return <span className="text-[13px] text-muted-foreground">No comparison available</span>;
  const up = bps > 0;
  const flat = bps === 0;
  return (
    <span className="flex flex-wrap items-baseline gap-2 text-[13px] text-muted-foreground">
      <span className={cn("tabular font-semibold", flat ? "text-muted-foreground" : up ? "text-success" : "text-destructive")}>
        {up ? "+" : flat ? "" : "−"}
        {(Math.abs(bps) / 100).toFixed(1)}%
      </span>
      {comparedTo && <span>vs {comparedTo}</span>}
    </span>
  );
}

export function KpiCards({ kpis }: { kpis: readonly Kpi[] }) {
  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((kpi) => (
        <article key={kpi.title} className="flex min-h-[158px] flex-col gap-2 rounded-[14px] border border-border bg-surface px-5 py-[18px]">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-muted-foreground">{kpi.title}</span>
            <span className="text-right text-[11px] tracking-[0.06em] text-muted-foreground">{kpi.tag}</span>
          </div>
          {kpi.kind === "real" ? (
            <>
              <div className="tabular font-heading text-[32px] font-semibold leading-none tracking-[-0.02em]">{kpi.value}</div>
              <Delta bps={kpi.deltaBps} comparedTo={kpi.comparedTo} />
              <ChartContainer className="mt-0.5 h-[44px] w-full" config={config}>
                {kpi.chart === "line" ? (
                  <LineChart data={kpi.series} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                    <Line dataKey={kpi.seriesKey} type="linear" stroke={`var(--color-${kpi.seriesKey})`} strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                ) : (
                  <BarChart data={kpi.series} margin={{ top: 2, right: 0, left: 0, bottom: 0 }} barCategoryGap={6}>
                    <Bar dataKey={kpi.seriesKey} fill={`var(--color-${kpi.seriesKey})`} radius={2} isAnimationActive={false} />
                  </BarChart>
                )}
              </ChartContainer>
            </>
          ) : (
            <>
              <div className="font-heading text-[32px] font-semibold leading-none tracking-[-0.02em] text-muted-foreground">—</div>
              <span className="text-[13px] font-semibold text-muted-foreground">Not yet tracked</span>
              <p className="text-[13px] leading-[1.4] text-foreground/80">{kpi.why}</p>
            </>
          )}
          <div className="mt-auto flex items-end justify-between gap-2 text-[13px] text-muted-foreground">
            <span className="leading-[1.4]">{kpi.foot}</span>
            <Link href={kpi.link.href} className="whitespace-nowrap font-semibold text-foreground underline-offset-2 hover:underline">
              {kpi.link.label}
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}
