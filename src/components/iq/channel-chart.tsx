"use client";

import { Bar, BarChart, XAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { ORDER_CHANNELS, ORDER_CHANNEL_LABELS, type OrderChannel } from "@/domain/order-channel";
import { type Paise, formatINR, toRupeesFloat } from "@/lib/money";

export interface ChannelDay {
  readonly date: string;
  readonly byChannel: Readonly<Record<OrderChannel, Paise>>;
}

/**
 * Three distinct hues from the IQ chart tokens, none of them the success
 * green — that colour is reserved for status, and a channel is not a status.
 */
const chartConfig = {
  DINE_IN: { label: ORDER_CHANNEL_LABELS.DINE_IN, color: "var(--chart-1)" },
  TAKEAWAY: { label: ORDER_CHANNEL_LABELS.TAKEAWAY, color: "var(--chart-4)" },
  ONLINE: { label: ORDER_CHANNEL_LABELS.ONLINE, color: "var(--chart-3)" },
} satisfies ChartConfig;

/**
 * Revenue by day, stacked by channel. Adapted from the purchased
 * `ecommerce-chart1` block (Card + BarChart + XAxis + tooltip); its grouped
 * bars became a stack because the question here is "how much of each day
 * was each channel", not "which is bigger".
 *
 * The float `rupees` fields exist only for recharts' geometry — see
 * `CostBreakdownDonut` for why a bigint there renders nothing. Every figure
 * a person reads (tooltip, legend) is formatted from the real Paise carried
 * alongside in `amounts`.
 */
export function ChannelChart({ series }: { series: readonly ChannelDay[] }) {
  const data = series.map((point) => ({
    date: point.date,
    DINE_IN: toRupeesFloat(point.byChannel.DINE_IN),
    TAKEAWAY: toRupeesFloat(point.byChannel.TAKEAWAY),
    ONLINE: toRupeesFloat(point.byChannel.ONLINE),
    amounts: point.byChannel,
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
                const channel = name as OrderChannel;
                return (
                  <div className="flex w-full items-center justify-between gap-4">
                    <span className="text-muted-foreground">{ORDER_CHANNEL_LABELS[channel]}</span>
                    <span className="tabular font-medium text-foreground">{formatINR(row.amounts[channel], "whole")}</span>
                  </div>
                );
              }}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {ORDER_CHANNELS.map((channel, index) => (
          <Bar
            key={channel}
            dataKey={channel}
            stackId="day"
            fill={`var(--color-${channel})`}
            radius={index === ORDER_CHANNELS.length - 1 ? [4, 4, 0, 0] : 0}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
