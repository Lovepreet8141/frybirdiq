"use client";

import { KpiTile } from "@/components/iq/ui";
import { formatINR, paise } from "@/lib/money";

/**
 * The KPI row. The real figures — revenue, orders, average order — are the
 * hero: Instrument Serif at 40px, counting up on load, a dot-and-word delta
 * beside the comparison figure. The "missing" KPIs are the spec's honest
 * dashes: a dash, one line saying which input would make the number real,
 * and where to record it. A partial profit figure is never shown.
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
  /** The figure as a number for the count-up: rupees for money, a count for orders. */
  readonly amount: number;
  readonly unit: "rupees" | "count";
  /** Basis points vs the comparison; null when there is nothing to compare against. */
  readonly deltaBps: number | null;
  /** "vs ₹4,580" — the comparison figure itself. */
  readonly comparedTo: string | null;
  readonly chart: "line" | "bars";
  readonly series: readonly SparkPoint[];
  readonly seriesKey: "rupees" | "orders";
  readonly foot: string;
  readonly link: { readonly label: string; readonly href: string };
  readonly emphasis?: boolean;
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

const rupees = (value: number) => formatINR(paise(Math.round(value * 100)), "whole");
const count = (value: number) => String(Math.round(value));

export function KpiCards({ kpis, className }: { kpis: readonly Kpi[]; className?: string }) {
  return (
    <div className={className ?? "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"}>
      {kpis.map((kpi, index) =>
        kpi.kind === "real" ? (
          <KpiTile
            key={kpi.title}
            label={kpi.title}
            meta={kpi.tag}
            value={kpi.value}
            count={kpi.value === "—" ? undefined : { value: kpi.amount, format: kpi.unit === "rupees" ? rupees : count, delay: index * 60 }}
            deltaBps={kpi.deltaBps}
            comparedTo={kpi.comparedTo}
            foot={kpi.foot}
            link={kpi.link}
            emphasis={kpi.emphasis}
          />
        ) : (
          <KpiTile key={kpi.title} label={kpi.title} meta={kpi.tag} value="—" missing note={kpi.why} foot={kpi.foot} link={kpi.link} />
        ),
      )}
    </div>
  );
}
