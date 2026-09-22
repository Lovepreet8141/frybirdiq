import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { CommandCenterNav } from "@/components/iq/command-center-nav";
import { OrderHealthStrip } from "@/components/iq/order-health-strip";
import { OverviewControls } from "@/components/iq/overview-controls";
import { ActivityCard } from "@/components/iq/overview/activity-card";
import { AttentionCard } from "@/components/iq/overview/attention-card";
import { ChannelPerformanceCard } from "@/components/iq/overview/channel-performance-card";
import { KpiCompact } from "@/components/iq/overview/kpi-compact";
import { OpenOrdersCard } from "@/components/iq/overview/open-orders-card";
import { PaymentMethodsCard } from "@/components/iq/overview/payment-methods-card";
import { ProductsCard } from "@/components/iq/overview/products-card";
import { SalesTrendCard } from "@/components/iq/overview/sales-trend-card";
import { ReadinessPanel } from "@/components/iq/readiness-panel";
import { RightNow } from "@/components/iq/right-now";
import { DataTrust } from "@/components/iq/ui";
import { MotionStagger, MotionStaggerItem } from "@/components/motion";
import { PermissionDenied } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getStaff, staffCan } from "@/lib/auth";
import { businessDate, resolveRange } from "@/lib/dates";
import { attentionInput, urgentCount } from "@/lib/iq/alerts";
import { type ReadinessCard, limitedReasons } from "@/lib/iq/readiness/scores";
import { type OverviewRange, OVERVIEW_RANGES, attentionCards, compareOptions, deltaBps, excludedNote, isMultiDay, isOverviewRange, resolveCompare } from "@/lib/iq/overview";
import { healthCounts, toKitchenTickets } from "@/lib/kitchen/tickets";
import { type Paise, formatINR } from "@/lib/money";
import { listRecentOrderEvents } from "@/lib/repositories/activity";
import { getChannelBreakdown, getDashboard, notSelling } from "@/lib/repositories/analytics";
import { foodCostWeeklySeries, getProfitAndLoss } from "@/lib/repositories/expenses";
import { getPaymentsLedger } from "@/lib/repositories/finance";
import { getReadiness } from "@/lib/repositories/iq-readiness";
import { getPrepTargets } from "@/lib/repositories/kitchen-targets";
import { listActiveOrders } from "@/lib/repositories/orders";
import { countExcluded, getOverviewSettings, getRangeComparison, getRightNow, productLastSales } from "@/lib/repositories/overview";
import { METHOD_LABELS } from "@/lib/finance/ledger-view";

