import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AttentionCards } from "@/components/iq/attention-cards";
import { CostBreakdownDonut } from "@/components/iq/cost-breakdown-donut";
import { FoodCostChart } from "@/components/iq/food-cost-chart";
import { type Kpi, KpiCards } from "@/components/iq/kpi-cards";
import { NotSellingTable } from "@/components/iq/not-selling-table";
import { OverviewControls } from "@/components/iq/overview-controls";
import { RightNow } from "@/components/iq/right-now";
import { TopSellersTable } from "@/components/iq/top-sellers-table";
import { BarList, type BarRow, DataTrust, Panel, PanelBody, PanelFooter, PanelHeader, SectionHeading } from "@/components/iq/ui";
import { EmptyState, PermissionDenied } from "@/components/states";
import { getStaff, staffCan } from "@/lib/auth";
import { businessDate, resolveRange } from "@/lib/dates";
import {
  type OverviewRange,
  OVERVIEW_RANGES,
  alertSummary,
  attentionCards,
  compareOptions,
  costInputsConnected,
  deltaBps,
  excludedNote,
  isOverviewRange,
  resolveCompare,
} from "@/lib/iq/overview";
import { formatINR, toRupeesFloat } from "@/lib/money";
import { getDashboard, notSelling } from "@/lib/repositories/analytics";
import { foodCostWeeklySeries, getProfitAndLoss } from "@/lib/repositories/expenses";
import { countExcluded, getCostInputs, getOverviewSettings, getRangeComparison, getRightNow, productLastSales } from "@/lib/repositories/overview";

