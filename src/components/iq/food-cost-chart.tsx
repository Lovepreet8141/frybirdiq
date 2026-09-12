"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type Bps, type Paise, formatBps, formatINR } from "@/lib/money";

export interface FoodCostPoint {
  readonly weekStart: string;
  readonly weekLabel: string;
  readonly revenue: Paise;
  readonly directCost: Paise;
  readonly foodCostBps: Bps | null;
}

const chartConfig = {
  foodCostPct: { label: "Food cost", color: "var(--primary)" },
} satisfies ChartConfig;

/**
 * Food cost % by week, with an optional dashed target.
 *
 * A line, not bars: this is a ratio moving over time, and the question is
 * "is it drifting" rather than "which week was biggest". The axis is scaled to
 * the data plus the target rather than 0–100 — a series that lives between 28%
 * and 34% is a flat line worth reading on a 0–100 scale and a legible one on
 * its own.
 *
 * `targetBps` is null until an owner sets one. No line is drawn rather than a
 * guessed target — a dashed line at an invented 30% would read as the owner's
 * own goal.
 */
export function FoodCostChart({
  points,
  targetBps,
  className,
}: {
  points: readonly FoodCostPoint[];
  targetBps: Bps | null;
  className?: string;
}) {
  const known = points.filter((p): p is FoodCostPoint & { foodCostBps: Bps } => p.foodCostBps !== null);
  if (known.length === 0) return null;

  const values = known.map((p) => p.foodCostBps / 100);
  const withTarget = targetBps === null ? values : [...values, targetBps / 100];
  const rawMin = Math.min(...withTarget);
  const rawMax = Math.max(...withTarget);
  // Round out to the nearest 2 points and pad, so the line never touches the
  // frame and a flat week doesn't look like it grazed the target.
  const min = Math.max(0, Math.floor((rawMin - 2) / 2) * 2);
  const max = Math.ceil((rawMax + 2) / 2) * 2;

  const chartData = points.map((p) => ({
    week: p.weekLabel,
    weekStart: p.weekStart,
    foodCostPct: p.foodCostBps === null ? null : p.foodCostBps / 100,
    revenue: p.revenue,
    directCost: p.directCost,
  }));

  const latest = known[known.length - 1]!;
  const overTarget = targetBps !== null && latest.foodCostBps > targetBps;

  return (
    <figure className={className}>
      <ChartContainer config={chartConfig} className="aspect-21/9 w-full">
        <LineChart
          accessibilityLayer
          data={chartData}
          margin={{ left: 4, right: 12, top: targetBps !== null ? 16 : 4 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis dataKey="week" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis
            domain={[min, max]}
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            tickFormatter={(value: number) => `${value}%`}
            width={40}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                indicator="line"
                labelKey="week"
                formatter={(value, _name, item) => {
                  const point = item.payload as (typeof chartData)[number];
                  return (
                    <div className="flex w-full flex-col gap-0.5">
                      <span className="tabular font-medium text-foreground">
                        {value === null ? "No revenue" : `${formatBps(Math.round(Number(value) * 100), 1)} food cost`}
                      </span>
                      <span className="tabular text-muted-foreground">
                        {formatINR(point.directCost, "whole")} on {formatINR(point.revenue, "whole")} revenue
                      </span>
                    </div>
                  );
                }}
              />
            }
          />
          {targetBps !== null && (
            <ReferenceLine
              y={targetBps / 100}
              stroke="var(--border-strong)"
              strokeWidth={1}
              strokeDasharray="4 3"
              label={{
                value: `Target ${formatBps(targetBps, 0)}`,
                position: "insideTopRight",
                fill: "var(--muted-foreground)",
                fontSize: 11,
              }}
            />
          )}
          <Line
            dataKey="foodCostPct"
            stroke="var(--color-foodCostPct)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--color-foodCostPct)" }}
            connectNulls
          />
        </LineChart>
      </ChartContainer>

      <p className="tabular mt-3 text-sm">
        Most recent week: <strong className={overTarget ? "text-destructive" : "text-foreground"}>{formatBps(latest.foodCostBps, 1)}</strong>
        {targetBps !== null && (
          <span className="text-muted-foreground"> against a target of {formatBps(targetBps, 1)}</span>
        )}
      </p>

      {/* A chart is never the only way to read the numbers. */}
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-semibold text-muted-foreground">See the figures</summary>
        <Table className="mt-2">
          <TableHeader>
            <TableRow>
              <TableHead>Week</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Direct cost</TableHead>
              <TableHead className="text-right">Food cost %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {points.map((p) => (
              <TableRow key={p.weekStart}>
                <TableCell>{p.weekLabel}</TableCell>
                <TableCell className="tabular text-right">{formatINR(p.revenue, "whole")}</TableCell>
                <TableCell className="tabular text-right">{formatINR(p.directCost, "whole")}</TableCell>
                <TableCell className="tabular text-right">{p.foodCostBps === null ? "—" : formatBps(p.foodCostBps, 1)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </figure>
  );
}
