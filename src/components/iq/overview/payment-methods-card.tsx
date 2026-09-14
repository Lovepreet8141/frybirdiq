"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Label, Pie, PieChart } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { type Paise, formatINR, toRupeesFloat } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface MethodSlice {
  readonly method: string;
  readonly label: string;
  readonly count: number;
  readonly total: Paise;
}

/** Up to five methods; the ramp is the IQ neutral chart tokens — a payment method is not a status. */
const COLORS = ["var(--chart-1)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-2)"] as const;

/**
 * The purchased E-commerce dashboard's `VisitBySource` donut
 * (`ecommerce/components/visit-by-source.tsx`): a `Pie` with an inner
 * radius, a `Label` in the hole carrying the total, and a dot legend
 * below. Browser sources became the methods money actually arrived by,
 * from the payments ledger's captured rows; the centre is captured, never
 * called revenue.
 */
export function PaymentMethodsCard({ methods, capturedTotal, periodLabel, className }: { methods: readonly MethodSlice[]; capturedTotal: Paise; periodLabel: string; className?: string }) {
  const slices = methods.slice(0, 5);
  const chartConfig = Object.fromEntries(slices.map((slice, index) => [slice.method, { label: slice.label, color: COLORS[index % COLORS.length] }])) satisfies ChartConfig;
  const data = slices.map((slice) => ({ method: slice.method, rupees: toRupeesFloat(slice.total), fill: `var(--color-${slice.method})`, paise: slice.total, count: slice.count }));
  const empty = capturedTotal === 0n;

  return (
    <Card className={cn("h-full", className)}>
      <CardHeader>
        <CardTitle>Payment methods</CardTitle>
        <CardDescription>Captured {periodLabel.toLowerCase()} · the till and the gateway</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" asChild>
            <Link href="/app/finance">
              Finance
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {empty ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">Nothing captured {periodLabel.toLowerCase()}.</p>
        ) : (
          <>
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[190px] w-full">
              <PieChart>
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      hideLabel
                      formatter={(_value, name, item) => {
                        const row = item.payload as (typeof data)[number];
                        return (
                          <div className="flex w-full items-center justify-between gap-4">
                            <span className="text-muted-foreground">{chartConfig[String(name)]?.label ?? name}</span>
                            <span className="tabular font-medium text-foreground">
                              {formatINR(row.paise, "whole")} · {row.count}
                            </span>
                          </div>
                        );
                      }}
                    />
                  }
                />
                <Pie data={data} dataKey="rupees" nameKey="method" innerRadius={52} strokeWidth={4} stroke="var(--card)">
                  <Label
                    content={({ viewBox }) => {
                      if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                        return (
                          <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                            <tspan x={viewBox.cx} y={viewBox.cy} className="tabular fill-foreground font-money text-[22px]">
                              {formatINR(capturedTotal, "whole")}
                            </tspan>
                            <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 18} className="fill-muted-foreground text-[11px]">
                              captured
                            </tspan>
                          </text>
                        );
                      }
                      return null;
                    }}
                  />
                </Pie>
              </PieChart>
            </ChartContainer>
            <ul className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
              {slices.map((slice, index) => (
                <li key={slice.method} className="flex items-center gap-1.5 text-[12px]">
                  <span className="block size-2 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} aria-hidden="true" />
                  <span className="font-medium">{slice.label}</span>
                  <span className="tabular text-muted-foreground">{slice.count}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
