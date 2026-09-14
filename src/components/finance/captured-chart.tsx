"use client";

import { Bar, BarChart, XAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { CapturedDay } from "@/lib/finance/ledger-view";
import { formatINR, toRupeesFloat } from "@/lib/money";

/** Two neutral series from the IQ chart tokens — a payment method is not a status, so neither is green or red. */
const chartConfig = {
  cash: { label: "Cash", color: "var(--chart-1)" },
  online: { label: "Online", color: "var(--chart-3)" },
} satisfies ChartConfig;

/**
 * Captured payments per business day, cash stacked under online. The
 * purchased `ecommerce-chart1` shape (Card + BarChart + XAxis + tooltip)
 * as `ChannelChart` already adapted it; grouped bars became a stack because
 * the question is "how much of each day was the till and how much the
 * gateway", which is what a payout has to reconcile against.
 *
 * The float fields exist only for recharts' geometry; every figure a person
 * reads is formatted from the real Paise carried alongside.
 */
export function CapturedChart({ days }: { days: readonly CapturedDay[] }) {
  const data = days.map((day) => ({
    date: day.date,
    cash: toRupeesFloat(day.cash),
    online: toRupeesFloat(day.online),
    amounts: { cash: day.cash, online: day.online, total: day.total },
  }));
  const short = (date: string) => new Date(`${date}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

  return (
    <ChartContainer config={chartConfig} className="aspect-[21/9] w-full">
      <BarChart accessibilityLayer data={data} margin={{ left: -6, right: -6 }}>
        <XAxis dataKey="date" tickLine={false} tickMargin={10} axisLine={false} tickFormatter={short} interval="preserveStartEnd" />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(label) => short(String(label))}
              formatter={(_value, name, item) => {
                const row = item.payload as (typeof data)[number];
                const key = name as "cash" | "online";
                return (
                  <div className="flex w-full items-center justify-between gap-4">
                    <span className="text-muted-foreground">{chartConfig[key].label}</span>
                    <span className="tabular font-medium text-foreground">{formatINR(row.amounts[key], "whole")}</span>
                  </div>
                );
              }}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="cash" stackId="day" fill="var(--color-cash)" radius={0} />
        <Bar dataKey="online" stackId="day" fill="var(--color-online)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
