import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlarmClock, AlertTriangle, Clock, CreditCard } from "lucide-react";
import { CostBreakdownDonut } from "@/components/iq/cost-breakdown-donut";
import { FoodCostChart } from "@/components/iq/food-cost-chart";
import { NotSellingTable } from "@/components/iq/not-selling-table";
import { StatTile } from "@/components/iq/stat-tile";
import { TopSellersTable } from "@/components/iq/top-sellers-table";
import { EmptyState, PermissionDenied } from "@/components/states";
import { MotionReveal, MotionStagger, MotionStaggerItem } from "@/components/motion";
import { getStaff, staffCan } from "@/lib/auth";
import { type RangeKey, resolveRange } from "@/lib/dates";
import { type Paise, ZERO, formatBps, formatINR, paise } from "@/lib/money";
import { Card, CardContent } from "@/components/ui/card";
import { toKitchenTickets } from "@/lib/kitchen/tickets";
import { changeBps, getDashboard, getTodayComparison, notSelling, ordersAwaitingDecision, ordersRunningLate } from "@/lib/repositories/analytics";
import { foodCostWeeklySeries, getProfitAndLoss } from "@/lib/repositories/expenses";
import { listActiveOrders } from "@/lib/repositories/orders";

export const metadata: Metadata = { title: "FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Average order value for a revenue/order pair. Zero orders has no average, not a divide-by-zero. */
function averageOrder(revenue: Paise, orders: number): Paise {
  return orders === 0 ? ZERO : (paise(revenue) / BigInt(orders) as Paise);
}

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

export default async function IqPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
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

  const canManageSettings = await staffCan("settings.manage");
  const canViewMenu = await staffCan("menu.view");

  const { range: requested } = await searchParams;
  const key = (RANGES.find((option) => option.key === requested)?.key ?? "today") as RangeKey;
  const range = resolveRange(key);
  const monthRange = resolveRange("mtd");

  const [dashboard, today, pnl, foodCost, gaps, awaiting, late, active] = await Promise.all([
    getDashboard(staff.orgId, range),
    getTodayComparison(staff.orgId),
    getProfitAndLoss(staff.orgId, monthRange),
    foodCostWeeklySeries(staff.orgId),
    notSelling(staff.orgId, range),
    ordersAwaitingDecision(staff.orgId),
    ordersRunningLate(staff.orgId),
    listActiveOrders(staff.orgId),
  ]);
  const inKitchen = toKitchenTickets(active).length;

  const directTotal = pnl.direct.reduce((s, r) => s + r.amount, 0n);
  const fixedTotal = pnl.fixed.reduce((s, r) => s + r.amount, 0n);

  const overTarget =
    pnl.foodCostTargetBps !== null && pnl.result.foodCostBps !== null && pnl.result.foodCostBps > pnl.foodCostTargetBps;

  const needsAttention = awaiting.length > 0 || late.length > 0 || dashboard.openOrders > 0 || overTarget;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-[var(--gutter)] py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">
            FRYBIRD <span className="text-primary">IQ</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{range.label}, Sector 9</p>
          <nav aria-label="FRYBIRD IQ sections" className="mt-3 flex flex-wrap gap-4 text-sm font-semibold">
            <span aria-current="page" className="text-foreground">Sales</span>
            <Link href="/app/iq/live" className="text-muted-foreground transition-colors hover:text-foreground">
              Live
            </Link>
            <Link href="/app/iq/activity" className="text-muted-foreground transition-colors hover:text-foreground">
              Activity
            </Link>
            <Link href="/app/iq/channels" className="text-muted-foreground transition-colors hover:text-foreground">
              Channels
            </Link>
            <Link href="/app/iq/products" className="text-muted-foreground transition-colors hover:text-foreground">
              Products
            </Link>
            <Link href="/app/iq/pnl" className="text-muted-foreground transition-colors hover:text-foreground">
              Profit and loss
            </Link>
            <Link href="/app/iq/expenses" className="text-muted-foreground transition-colors hover:text-foreground">
              Expenses
            </Link>
            {canManageSettings && (
              <Link href="/app/iq/rewards" className="text-muted-foreground transition-colors hover:text-foreground">
                Rewards
              </Link>
            )}
            {canViewMenu && (
              <Link href="/app/iq/menu" className="text-muted-foreground transition-colors hover:text-foreground">
                Menu
              </Link>
            )}
          </nav>
        </div>

        <nav className="flex flex-wrap gap-1" aria-label="Period">
          {RANGES.map((option) => (
            <Link
              key={option.key}
              href={`/app/iq?range=${option.key}`}
              aria-current={option.key === key ? "page" : undefined}
              className={
                option.key === key
                  ? "flex min-h-[44px] items-center rounded-md bg-secondary px-4 text-sm font-semibold text-secondary-foreground"
                  : "flex min-h-[44px] items-center rounded-md px-4 text-sm font-semibold text-muted-foreground transition-colors hover:bg-surface"
              }
            >
              {option.label}
            </Link>
          ))}
        </nav>
      </div>

      {/* 1. How did today go — always today, always both comparisons. */}
      <section aria-labelledby="today-heading" className="flex flex-col gap-4">
        <h2 id="today-heading" className="font-heading text-lg font-semibold">Today</h2>
        {/* grid-cols-1 straight to lg:grid-cols-3 — a sm:2-column step
            orphans an empty grey cell with exactly three tiles. Each tile is
            its own Card now, so the gap is a real gap, not the hairline
            (gap-px over a coloured background) trick a flush grid needed. */}
        <MotionStagger each={0.04} count={3}>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <MotionStaggerItem>
              <StatTile
                label="Revenue"
                value={formatINR(today.today.revenue, "whole")}
                changeBps={today.vsYesterdayBps}
                comparedTo="yesterday"
                secondaryChangeBps={today.vsLastWeekBps}
                secondaryComparedTo="the same day last week"
              />
            </MotionStaggerItem>
            <MotionStaggerItem>
              <StatTile
                label="Orders"
                value={String(today.today.orders)}
                changeBps={today.ordersVsYesterdayBps}
                comparedTo="yesterday"
                secondaryChangeBps={today.ordersVsLastWeekBps}
                secondaryComparedTo="the same day last week"
              />
            </MotionStaggerItem>
            <MotionStaggerItem>
              <StatTile
                label="Average order"
                value={today.today.orders === 0 ? "—" : formatINR(averageOrder(today.today.revenue, today.today.orders), "whole")}
                changeBps={changeBps(
                  averageOrder(today.today.revenue, today.today.orders),
                  averageOrder(today.yesterday.revenue, today.yesterday.orders),
                )}
                comparedTo="yesterday"
                secondaryChangeBps={changeBps(
                  averageOrder(today.today.revenue, today.today.orders),
                  averageOrder(today.lastWeek.revenue, today.lastWeek.orders),
                )}
                secondaryComparedTo="the same day last week"
                detail={today.today.orders === 0 ? "No orders yet today" : undefined}
              />
            </MotionStaggerItem>
          </div>
        </MotionStagger>
      </section>

      {/* 1b. Right now — the same three facts Live operations leads with,
          each a door into the surface that acts on it. */}
      <section aria-labelledby="now-heading" className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="now-heading" className="font-heading text-lg font-semibold">Right now</h2>
          <Link href="/app/iq/live" className="text-sm font-semibold underline underline-offset-2">
            Live operations
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            { label: "Awaiting decision", value: awaiting.length, hint: "New orders the counter hasn't accepted", href: "/app/orders", urgent: awaiting.length > 0 },
            { label: "In the kitchen", value: inKitchen, hint: "Accepted, cooking or ready", href: "/app/kds", urgent: false },
            { label: "Late", value: late.length, hint: "Past the promised time", href: "/app/iq/live", urgent: late.length > 0 },
          ].map((item) => (
            <Link key={item.label} href={item.href} className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Card className="h-full transition-colors group-hover:bg-surface-muted">
                <CardContent className="flex flex-col gap-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{item.label}</p>
                  <p className={`tabular font-heading text-2xl font-bold ${item.urgent ? "text-destructive" : ""}`}>{item.value}</p>
                  <p className="text-xs text-muted-foreground">{item.hint}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* 2. Where the money goes — this month so far. */}
      <MotionReveal>
        <section aria-labelledby="money-heading" className="rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="money-heading" className="font-heading text-lg font-semibold">Where the money goes</h2>
            <span className="text-sm text-muted-foreground">{monthRange.label}</span>
          </div>

          {/* A week with revenue but zero direct cost reads as "0% food cost"
              even when nothing has ever been recorded — checking directCost
              rather than foodCostBps null-ness is what tells those apart. */}
          {!foodCost.some((point) => point.directCost > 0n) ? (
            <EmptyState
              className="mt-4"
              title="No costs recorded yet."
              detail="Revenue is already tracked from your orders. Record what you spend on food and packaging to see food cost % here."
              action={
                <Link
                  href="/app/iq/expenses/new"
                  className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
                >
                  Record an expense
                </Link>
              }
            />
          ) : (
            <>
              <p className="mt-1 text-sm text-muted-foreground">Food cost %, by week.</p>
              <FoodCostChart points={foodCost} targetBps={pnl.foodCostTargetBps} className="mt-4" />
              {pnl.foodCostTargetBps === null && (
                <p className="mt-2 text-sm text-muted-foreground">
                  No food cost target set yet, so no target line is shown.
                </p>
              )}
            </>
          )}

          {pnl.hasExpenses && (
            <CostBreakdownDonut
              directTotal={directTotal as never}
              fixedTotal={fixedTotal as never}
              className="mt-6 border-t border-border pt-5"
            />
          )}

          <p className="mt-4 text-sm">
            <Link href="/app/iq/pnl" className="font-semibold underline underline-offset-2">
              See the full profit and loss
            </Link>
          </p>
        </section>
      </MotionReveal>

      {/* 3. What's selling, and what isn't — the switcher's period. */}
      <MotionReveal>
        <section aria-labelledby="selling-heading" className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-surface p-5">
            <h2 id="selling-heading" className="font-heading text-lg font-semibold">Top sellers</h2>
            <p className="mt-1 text-sm text-muted-foreground">By revenue, {range.label.toLowerCase()}.</p>
            {dashboard.topProducts.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">Nothing sold in this period.</p>
            ) : (
              <div className="mt-4">
                <TopSellersTable products={dashboard.topProducts} />
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-surface p-5">
            <h2 className="font-heading text-lg font-semibold">Not selling</h2>
            <p className="mt-1 text-sm text-muted-foreground">On the menu, no sales {range.label.toLowerCase()}.</p>
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

      {/* 4. What needs attention. */}
      <MotionReveal>
        <section aria-labelledby="attention-heading" className="rounded-lg border border-border bg-surface p-5">
          <h2 id="attention-heading" className="font-heading text-lg font-semibold">Needs attention</h2>

          {!needsAttention ? (
            <p className="mt-4 text-sm text-muted-foreground">Nothing needs your attention right now.</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3 text-sm">
              {late.length > 0 && (
                <li className="flex items-center gap-3">
                  <AlarmClock className="size-4 shrink-0 text-destructive" aria-hidden="true" />
                  <span className="flex-1">
                    <strong>{late.length}</strong> {late.length === 1 ? "order is past its" : "orders are past their"}{" "}
                    promised time.
                  </span>
                  <Link href="/app/orders" className="shrink-0 font-semibold underline underline-offset-2">
                    Review
                  </Link>
                </li>
              )}
              {awaiting.length > 0 && (
                <li className="flex items-center gap-3">
                  <Clock className="size-4 shrink-0 text-destructive" aria-hidden="true" />
                  <span className="flex-1">
                    <strong>{awaiting.length}</strong> {awaiting.length === 1 ? "order is" : "orders are"} waiting on a
                    decision.
                  </span>
                  <Link href="/app/orders" className="shrink-0 font-semibold underline underline-offset-2">
                    Review
                  </Link>
                </li>
              )}
              {dashboard.openOrders > 0 && (
                <li className="flex items-center gap-3">
                  <CreditCard className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="flex-1">
                    <strong className="tabular">{formatINR(dashboard.openValue, "whole")}</strong> across{" "}
                    {dashboard.openOrders} {dashboard.openOrders === 1 ? "order is" : "orders are"} waiting on payment.
                  </span>
                </li>
              )}
              {overTarget && pnl.result.foodCostBps !== null && pnl.foodCostTargetBps !== null && (
                <li className="flex items-center gap-3">
                  <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden="true" />
                  <span className="flex-1">
                    Food cost is <strong className="tabular">{formatBps(pnl.result.foodCostBps, 1)}</strong> this month,
                    against a target of {formatBps(pnl.foodCostTargetBps, 1)}.
                  </span>
                </li>
              )}
            </ul>
          )}
        </section>
      </MotionReveal>
    </div>
  );
}
