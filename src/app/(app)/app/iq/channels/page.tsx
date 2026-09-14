import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChannelChart } from "@/components/iq/channel-chart";
import { StatTile } from "@/components/iq/stat-tile";
import { PageHeader } from "@/components/staff/page-header";
import { EmptyState, PermissionDenied } from "@/components/states";
import { ORDER_CHANNEL_LABELS } from "@/domain/order-channel";
import { requireStaff, staffCan } from "@/lib/auth";
import { type RangeKey, resolveRange } from "@/lib/dates";
import { formatBps, formatINR } from "@/lib/money";
import { getChannelBreakdown } from "@/lib/repositories/analytics";

export const metadata: Metadata = { title: "Channels", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "mtd", label: "This month" },
];

function delta(changeBps: number | null): string {
  if (changeBps === null) return "—";
  return `${changeBps > 0 ? "+" : ""}${formatBps(changeBps, 1)}`;
}

/**
 * ANALYTICS › Channels. Where the money comes from — dine-in, takeaway, the
 * website — over a range, each against the previous period of equal
 * length. Same `paidOrders` revenue definition as the Overview; nothing
 * here is a second version of the truth. Direct channels only: there are
 * no aggregators in this build (CLAUDE.md), so there is no commission line
 * and "revenue" is the full order value on every channel.
 */
export default async function ChannelsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const staff = await requireStaff();
  if (!(await staffCan("analytics.view"))) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view channel analytics" />
      </div>
    );
  }

  const { range: requested } = await searchParams;
  const key = (RANGES.find((option) => option.key === requested)?.key ?? "7d") as RangeKey;
  const range = resolveRange(key);
  const breakdown = await getChannelBreakdown(staff.orgId, range);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title="Channels"
        description={`Where revenue came from, ${range.label.toLowerCase()}, each against the previous ${range.label.toLowerCase().replace(/^(this |last )/, "")} of the same length.`}
        actions={
          <nav className="inline-flex max-w-full flex-wrap gap-0.5 rounded-[10px] border border-border bg-panel p-1" aria-label="Period">
            {RANGES.map((option) => (
              <Link
                key={option.key}
                href={`/app/iq/channels?range=${option.key}`}
                aria-current={option.key === key ? "page" : undefined}
                className={
                  option.key === key
                    ? "flex h-9 items-center rounded-[7px] bg-secondary px-3.5 text-[13px] font-semibold text-foreground md:h-8"
                    : "flex h-9 items-center rounded-[7px] px-3.5 text-[13px] font-medium text-muted-foreground transition-colors duration-[120ms] hover:text-foreground md:h-8"
                }
              >
                {option.label}
              </Link>
            ))}
          </nav>
        }
      />

      {breakdown.empty ? (
        <EmptyState title="No paid orders in this period." detail="Revenue by channel appears once an order in this range has been paid for." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {breakdown.channels.map((stat) => (
              <StatTile
                key={stat.channel}
                label={ORDER_CHANNEL_LABELS[stat.channel]}
                value={formatINR(stat.revenue.value, "whole")}
                changeBps={stat.revenue.changeBps}
                comparedTo="the previous period"
                detail={`${formatBps(stat.shareBps, 1)} of revenue · ${stat.orders.value} ${stat.orders.value === 1 ? "order" : "orders"}`}
              />
            ))}
          </div>

          <Card>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-heading text-lg font-semibold">Revenue by day, by channel</h2>
                <span className="tabular text-sm text-muted-foreground">{formatINR(breakdown.total, "whole")} total</span>
              </div>
              <ChannelChart series={breakdown.series} />
            </CardContent>
          </Card>

          <div className="overflow-hidden rounded-xl border border-border bg-panel">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">vs previous</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">vs previous</TableHead>
                  <TableHead className="text-right">Average order</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breakdown.channels.map((stat) => (
                  <TableRow key={stat.channel}>
                    <TableCell className="font-semibold">{ORDER_CHANNEL_LABELS[stat.channel]}</TableCell>
                    <TableCell className="tabular text-right font-semibold">{formatINR(stat.revenue.value, "whole")}</TableCell>
                    <TableCell className="tabular hidden text-right text-muted-foreground sm:table-cell">{delta(stat.revenue.changeBps)}</TableCell>
                    <TableCell className="tabular text-right">{stat.orders.value}</TableCell>
                    <TableCell className="tabular hidden text-right text-muted-foreground sm:table-cell">{delta(stat.orders.changeBps)}</TableCell>
                    <TableCell className="tabular text-right">{stat.orders.value === 0 ? "—" : formatINR(stat.averageOrder.value, "whole")}</TableCell>
                    <TableCell className="tabular hidden text-right text-muted-foreground md:table-cell">{formatBps(stat.shareBps, 1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
