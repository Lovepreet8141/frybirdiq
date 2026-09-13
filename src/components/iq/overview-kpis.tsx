"use client";

import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from "lucide-react";
import { Bar, BarChart, Dot, LabelList, Line, LineChart } from "recharts";
import { Delta } from "@/components/iq/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Separator } from "@/components/ui/separator";
import { formatBps } from "@/lib/money";

/**
 * The three "how did today go" figures, recomposed on the purchased kit's
 * Default dashboard cards (`app/dashboard/(auth)/default/components`):
 * Total Revenue with a sparkline, Subscriptions with mini bars, and the
 * ecommerce stat card for the average.
 *
 * Data is exactly what the old StatTiles showed — `getTodayComparison` for
 * the numbers and deltas, the last seven business days from `getDashboard`
 * for the shapes behind them. Nothing is computed here: every figure a
 * person reads arrives already formatted from paise on the server, and the
 * floats exist only for recharts' geometry (see `ChannelChart` for why).
 *
 * Deltas keep the accessible form (`Delta`: arrow + sign + words), not the
 * kit's colour-only "+20.1%" — a figure that moved never relies on green.
 *
 * Series colour is `--chart-5` (ink grey), not `--chart-1`: on the IQ surface
 * chart-1 is the brand red, and red is what an alert looks like here. A
 * sparkline of ordinary Tuesdays should not read as a warning.
 */

export interface SparkPoint {
  readonly date: string;
  /** "Mon 8 Sep" — for the tooltip. */
  readonly label: string;
  /** Float, chart geometry only. */
  readonly rupees: number;
  /** The real figure, formatted on the server. */
  readonly formatted: string;
  readonly orders: number;
}

export interface KpiFigure {
  readonly value: string;
  readonly changeBps: number | null;
  readonly secondaryChangeBps: number | null;
  readonly detail?: string;
}

const revenueConfig = { rupees: { label: "Revenue", color: "var(--chart-5)" } } satisfies ChartConfig;
const ordersConfig = { orders: { label: "Orders", color: "var(--chart-5)" } } satisfies ChartConfig;

function Comparisons({ figure }: { figure: KpiFigure }) {
  return (
    <div className="mt-1.5 flex flex-col gap-0.5">
      {typeof figure.changeBps === "number" ? (
        <Delta changeBps={figure.changeBps} comparedTo="yesterday" />
      ) : (
        <p className="text-sm text-muted-foreground">{figure.detail ?? "No earlier period to compare"}</p>
      )}
      {typeof figure.secondaryChangeBps === "number" && <Delta changeBps={figure.secondaryChangeBps} comparedTo="the same day last week" />}
    </div>
  );
}

function SparkTooltip({ active, payload }: { active?: boolean; payload?: readonly { payload: SparkPoint }[] }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-lg border border-border bg-background p-2 text-xs shadow-xs">
      <p className="text-muted-foreground">{point.label}</p>
      <p className="tabular font-semibold">{point.formatted}</p>
      <p className="tabular text-muted-foreground">
        {point.orders} {point.orders === 1 ? "order" : "orders"}
      </p>
    </div>
  );
}

/** The kit stat card's footer: a rule, then a quiet "view more" link pinned to the bottom of the card. */
function FooterLink({ href, label }: { href: string; label: string }) {
  return (
    <div className="mt-auto pt-3">
      <Separator className="mb-3" />
      <Link href={href} className="flex w-full items-center justify-between text-xs text-muted-foreground hover:text-foreground">
        {label}
        <ArrowRight className="size-3" aria-hidden="true" />
      </Link>
    </div>
  );
}

/* Each card fills its grid cell (`h-full`) and lays its content out as a
   column so the footer link sits on the same baseline across the row,
   whatever each card has above it. */
const cardClass = "h-full";
const contentClass = "flex flex-1 flex-col";

export function RevenueCard({ figure, series }: { figure: KpiFigure; series: readonly SparkPoint[] }) {
  return (
    <Card className={cardClass}>
      <CardHeader>
        <CardTitle>Revenue</CardTitle>
      </CardHeader>
      <CardContent className={contentClass}>
        <div className="tabular font-heading text-3xl font-bold leading-6">{figure.value}</div>
        <Comparisons figure={figure} />
        <ChartContainer className="mt-4 h-[100px] w-full" config={revenueConfig}>
          <LineChart data={series} accessibilityLayer margin={{ top: 8, right: 8, left: 8 }}>
            <ChartTooltip cursor={false} content={<SparkTooltip />} />
            <Line
              dataKey="rupees"
              stroke="var(--color-rupees)"
              strokeWidth={2}
              isAnimationActive={false}
              dot={({ payload, ...props }) => (
                <Dot key={(payload as SparkPoint).date} r={4} cx={props.cx} cy={props.cy} fill="var(--background)" stroke="var(--color-rupees)" />
              )}
            />
          </LineChart>
        </ChartContainer>
        <p className="mt-1 text-xs text-muted-foreground">Last 7 days, by day</p>
        <FooterLink href="/app/iq?range=7d" label="Sales, last 7 days" />
      </CardContent>
    </Card>
  );
}

export function OrdersCard({ figure, series }: { figure: KpiFigure; series: readonly SparkPoint[] }) {
  return (
    <Card className={cardClass}>
      <CardHeader>
        <CardTitle>Orders</CardTitle>
      </CardHeader>
      <CardContent className={contentClass}>
        <div className="tabular font-heading text-3xl font-bold leading-6">{figure.value}</div>
        <Comparisons figure={figure} />
        <ChartContainer className="mt-6 h-[85px] w-full" config={ordersConfig}>
          <BarChart data={series} accessibilityLayer margin={{ top: 22, right: 0, left: 0 }}>
            <ChartTooltip cursor={false} content={<SparkTooltip />} />
            <Bar dataKey="orders" fill="var(--color-orders)" radius={5} isAnimationActive={false}>
              <LabelList position="top" offset={12} className="fill-foreground tabular" fontSize={12} />
            </Bar>
          </BarChart>
        </ChartContainer>
        <p className="mt-1 text-xs text-muted-foreground">Last 7 days, by day</p>
        <FooterLink href="/app/iq/live" label="Live operations" />
      </CardContent>
    </Card>
  );
}

/** The kit's ecommerce stat card: title, figure with a badge, a rule, a "view more" link. */
export function AverageOrderCard({ figure }: { figure: KpiFigure }) {
  const change = figure.changeBps;
  const up = typeof change === "number" && change > 0;
  const flat = change === 0;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;

  return (
    <Card className={cardClass}>
      <CardHeader>
        <CardTitle>Average order</CardTitle>
      </CardHeader>
      <CardContent className={contentClass}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="tabular font-heading text-3xl font-bold leading-6">{figure.value}</span>
          {typeof change === "number" && (
            <Badge variant={flat ? "secondary" : up ? "success" : "destructive"} className="tabular">
              <Icon aria-hidden="true" />
              {up ? "+" : ""}
              {formatBps(change, 1)}
              <span className="sr-only"> vs yesterday</span>
            </Badge>
          )}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {typeof change === "number" ? "vs yesterday, at this time of day" : (figure.detail ?? "No earlier period to compare")}
        </p>
        {typeof figure.secondaryChangeBps === "number" && (
          <div className="mt-2">
            <Delta changeBps={figure.secondaryChangeBps} comparedTo="the same day last week" />
          </div>
        )}
        <FooterLink href="/app/iq/pnl" label="Profit and loss" />
      </CardContent>
    </Card>
  );
}
