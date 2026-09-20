import type { Metadata } from "next";
import { PeriodSwitch } from "@/components/iq/period-switch";
import { DataTrust, KpiTile, Panel, PanelBody, PanelHeader } from "@/components/iq/ui";
import { PageHeader } from "@/components/staff/page-header";
import { EmptyState, PermissionDenied } from "@/components/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireStaff, staffCan } from "@/lib/auth";
import { type RangeKey, resolveRange } from "@/lib/dates";
import type { Summary } from "@/lib/kitchen/analytics";
import { getKitchenAnalytics } from "@/lib/repositories/kitchen-analytics";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Kitchen analytics", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

/** "9 min 30 s", or "no data". Presentation only: every figure arrives already computed. */
function duration(seconds: number | undefined): string {
  if (seconds === undefined) return "no data";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes === 0 ? `${rest} s` : rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

function hourLabel(hour: number): string {
  const next = (hour + 1) % 24;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hour)}:00–${pad(next)}:00`;
}

const DEFINITIONS = [
  "Prep time is the time from an order being accepted to the first time it is marked ready, from the order history.",
  "A product's figure is the prep time of every order it appeared in, counted once per order. It is the whole order's time, not a stopwatch on that product.",
  "p50 is the median, p90 means nine in ten orders were ready at least this fast (nearest-rank). Orders are counted on the day they were marked ready. Hours are the IST hour the order was accepted.",
  "The target is the product's prep time set in the menu today, if any. Blank means none is set.",
];

/**
 * OPERATIONS › Kitchen analytics (roadmap 4.4). Read-only facts from
 * `order_events`: how long orders took from accepted to ready, by product and
 * by hour. No forecast, no money. Gate: analytics.view or kitchen.view.
 */
export default async function KitchenAnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const staff = await requireStaff();
  const [canAnalytics, canKitchen] = await Promise.all([staffCan("analytics.view"), staffCan("kitchen.view")]);
  if (!canAnalytics && !canKitchen) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view kitchen analytics" />
      </div>
    );
  }

  const { range: requested } = await searchParams;
  const key = (RANGES.find((option) => option.key === requested)?.key ?? "7d") as RangeKey;
  const range = resolveRange(key);
  const result = await getKitchenAnalytics(staff.orgId, range);
  const window = range.label.toLowerCase();
  const slowest = result.products.slice(0, 5);
  const overall: Summary | null = result.overall;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title="Kitchen analytics"
        description={`How long orders took from accepted to ready, ${window}. Facts from the order history; nothing is forecast.`}
        actions={<PeriodSwitch basePath="/app/iq/kitchen" options={RANGES} current={key} />}
      />

      {overall === null ? (
        <EmptyState title={`No orders were marked ready ${window}`} detail="Prep times appear once an order that was accepted has been marked ready. Try a wider period." />
      ) : (
        <>
          <DataTrust items={[{ tone: "gain", text: `${overall.count} ${overall.count === 1 ? "order" : "orders"} marked ready ${window}` }, { tone: "neutral", text: "Times are accepted to ready" }]} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiTile label="Median prep time" meta="p50, all orders" value={duration(overall.p50)} note={`${overall.count} orders, ${window}`} />
            <KpiTile label="Slow-end prep time" meta="p90, all orders" value={duration(overall.p90)} note="Nine in ten orders were ready at least this fast" />
            <KpiTile label="Average prep time" meta="mean, all orders" value={duration(overall.mean)} note={`${overall.count} orders, ${window}`} />
          </div>

          <Panel>
            <PanelHeader title="Slowest five products" description={`By median prep time of the orders they appeared in, ${window}. Orders behind each figure are shown.`} />
            <PanelBody flush className="border-t border-border pb-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Median (p50)</TableHead>
                    <TableHead className="text-right">p90</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Target</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slowest.map((row) => (
                    <TableRow key={row.productKey}>
                      <TableCell className="font-semibold">{row.productName}</TableCell>
                      <TableCell className={cn("tabular text-right font-semibold", row.targetMinutes !== null && row.summary.p50 > row.targetMinutes * 60 && "text-loss")}>{duration(row.summary.p50)}</TableCell>
                      <TableCell className="tabular text-right">{duration(row.summary.p90)}</TableCell>
                      <TableCell className="tabular text-right">{row.summary.count}</TableCell>
                      <TableCell className="tabular hidden text-right text-muted-foreground sm:table-cell">{row.targetMinutes === null ? "not set" : `${row.targetMinutes} min`}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="By hour" description={`Prep time by the IST hour the order was accepted, ${window}. Hours with no orders are not listed.`} />
            <PanelBody flush className="border-t border-border pb-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hour (IST)</TableHead>
                    <TableHead className="text-right">Median (p50)</TableHead>
                    <TableHead className="text-right">p90</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.hours.map((row) => (
                    <TableRow key={row.hour}>
                      <TableCell className="tabular font-semibold">{hourLabel(row.hour)}</TableCell>
                      <TableCell className="tabular text-right">{duration(row.summary.p50)}</TableCell>
                      <TableCell className="tabular text-right">{duration(row.summary.p90)}</TableCell>
                      <TableCell className="tabular text-right">{row.summary.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="How these are worked out" />
            <PanelBody>
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
                {DEFINITIONS.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </PanelBody>
          </Panel>
        </>
      )}
    </div>
  );
}