export const metadata: Metadata = { title: "FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const RANGE_LABEL: Record<OverviewRange, string> = { today: "Today", yesterday: "Yesterday", "7d": "Last 7 days", "30d": "Last 30 days" };

/**
 * COMMAND CENTER › Overview. The purchased Sales dashboard's first row
 * (an 8-col chart beside a 4-col 2×2 of compact KPIs) over the E-commerce
 * dashboard's lower page (4/4/4, then 8/4, then 8/4). Every figure is a
 * repository field the rest of IQ already reads; nothing on this page is
 * computed a second way, and every card is a door to the screen that
 * explains it.
 */
export default async function IqPage({ searchParams }: { searchParams: Promise<{ range?: string; vs?: string }> }) {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("analytics.view"))) {
    return (
      <div className="mx-auto w-full max-w-6xl px-[var(--gutter)] py-8">
        <PermissionDenied action="view FRYBIRD IQ" />
      </div>
    );
  }

  const [{ range: requestedRange, vs }, canSeeFinance] = await Promise.all([searchParams, staffCan("finance.view")]);
  const now = new Date();
  const range: OverviewRange = isOverviewRange(requestedRange) ? requestedRange : "today";
  const rangeLabel = RANGE_LABEL[range];
  const today = businessDate(now);
  const window = resolveRange(range);

  const settings = await getOverviewSettings(staff.orgId);
  const options = compareOptions(range, settings.opening, today);
  const compare = resolveCompare(options, vs);

  const [rightNow, comparison, week, dashboard, channels, ledger, pnl, foodCost, gaps, lastSales, activeOrders, events, readiness] = await Promise.all([
    getRightNow(staff.orgId, settings.kitchenCapacity, now.getTime()),
    getRangeComparison(staff.orgId, range, compare?.key ?? null, now),
    getDashboard(staff.orgId, resolveRange("7d")),
    getDashboard(staff.orgId, window),
    getChannelBreakdown(staff.orgId, window),
    getPaymentsLedger(staff.orgId, window),
    getProfitAndLoss(staff.orgId, resolveRange("mtd")),
    foodCostWeeklySeries(staff.orgId),
    notSelling(staff.orgId, window),
    productLastSales(staff.orgId, now),
    listActiveOrders(staff.orgId),
    listRecentOrderEvents(staff.orgId, 8),
    // A readiness query that throws must not take the Overview down: the panel is replaced by a note and every card that leans on it is marked limited (never silently "trusted").
    getReadiness(staff.orgId, now).catch((error: unknown) => {
      console.error("iq overview: readiness could not be read", error instanceof Error ? error.name : "unknown");
      return null;
    }),
  ]);
  const limitedFor = (card: ReadinessCard): readonly string[] => (readiness ? limitedReasons(readiness, card) : ["Readiness could not be read just now"]);
  const excluded = await countExcluded(staff.orgId, comparison.window);

  // Order health (roadmap 4.3): the same prep-target rule as the kitchen display and Live operations, over the
  // active orders already read above — no second query for the order list, just the prep targets to judge them by.
  const prepTargets = await getPrepTargets(staff.orgId, activeOrders.map((order) => order.id));
  const orderHealth = healthCounts(toKitchenTickets(activeOrders, prepTargets), now.getTime());

  const directTotal = pnl.direct.reduce((sum, row) => sum + row.amount, 0n) as Paise;
  const fixedTotal = pnl.fixed.reduce((sum, row) => sum + row.amount, 0n) as Paise;
  const cards = attentionCards(
    attentionInput({
      late: rightNow.late,
      prep: rightNow.prep,
      pendingCash: rightNow.pendingCash,
      unsold: lastSales.map((product) => ({ name: product.name, days: product.days, isHighestPriced: product.isHighestPriced })),
      openingDate: settings.opening.date,
      today,
      directTotal,
      fixedTotal,
      anyWeeklyDirectCost: foodCost.some((point) => point.directCost > 0n),
    }),
  );
  const costLinesRecorded = [foodCost.some((point) => point.directCost > 0n) || directTotal > 0n, fixedTotal > 0n].filter(Boolean).length;

  const trend = isMultiDay(range) ? dashboard.series : week.series;
  const trendLabel = isMultiDay(range) ? rangeLabel : "Last 7 days";
  const comparedTo = compare ? `vs ${compare.label.toLowerCase()}` : "no comparison available";

  const clock = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
  const gst = settings.gstin ? `GSTIN ${settings.gstin}` : "GST: not registered";

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-[var(--gutter)] py-6 lg:gap-6 md:py-8">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-[12.5px] text-muted-foreground">
              {now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" })} · {rangeLabel}
            </p>
            <h1 className="font-heading text-[24px] font-semibold leading-[1.15] tracking-[-0.015em] lg:text-[26px]">Overview</h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-[7px] rounded-full bg-gain" aria-hidden="true" />
                Open · {clock} IST
              </span>
              <span className="text-border" aria-hidden="true">
                |
              </span>
              <span>Ambala Sector 9</span>
              <span className="text-border" aria-hidden="true">
                |
              </span>
              <span>Dine-in · takeaway · delivery</span>
              <span className="text-border" aria-hidden="true">
                |
              </span>
              <span>{gst}</span>
            </p>
          </div>
          <OverviewControls range={range} compare={compare} options={options} />
        </div>
        <CommandCenterNav current="overview" alertCount={urgentCount(cards)} />
      </div>

      <MotionStagger className="grid gap-4 lg:grid-cols-12 lg:gap-6" count={10}>
        {/* Row 1 — the Sales dashboard's first row: trend beside four compact figures. */}
        <MotionStaggerItem className="lg:col-span-8">
          <SalesTrendCard series={trend} periodLabel={trendLabel} />
        </MotionStaggerItem>
        <MotionStaggerItem className="grid h-full auto-rows-fr grid-cols-2 gap-4 lg:col-span-4 lg:gap-6">
          <KpiCompact
            label="Revenue"
            value={formatINR(comparison.current.revenue, "whole")}
            deltaBps={comparison.comparison ? deltaBps(comparison.current.revenue, comparison.comparison.revenue) : null}
            note={comparison.comparison ? `${comparedTo} ${formatINR(comparison.comparison.revenue, "whole")}` : "Captured payments only"}
            href={canSeeFinance ? "/app/finance" : "/app/iq/channels"}
            linkLabel={canSeeFinance ? "Finance" : "Channels"}
            emphasis
          />
          <KpiCompact
            label="Paid orders"
            value={String(comparison.current.orders)}
            deltaBps={comparison.comparison ? deltaBps(comparison.current.orders, comparison.comparison.orders) : null}
            note={comparison.comparison ? `${comparedTo} ${comparison.comparison.orders}` : `${rightNow.pendingCash.count} unpaid cash right now`}
            href="/app/orders"
            linkLabel="Orders"
          />
          <KpiCompact
            label="Average order"
            value={comparison.current.orders === 0 ? "—" : formatINR(comparison.currentAverage, "whole")}
            missing={comparison.current.orders === 0}
            deltaBps={comparison.comparisonAverage ? deltaBps(comparison.currentAverage, comparison.comparisonAverage) : null}
            note={comparison.current.orders === 0 ? "No paid orders yet" : comparison.comparisonAverage ? `${comparedTo} ${formatINR(comparison.comparisonAverage, "whole")}` : "Revenue ÷ paid orders"}
            href="/app/iq/products"
            linkLabel="Products"
          />
          <KpiCompact
            label="Net profit · month"
            limited={limitedFor("netProfit")}
            value={pnl.hasExpenses ? formatINR(pnl.result.netProfit, "whole") : "—"}
            missing={!pnl.hasExpenses}
            note={pnl.hasExpenses ? `${costLinesRecorded} of 4 cost lines recorded` : "Not yet tracked — record what you spend"}
            href="/app/iq/pnl"
            linkLabel="Profit & loss"
          />
        </MotionStaggerItem>

        {/* Readiness: how far the record-keeping behind these numbers can be trusted. Read-only. */}
        <MotionStaggerItem className="lg:col-span-12">
          {readiness ? <ReadinessPanel readiness={readiness} /> : <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">Readiness could not be read just now, so the cards that depend on it are marked limited. Reload to try again.</p>}
        </MotionStaggerItem>

        {/* Row 2 — the E-commerce dashboard's 4 / 4 / 4. */}
        <MotionStaggerItem className="lg:col-span-4">
          <ChannelPerformanceCard limited={limitedFor("channels")} channels={channels.channels.map((stat) => ({ channel: stat.channel, revenue: stat.revenue.value, orders: stat.orders.value, shareBps: stat.shareBps, changeBps: stat.revenue.changeBps }))} total={channels.total} periodLabel={rangeLabel} />
        </MotionStaggerItem>
        <MotionStaggerItem className="lg:col-span-4">
          <PaymentMethodsCard limited={limitedFor("paymentMethods")} methods={ledger.byMethod.map((row) => ({ method: row.method, label: METHOD_LABELS[row.method], count: row.count, total: row.total }))} capturedTotal={ledger.capturedTotal} periodLabel={rangeLabel} />
        </MotionStaggerItem>
        <MotionStaggerItem className="lg:col-span-4">
          <AttentionCard cards={cards} limited={limitedFor("attention")} />
        </MotionStaggerItem>

        {/* Row 3 — 8 / 4: what the kitchen and counter look like right now, and what is selling. */}
        <MotionStaggerItem className="lg:col-span-8">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Order health right now</CardTitle>
              <CardDescription>Click a tile to see the orders behind it</CardDescription>
              <CardAction>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/app/iq/live">
                    Live operations
                    <ArrowRight data-icon="inline-end" aria-hidden="true" />
                  </Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <OrderHealthStrip counts={orderHealth} />
              <RightNow tiles={rightNow.tiles} />
            </CardContent>
          </Card>
        </MotionStaggerItem>
        <MotionStaggerItem className="lg:col-span-4">
          <ProductsCard limited={limitedFor("topProducts")} top={dashboard.topProducts} gaps={gaps} periodLabel={rangeLabel} />
        </MotionStaggerItem>

        {/* Row 4 — 8 / 4: the open orders table and the latest movements. */}
        <MotionStaggerItem className="lg:col-span-8">
          <OpenOrdersCard
            orders={activeOrders.map((order) => ({
              id: order.id,
              orderNumber: order.orderNumber,
              status: order.status,
              fulfilment: order.fulfilment,
              customerName: order.customerName,
              tableName: order.tableName,
              items: order.items,
              grandTotal: order.grandTotal,
              isPaid: order.isPaid,
              placedAt: order.placedAt,
              estimatedReadyAt: order.estimatedReadyAt,
            }))}
            now={now.getTime()}
          />
        </MotionStaggerItem>
        <MotionStaggerItem className="lg:col-span-4">
          <ActivityCard events={events.map((event) => ({ id: event.id, orderId: event.orderId, orderNumber: event.orderNumber, to: event.to, actorName: event.actorName, at: event.at }))} />
        </MotionStaggerItem>
      </MotionStagger>

      <DataTrust
        items={[
          { tone: "gain", text: `Rendered ${clock} IST · captured payments only` },
          { tone: "neutral", text: `Comparison ${compare ? compare.label.toLowerCase() : "unavailable"} · ${excludedNote(excluded)}` },
          { tone: "neutral", text: `Opening date ${settings.opening.date ? `${settings.opening.date}${settings.opening.source === "first-order" ? " (from the first order)" : ""}` : "not set"}` },
          { tone: "neutral", text: `Ranges: ${OVERVIEW_RANGES.map((option) => option.label).join(" · ")}` },
        ]}
      />
    </div>
  );
}
