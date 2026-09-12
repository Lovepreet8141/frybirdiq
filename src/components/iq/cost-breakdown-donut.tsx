"use client";

import { Label, Pie, PieChart } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { type Paise, add, formatBps, formatINR, ratioBps, toRupeesFloat } from "@/lib/money";

const chartConfig = {
  direct: { label: "Direct costs", color: "var(--primary)" },
  operating: { label: "Operating expenses", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

/**
 * Direct vs operating, as a share of what's actually been spent.
 *
 * One accent, one muted grey — the same rule the rest of this screen
 * follows. Direct costs get the accent because food cost is the figure this
 * section leads with; operating expenses are real but secondary here, not a
 * second thing competing for attention.
 */
export function CostBreakdownDonut({
  directTotal,
  fixedTotal,
  className,
}: {
  directTotal: Paise;
  fixedTotal: Paise;
  className?: string;
}) {
  const total = add(directTotal, fixedTotal);
  if (total === 0n) return null;

  // `amount` is the value recharts does arithmetic on for the slice angles —
  // it needs an ordinary number. A Paise (bigint) there doesn't throw, it
  // just makes every internal computation NaN and the pie renders nothing at
  // all. `rupees` is lossy and exists only for this chart; `amount` (the real
  // Paise) is what every label and tooltip actually formats and shows.
  const chartData = [
    { key: "direct", label: "Direct costs", amount: directTotal, rupees: toRupeesFloat(directTotal), fill: "var(--color-direct)" },
    { key: "operating", label: "Operating expenses", amount: fixedTotal, rupees: toRupeesFloat(fixedTotal), fill: "var(--color-operating)" },
  ].filter((slice) => slice.amount > 0n);

  return (
    <div className={className}>
      <ChartContainer config={chartConfig} className="mx-auto aspect-square w-[180px] max-w-full">
        <PieChart>
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                hideLabel
                formatter={(_value, _name, item) => {
                  const slice = item.payload as (typeof chartData)[number];
                  return (
                    <div className="flex w-full items-center justify-between gap-4">
                      <span className="text-muted-foreground">{slice.label}</span>
                      <span className="tabular font-medium text-foreground">{formatINR(slice.amount, "whole")}</span>
                    </div>
                  );
                }}
              />
            }
          />
          <Pie data={chartData} dataKey="rupees" nameKey="key" innerRadius={54} outerRadius={72} strokeWidth={3}>
            <Label
              content={({ viewBox }) => {
                if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) return null;
                return (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                    <tspan x={viewBox.cx} y={viewBox.cy} className="tabular fill-foreground font-heading text-xl font-bold">
                      {formatINR(total, "whole")}
                    </tspan>
                    <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 18} className="fill-muted-foreground text-xs">
                      Total costs
                    </tspan>
                  </text>
                );
              }}
            />
          </Pie>
        </PieChart>
      </ChartContainer>

      <dl className="mt-2 flex flex-col gap-2 text-sm">
        {chartData.map((slice) => (
          <div key={slice.key} className="flex items-center justify-between gap-4">
            <dt className="flex items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: slice.fill }} aria-hidden="true" />
              {slice.label}
            </dt>
            <dd className="tabular text-right">
              <strong className="font-semibold">{formatINR(slice.amount, "whole")}</strong>
              <span className="ml-1.5 text-muted-foreground">{formatBps(ratioBps(slice.amount, total), 1)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