export const metadata: Metadata = { title: "FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** The clock the page is rendered against — captured with the data, not read during render. */
async function snapshot() {
  return { now: new Date() };
}

const RANGE_LABEL: Record<OverviewRange, string> = { today: "Today", yesterday: "Yesterday", "7d": "Last 7 days", "30d": "Last 30 days" };

export default async function IqPage({ searchParams }: { searchParams: Promise<{ range?: string; vs?: string }> }) {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");

  const canViewAnalytics = await staffCan("analytics.view");
  if (!canViewAnalytics) {
    return (
      <div className="mx-auto w-full max-w-6xl px-[var(--gutter)] py-8">
        <PermissionDenied action="view FRYBIRD IQ" />
      </div>
    );
  }

  const [canManageSettings, canViewMenu, { range: requestedRange, vs }, { now }] = await Promise.all([staffCan("settings.manage"), staffCan("menu.view"), searchParams, snapshot()]);
  const range: OverviewRange = isOverviewRange(requestedRange) ? requestedRange : "today";
  const rangeLabel = RANGE_LABEL[range];
  const today = businessDate(now);

  const settings = await getOverviewSettings(staff.orgId);
  const options = compareOptions(range, settings.opening, today);
  const compare = resolveCompare(options, vs);

  const monthRange = resolveRange("mtd");
  const [rightNow, comparison, week, dashboard, pnl, foodCost, gaps, lastSales, costInputs] = await Promise.all([
    getRightNow(staff.orgId, settings.kitchenCapacity, now.getTime()),
    getRangeComparison(staff.orgId, range, compare?.key ?? null, now),
    getDashboard(staff.orgId, resolveRange("7d")),
    getDashboard(staff.orgId, resolveRange(range)),
    getProfitAndLoss(staff.orgId, monthRange),
    foodCostWeeklySeries(staff.orgId),
    notSelling(staff.orgId, resolveRange(range)),
    productLastSales(staff.orgId, now),
    getCostInputs(staff.orgId),
  ]);
  const excluded = await countExcluded(staff.orgId, comparison.window);

  // Costs: two separate facts (see "Where the money goes" below).
  const directTotal = pnl.direct.reduce((s, r) => s + r.amount, 0n);
  const fixedTotal = pnl.fixed.reduce((s, r) => s + r.amount, 0n);
  const hasDirect = foodCost.some((point) => point.directCost > 0n) || directTotal > 0n;
  const operatingRecorded = fixedTotal > 0n;
  const costLines = { recorded: [hasDirect, operatingRecorded].filter(Boolean).length, total: 4 }; // food, packaging, labour, operating

  const cards = attentionCards({
    late: rightNow.late,
    prep: rightNow.prep,
    pendingCash: rightNow.pendingCash,
    unsold: lastSales.map((product) => ({ name: product.name, days: product.days, isHighestPriced: product.isHighestPriced })),
    daysOfHistory: settings.opening.date ? Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${settings.opening.date}T00:00:00Z`)) / 86_400_000)) : 0,
    costs: { directRecorded: hasDirect, operatingRecorded, operatingThisMonth: fixedTotal as never, costLinesRecorded: costLines.recorded, costLinesTotal: costLines.total },
  });

  const spark = week.series.map((point) => ({ date: point.date, rupees: toRupeesFloat(point.revenue), orders: point.orders }));
  const inputs = costInputsConnected(costInputs);
  const kpis: Kpi[] = [
    {
      kind: "real",
      title: "Revenue",
      tag: "paid orders",
      value: formatINR(comparison.current.revenue, "whole"),
      amount: toRupeesFloat(comparison.current.revenue),
      unit: "rupees",
      emphasis: true,
      deltaBps: comparison.comparison ? deltaBps(comparison.current.revenue, comparison.comparison.revenue) : null,
      comparedTo: comparison.comparison ? formatINR(comparison.comparison.revenue, "whole") : null,
      chart: "line",
      series: spark,
      seriesKey: "rupees",
      foot: "Captured payments · last 7 days shown",
      link: { label: "Channels →", href: "/app/iq/channels" },
    },
    {
      kind: "real",
      title: "Orders",
      tag: "paid",
      value: String(comparison.current.orders),
      amount: comparison.current.orders,
      unit: "count",
      deltaBps: comparison.comparison ? deltaBps(comparison.current.orders, comparison.comparison.orders) : null,
      comparedTo: comparison.comparison ? String(comparison.comparison.orders) : null,
      chart: "bars",
      series: spark,
      seriesKey: "orders",
      foot: `${rightNow.pendingCash.count} unpaid (cash) right now`,
      link: { label: "Live →", href: "/app/iq/live" },
    },
    {
      kind: "real",
      title: "Average order value",
      tag: "revenue ÷ orders",
      value: comparison.current.orders === 0 ? "—" : formatINR(comparison.currentAverage, "whole"),
      amount: toRupeesFloat(comparison.currentAverage),
      unit: "rupees",
      deltaBps: comparison.comparisonAverage ? deltaBps(comparison.currentAverage, comparison.comparisonAverage) : null,
      comparedTo: comparison.comparisonAverage ? formatINR(comparison.comparisonAverage, "whole") : null,
      chart: "line",
      series: spark.map((point) => ({ ...point, rupees: point.orders === 0 ? 0 : point.rupees / point.orders })),
      seriesKey: "rupees",
      foot: "Paid orders only",
      link: { label: "Products →", href: "/app/iq/products" },
    },
    {
      kind: "missing",
      title: "Gross profit",
      tag: "revenue − food − packaging",
      why: "Needs food and packaging cost. Revenue and discounts are already recorded.",
      foot: "Blocked by food cost",
      link: { label: "Record an expense →", href: "/app/iq/expenses/new" },
    },
    {
      kind: "missing",
      title: "Food cost %",
      tag: "COGS ÷ revenue",
      why: "No ingredient or packaging costs recorded yet. A typical QSR target is 28–32%.",
      foot: `${inputs.connected} of ${inputs.total} inputs connected`,
      link: { label: "Ingredients →", href: "/app/inventory" },
    },
    {
      kind: "missing",
      title: "Labour cost %",
      tag: "wages ÷ revenue",
      why: "No shifts or wages are recorded — labour tracking is not built yet.",
      foot: "Typical QSR target 25–30%",
      link: { label: "Profit & loss →", href: "/app/iq/pnl" },
    },
    {
      kind: "missing",
      title: "Prime cost %",
      tag: "food + labour",
      why: "Available once both food and labour cost are tracked. Typical target under 60%.",
      foot: "Blocked by 2 inputs",
      link: { label: "Profit & loss →", href: "/app/iq/pnl" },
    },
    {
      kind: "missing",
      title: "Net profit",
      tag: "after all expenses",
      why: operatingRecorded
        ? `Operating expenses (${formatINR(fixedTotal as never, "whole")} this month) are recorded; food and labour are not.`
        : "No costs recorded yet — revenue alone is not a profit figure.",
      foot: `${costLines.recorded} of ${costLines.total} cost lines recorded`,
      link: { label: "Profit & loss →", href: "/app/iq/pnl" },
    },
  ];

  // "Where money goes": every recorded cost line as a share of this month's
  // captured revenue. Only what is recorded — no "kept as profit" row until
  // every cost line is, or the remainder would be mistaken for profit.
  const monthRevenue = pnl.revenue;
  const share = (amount: bigint) => (monthRevenue > 0n ? Number(amount) / Number(monthRevenue) : 0);
  const moneyRows: BarRow[] = [...pnl.direct, ...pnl.fixed]
    .filter((row) => row.amount > 0n)
    .sort((a, b) => (a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0))
    .map((row) => ({ key: row.categoryId, label: row.name, share: share(row.amount), shareLabel: monthRevenue > 0n ? `${(share(row.amount) * 100).toFixed(1)}%` : "—", amount: formatINR(row.amount, "whole"), tone: row.behaviour === "DIRECT" ? "ramp" : "muted" }));
  const primaryKpis = kpis.slice(0, 3);
  const netProfitKpi = kpis[kpis.length - 1];
  const otherMissing = kpis.slice(3, -1);

  const clock = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
  const gst = settings.gstin ? `GSTIN ${settings.gstin}` : "GST: not registered";

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-7 px-[var(--gutter)] py-6 md:py-8">
      {/* Header: what day it is, the store's status line, the two controls, the section nav. */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-[12.5px] text-muted-foreground">{now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" })} · {rangeLabel}</p>
            <h1 className="font-heading text-[26px] font-semibold leading-[1.15] tracking-[-0.015em]">Overview</h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-[7px] rounded-full bg-gain" aria-hidden="true" />
                Open · {clock} IST
              </span>
              <span className="text-border" aria-hidden="true">|</span>
              <span>Ambala Sector 9</span>
              <span className="text-border" aria-hidden="true">|</span>
              <span>Dine-in + takeaway + delivery</span>
              <span className="text-border" aria-hidden="true">|</span>
              <span>{gst}</span>
            </p>
          </div>
          <OverviewControls range={range} compare={compare} options={options} />
        </div>
        <nav aria-label="FRYBIRD IQ sections" className="flex flex-wrap gap-x-5 gap-y-2 border-b border-border pb-2.5 text-[14px] font-semibold text-muted-foreground">
          <span aria-current="page" className="text-foreground shadow-[0_12px_0_-10px_var(--foreground)]">Overview</span>
          <Link href="/app/iq/live" className="transition-colors hover:text-foreground">Live</Link>
          <Link href="/app/iq/activity" className="transition-colors hover:text-foreground">Activity</Link>
          <Link href="/app/iq/channels" className="transition-colors hover:text-foreground">Channels</Link>
          <Link href="/app/iq/products" className="transition-colors hover:text-foreground">Products</Link>
          <Link href="/app/iq/pnl" className="transition-colors hover:text-foreground">Profit &amp; loss</Link>
          <Link href="/app/iq/expenses" className="transition-colors hover:text-foreground">Expenses</Link>
          {canManageSettings && <Link href="/app/iq/rewards" className="transition-colors hover:text-foreground">Rewards</Link>}
          {canViewMenu && <Link href="/app/iq/menu" className="transition-colors hover:text-foreground">Menu</Link>}
        </nav>
      </div>

      {/* What is happening: the three real figures and the one that is not yet. */}
      <section aria-labelledby="kpi-heading" className="flex flex-col gap-3">
        <SectionHeading id="kpi-heading" title={rangeLabel} note={`${compare ? `vs ${compare.label.toLowerCase()}` : "no comparison available"} · INR · store day`} action={<span className="font-normal text-muted-foreground">{excludedNote(excluded)}</span>} />
        <KpiCards kpis={netProfitKpi ? [...primaryKpis, netProfitKpi] : primaryKpis} />
      </section>

      {/* What needs me + right now. */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,1fr)]">
        <section aria-labelledby="now-heading" className="flex min-w-0 flex-col gap-3">
          <SectionHeading
            id="now-heading"
            title="Right now"
            note="Click a tile to see the orders behind it"
            action={
              <Link href="/app/iq/live" className="underline-offset-2 hover:underline">
                Live operations →
              </Link>
            }
          />
          <RightNow tiles={rightNow.tiles} />
        </section>

        <Panel aria-labelledby="attention-heading" className="min-w-0">
          <PanelHeader id="attention-heading" title="Needs your attention" meta={alertSummary(cards)} />
          <PanelBody>
            <AttentionCards cards={cards} />
          </PanelBody>
          <PanelFooter>
            <span>Findings and actions come only from data FRYBIRD IQ can see.</span>
          </PanelFooter>
        </Panel>
      </div>

      {/* Why: where the money goes, and what is selling. */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel aria-labelledby="money-heading" className="h-full">
            <PanelHeader id="money-heading" title="Where money goes" description={`Recorded costs, ${monthRange.label.toLowerCase()}.`} meta={monthRevenue > 0n ? `of ${formatINR(monthRevenue, "whole")} revenue` : "no revenue yet"} />
            <PanelBody className="flex flex-col gap-4">
              {moneyRows.length > 0 ? (
                <BarList rows={moneyRows} />
              ) : (
                <EmptyState title="No costs recorded yet." detail="Revenue is already tracked from your orders. Record what you spend on food and packaging to see where the money goes." action={<Link href="/app/iq/expenses/new" className="inline-flex min-h-[36px] items-center rounded-md bg-inverse px-3 text-[13px] font-semibold text-inverse-foreground">Record an expense</Link>} />
              )}
              {hasDirect && (
                <div className="border-t border-border pt-4">
                  <p className="text-[13px] font-semibold">Food cost %, by week</p>
                  <FoodCostChart points={foodCost} targetBps={pnl.foodCostTargetBps} className="mt-3" />
                  {pnl.foodCostTargetBps === null && <p className="mt-2 text-[12.5px] text-muted-foreground">No food cost target set yet, so no target line is shown.</p>}
                </div>
              )}
              {pnl.hasExpenses && <CostBreakdownDonut directTotal={directTotal as never} fixedTotal={fixedTotal as never} className="border-t border-border pt-4" />}
            </PanelBody>
            <PanelFooter>
              <span>{costLines.recorded} of {costLines.total} cost lines recorded — the remainder is not profit until every line is.</span>
              <Link href="/app/iq/pnl" className="font-semibold text-foreground underline-offset-2 hover:underline">
                Profit &amp; loss →
              </Link>
            </PanelFooter>
        </Panel>

        <div className="flex h-full flex-col gap-5">
            <Panel aria-labelledby="selling-heading">
              <PanelHeader id="selling-heading" title="Top sellers" meta={`by revenue · ${rangeLabel.toLowerCase()}`} />
              <PanelBody flush={dashboard.topProducts.length > 0}>
                {dashboard.topProducts.length === 0 ? <p className="text-[13px] text-muted-foreground">Nothing sold in this period.</p> : <TopSellersTable products={dashboard.topProducts} />}
              </PanelBody>
            </Panel>
            <Panel>
              <PanelHeader title="Not selling" meta={`on the menu, no sales ${rangeLabel.toLowerCase()}`} />
              <PanelBody flush={gaps.length > 0}>
                {gaps.length === 0 ? <p className="text-[13px] text-muted-foreground">Everything on the menu sold at least once.</p> : <NotSellingTable products={gaps} />}
              </PanelBody>
            </Panel>
        </div>
      </div>

      {/* Not yet tracked: the honest dashes, quiet, in one row. */}
      {otherMissing.length > 0 && (
        <section aria-labelledby="missing-heading" className="flex flex-col gap-3">
          <SectionHeading id="missing-heading" title="Not yet tracked" note="Each becomes real the moment its input is recorded" />
          <KpiCards kpis={otherMissing} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" />
        </section>
      )}

      <DataTrust
        items={[
          { tone: "gain", text: `Rendered ${clock} IST · captured payments only` },
          { tone: "neutral", text: `Comparison ${compare ? compare.label.toLowerCase() : "unavailable"}` },
          { tone: "neutral", text: `Opening date ${settings.opening.date ? `${settings.opening.date}${settings.opening.source === "first-order" ? " (from the first order)" : ""}` : "not set"}` },
          { tone: "neutral", text: `Ranges: ${OVERVIEW_RANGES.map((option) => option.label).join(" · ")}` },
        ]}
      />
    </div>
  );
}
