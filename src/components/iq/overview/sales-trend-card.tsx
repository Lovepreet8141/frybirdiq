"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { type Paise, formatINR, paise, toRupeesFloat } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface TrendPoint {
  readonly date: string;
  readonly revenue: Paise;
  readonly orders: number;
}

type Series = "revenue" | "orders";

/** One neutral series at a time — a sales trend is not a status, so it is never green or red. */
const chartConfig = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
  orders: { label: "Paid orders", color: "var(--chart-3)" },
} satisfies ChartConfig;

const short = (date: string) => new Date(`${date}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/**
 * The purchased Sales dashboard's `RevenueChart` (`sales/components/revenue-chart.tsx`,
 * registry `ecommerce-chart2`): a bar chart whose header carries two
 * toggle buttons that are themselves the series totals. Its two demo
 * series are the two real ones a restaurant asks about — revenue and paid
 * orders per business day — and the totals are the range's own sums.
 */
export function SalesTrendCard({ series, periodLabel, className }: { series: readonly TrendPoint[]; periodLabel: string; className?: string }) {
  const [active, setActive] = useState<Series>("revenue");

  const data = useMemo(() => series.map((point) => ({ date: point.date, revenue: toRupeesFloat(point.revenue), orders: point.orders, revenuePaise: point.revenue })), [series]);
  const totals = useMemo(() => ({ revenue: series.reduce((sum, point) => sum + point.revenue, 0n), orders: series.reduce((sum, point) => sum + point.orders, 0) }), [series]);
  const quiet = series.every((point) => point.orders === 0);

  return (
    <Card className={cn("h-full", className)}>
      <CardHeader className="@max-md/card:grid!">
        <CardTitle>Sales trend</CardTitle>
        <CardDescription>{periodLabel} · by business day · paid orders only</CardDescription>
        <CardAction className="flex gap-1">
          {(["revenue", "orders"] as const).map((key) => (
            <button
              key={key}
              type="button"
              data-active={active === key}
              onClick={() => setActive(key)}
              className="flex flex-col gap-0.5 rounded-lg px-3 py-1.5 text-left transition-colors duration-[120ms] hover:bg-muted/60 data-[active=true]:bg-muted data-[active=true]:ring-1 data-[active=true]:ring-foreground/10"
            >
              <span className="text-[11.5px] text-muted-foreground">{chartConfig[key].label}</span>
              <span className="tabular font-money text-lg leading-none">{key === "revenue" ? formatINR(paise(totals.revenue), "whole") : String(totals.orders)}</span>
            </button>
          ))}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col">
        {quiet ? (
          <div className="flex min-h-[186px] flex-1 items-center justify-center rounded-lg border border-dashed border-border text-[13px] text-muted-foreground">No paid orders {periodLabel.toLowerCase()}.</div>
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto min-h-[186px] w-full flex-1 [&_.recharts-responsive-container]:min-h-[186px]">
            <BarChart accessibilityLayer data={data} margin={{ left: 0, right: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} className="stroke-border/60" />
              <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={short} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    className="w-[180px]"
                    labelFormatter={(label) => short(String(label))}
                    formatter={(_value, _name, item) => {
                      const row = item.payload as (typeof data)[number];
                      return (
                        <div className="flex w-full flex-col gap-0.5">
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-muted-foreground">Revenue</span>
                            <span className="tabular font-medium text-foreground">{formatINR(row.revenuePaise, "whole")}</span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-muted-foreground">Orders</span>
                            <span className="tabular font-medium text-foreground">{row.orders}</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                }
              />
              <Bar dataKey={active} fill={`var(--color-${active})`} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
