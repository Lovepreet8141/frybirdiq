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
import { EmptyState, PermissionDenied } from "@/components/states";
import { MotionReveal } from "@/components/motion";
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
      tag: "PAID ORDERS",
      value: formatINR(comparison.current.revenue, "whole"),
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
      tag: "PAID",
      value: String(comparison.current.orders),
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
      tag: "REVENUE ÷ ORDERS",
      value: comparison.current.orders === 0 ? "—" : formatINR(comparison.currentAverage, "whole"),
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
      tag: "REVENUE − FOOD − PACKAGING",
      why: "Needs food and packaging cost. Revenue and discounts are already recorded.",
      foot: "Blocked by food cost",
      link: { label: "Record an expense →", href: "/app/iq/expenses/new" },
    },
    {
      kind: "missing",
      title: "Food cost %",
      tag: "COGS ÷ REVENUE",
      why: "No ingredient or packaging costs recorded yet. A typical QSR target is 28–32%.",
      foot: `${inputs.connected} of ${inputs.total} inputs connected`,
      link: { label: "Ingredients →", href: "/app/inventory" },
    },
    {
      kind: "missing",
      title: "Labour cost %",
      tag: "WAGES ÷ REVENUE",
      why: "No shifts or wages are recorded — labour tracking is not built yet.",
      foot: "Typical QSR target 25–30%",
      link: { label: "Profit & loss →", href: "/app/iq/pnl" },
    },
    {
      kind: "missing",
      title: "Prime cost %",
      tag: "FOOD + LABOUR",
      why: "Available once both food and labour cost are tracked. Typical target under 60%.",
      foot: "Blocked by 2 inputs",
      link: { label: "Profit & loss →", href: "/app/iq/pnl" },
    },
    {
      kind: "missing",
      title: "Net profit",
      tag: "AFTER ALL EXPENSES",
      why: operatingRecorded
        ? `Operating expenses (${formatINR(fixedTotal as never, "whole")} this month) are recorded; food and labour are not.`
        : "No costs recorded yet — revenue alone is not a profit figure.",
      foot: `${costLines.recorded} of ${costLines.total} cost lines recorded`,
      link: { label: "Profit & loss →", href: "/app/iq/pnl" },
    },
  ];

  const clock = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
  const gst = settings.gstin ? `GSTIN ${settings.gstin}` : "GST: not registered";

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8 px-[var(--gutter)] py-8">
      {/* Header: title, the store's status line, the two controls, the section nav. */}
      <div className="flex flex-col gap-[18px]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="font-heading text-[30px] font-semibold tracking-[-0.01em]">Overview</h1>
            <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-[7px] rounded-full bg-success" aria-hidden="true" />
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
        <nav aria-label="FRYBIRD IQ sections" className="flex flex-wrap gap-x-[22px] gap-y-2 border-b border-border pb-3 text-base font-semibold text-muted-foreground">
          <span aria-current="page" className="text-foreground shadow-[0_13px_0_-11px_var(--foreground)]">Overview</span>
          <Link href="/app/iq/live" className="hover:text-foreground">Live</Link>
          <Link href="/app/iq/activity" className="hover:text-foreground">Activity</Link>
          <Link href="/app/iq/channels" className="hover:text-foreground">Channels</Link>
          <Link href="/app/iq/products" className="hover:text-foreground">Products</Link>
          <Link href="/app/iq/pnl" className="hover:text-foreground">Profit &amp; loss</Link>
          <Link href="/app/iq/expenses" className="hover:text-foreground">Expenses</Link>
          {canManageSettings && <Link href="/app/iq/rewards" className="hover:text-foreground">Rewards</Link>}
          {canViewMenu && <Link href="/app/iq/menu" className="hover:text-foreground">Menu</Link>}
        </nav>
      </div>

      {/* Right now */}
      <section aria-labelledby="now-heading" className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 id="now-heading" className="font-heading text-[22px] font-semibold">Right now</h2>
            <span className="text-[13px] text-muted-foreground">Click a tile to see the orders behind it</span>
          </div>
          <Link href="/app/iq/live" className="text-[15px] font-semibold underline-offset-2 hover:underline">
            Live operations →
          </Link>
        </div>
        <RightNow tiles={rightNow.tiles} />
      </section>

      {/* Needs attention */}
      <section aria-labelledby="attention-heading" className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 id="attention-heading" className="font-heading text-[22px] font-semibold">Needs attention</h2>
            <span className="text-[13px] text-muted-foreground">{alertSummary(cards)}</span>
          </div>
          <span className="text-[13px] text-muted-foreground">Causes and actions are derived only from data FRYBIRD IQ can see</span>
        </div>
        <AttentionCards cards={cards} />
      </section>

      {/* KPI row */}
      <section aria-labelledby="kpi-heading" className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 id="kpi-heading" className="font-heading text-[22px] font-semibold">{rangeLabel}</h2>
            <span className="text-[13px] text-muted-foreground">
              {compare ? `vs ${compare.label.toLowerCase()}` : "no comparison available"} · INR · local store day
            </span>
          </div>
          <span className="text-[13px] text-muted-foreground">{excludedNote(excluded)}</span>
        </div>
        <KpiCards kpis={kpis} />
      </section>

      {/* Where the money goes — this month so far. Two separate facts: any
          expense (`pnl.hasExpenses` → donut) and any food/packaging cost
          (`hasDirect` → food cost % chart). Replaced by Slice C. */}
      <MotionReveal>
        <section aria-labelledby="money-heading" className="rounded-[14px] border border-border bg-surface p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="money-heading" className="font-heading text-lg font-semibold">Where the money goes</h2>
            <span className="text-sm text-muted-foreground">{monthRange.label}</span>
          </div>

          {hasDirect ? (
            <>
              <p className="mt-1 text-sm text-muted-foreground">Food cost %, by week.</p>
              <FoodCostChart points={foodCost} targetBps={pnl.foodCostTargetBps} className="mt-4" />
              {pnl.foodCostTargetBps === null && <p className="mt-2 text-sm text-muted-foreground">No food cost target set yet, so no target line is shown.</p>}
            </>
          ) : (
            !pnl.hasExpenses && (
              <EmptyState
                className="mt-4"
                title="No costs recorded yet."
                detail="Revenue is already tracked from your orders. Record what you spend on food and packaging to see food cost % here."
                action={
                  <Link href="/app/iq/expenses/new" className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
                    Record an expense
                  </Link>
                }
              />
            )
          )}

          {pnl.hasExpenses && <CostBreakdownDonut directTotal={directTotal as never} fixedTotal={fixedTotal as never} className={hasDirect ? "mt-6 border-t border-border pt-5" : "mt-4"} />}

          {pnl.hasExpenses && !hasDirect && (
            <p className="mt-3 text-sm text-muted-foreground">
              No food or packaging costs yet — food cost % appears once you{" "}
              <Link href="/app/iq/expenses/new" className="font-semibold text-foreground underline underline-offset-2">
                record one
              </Link>
              .
            </p>
          )}

          <p className="mt-4 text-sm">
            <Link href="/app/iq/pnl" className="font-semibold underline underline-offset-2">
              See the full profit and loss
            </Link>
          </p>
        </section>
      </MotionReveal>

      {/* What's selling, and what isn't — the selected range. Replaced by Slice B. */}
      <MotionReveal>
        <section aria-labelledby="selling-heading" className="grid gap-3.5 lg:grid-cols-2">
          <div className="rounded-[14px] border border-border bg-surface p-5">
            <h2 id="selling-heading" className="font-heading text-lg font-semibold">Top sellers</h2>
            <p className="mt-1 text-sm text-muted-foreground">By revenue, {rangeLabel.toLowerCase()}.</p>
            {dashboard.topProducts.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">Nothing sold in this period.</p>
            ) : (
              <div className="mt-4">
                <TopSellersTable products={dashboard.topProducts} />
              </div>
            )}
          </div>
          <div className="rounded-[14px] border border-border bg-surface p-5">
            <h2 className="font-heading text-lg font-semibold">Not selling</h2>
            <p className="mt-1 text-sm text-muted-foreground">On the menu, no sales {rangeLabel.toLowerCase()}.</p>
            {gaps.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">Everything on the menu sold at least once.</p>
            ) : (
              <div className="mt-4">
                <NotSellingTable products={gaps} />
              </div>
            )}
          </div>
        </section>
      </MotionReveal>

      <p className="text-[13px] text-muted-foreground">
        Ranges: {OVERVIEW_RANGES.map((option) => option.label).join(" · ")} · comparison {compare ? compare.label.toLowerCase() : "unavailable"} · opening date{" "}
        {settings.opening.date ? `${settings.opening.date}${settings.opening.source === "first-order" ? " (from the first order — set it under Restaurant settings)" : ""}` : "not set"}
      </p>
    </div>
  );
}
