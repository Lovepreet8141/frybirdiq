import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AnalyticsSectionNav } from "@/components/iq/analytics-section-nav";
import { CostBreakdownDonut } from "@/components/iq/cost-breakdown-donut";
import { FoodCostChart } from "@/components/iq/food-cost-chart";
import { PeriodSwitch } from "@/components/iq/period-switch";
import { DataTrust, KpiTile, Panel, PanelBody, PanelHeader } from "@/components/iq/ui";
import { PageHeader } from "@/components/staff/page-header";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { getStaff, staffCan } from "@/lib/auth";
import { type RangeKey, resolveRange } from "@/lib/dates";
import { type Paise, formatBps, formatINR, ratioBps } from "@/lib/money";
import { type CategoryTotal, foodCostWeeklySeries, getProfitAndLoss } from "@/lib/repositories/expenses";
import { getFoodCostComparison } from "@/lib/repositories/stock";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Profit and loss — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Calendar months only. A P&L over a rolling window double-counts or misses the monthly costs it is meant to account for. */
const RANGES: { key: RangeKey; label: string }[] = [
  { key: "mtd", label: "This month" },
  { key: "lastMonth", label: "Last month" },
];

function Section({ title, rows, revenue, total }: { title: string; rows: readonly CategoryTotal[]; revenue: bigint; total: string }) {
  if (rows.length === 0) return null;
  return (
    <>
      <tr className="border-t border-border">
        <th scope="rowgroup" colSpan={3} className="pt-5 pb-1 text-left text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </th>
      </tr>
      {rows.map((row) => (
        <tr key={row.categoryId}>
          <td className="py-1.5 pl-4">{row.name}</td>
          <td className="tabular py-1.5 text-right">{formatINR(row.amount, "whole")}</td>
          <td className="tabular py-1.5 text-right text-muted-foreground">{revenue > 0n ? formatBps(Number((row.amount * 10_000n) / revenue), 1) : "—"}</td>
        </tr>
      ))}
      <tr className="font-semibold">
        <td className="py-1.5">Total {title.toLowerCase()}</td>
        <td className="tabular py-1.5 text-right">{total}</td>
        <td />
      </tr>
    </>
  );
}

/**
 * ANALYTICS › Food cost & P&L. Revenue is the dashboard's (paid orders);
 * costs are the recorded expenses; the statement is `profit()` in
 * `src/lib/iq/profit`. Nothing here is typed in twice or computed a second
 * way.
 */
export default async function PnlPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("analytics.view"))) redirect("/app/orders");

  const { range: requested } = await searchParams;
  const key = (RANGES.find((option) => option.key === requested)?.key ?? "mtd") as RangeKey;
  const range = resolveRange(key);
  const [pnl, foodCost, foodCostComparison, canRecord, canSeeCustomers] = await Promise.all([
    getProfitAndLoss(staff.orgId, range),
    foodCostWeeklySeries(staff.orgId),
    getFoodCostComparison(staff.orgId, range),
    staffCan("finance.manage"),
    staffCan("customers.view"),
  ]);
  const { result } = pnl;

  const directTotal = pnl.direct.reduce((sum, row) => sum + row.amount, 0n) as Paise;
  const fixedTotal = pnl.fixed.reduce((sum, row) => sum + row.amount, 0n) as Paise;
  const nonOperatingTotal = pnl.nonOperating.reduce((sum, row) => sum + row.amount, 0n) as Paise;
  const overTarget = pnl.foodCostTargetBps !== null && result.foodCostBps !== null && result.foodCostBps > pnl.foodCostTargetBps;
  const weeksWithData = foodCost.filter((point) => point.foodCostBps !== null).length;

  // Roadmap 3.5. `varianceCost` is structurally >= 0 — it is theoretical (SALE)
  // plus WASTE plus shrinkage, never a subtraction that could go negative — so
  // there is no "under theoretical" case to frame, only "how much over."
  const hasConsumptionData = foodCostComparison.saleMovementCount > 0;
  const varianceOfTheoreticalBps = hasConsumptionData && foodCostComparison.theoreticalCost > 0n ? ratioBps(foodCostComparison.varianceCost, foodCostComparison.theoreticalCost) : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title="Food cost & P&L"
        description={`${range.label} · paid orders as revenue, recorded expenses as cost · INR`}
        actions={
          <>
            <PeriodSwitch basePath="/app/iq/pnl" options={RANGES} current={key} />
            {canRecord && (
              <Button variant="inverse" asChild>
                <Link href="/app/iq/expenses/new">Record an expense</Link>
              </Button>
            )}
          </>
        }
      />
      <AnalyticsSectionNav current="food-cost" canSeeCustomers={canSeeCustomers} />

      <DataTrust
        items={[
          { tone: "gain", text: `Revenue ${formatINR(pnl.revenue, "whole")} across ${pnl.orderCount} paid ${pnl.orderCount === 1 ? "order" : "orders"}` },
          pnl.hasExpenses ? { tone: "gain", text: "Costs from recorded expenses, by category" } : { tone: "flag", text: "No expenses recorded for this period — costs and profit cannot be shown" },
          hasConsumptionData
            ? { tone: "gain", text: `Theoretical and actual food cost from ${foodCostComparison.saleMovementCount} recipe-driven sale ${foodCostComparison.saleMovementCount === 1 ? "movement" : "movements"}` }
            : { tone: "flag", text: "No recipe-driven consumption recorded yet — theoretical vs actual food cost needs at least one accepted order" },
        ]}
      />

      <Panel>
        <PanelHeader title="Theoretical vs actual food cost" description="Recipes × sales, against everything that actually left the shelf." meta={range.label} />
        <PanelBody className="pt-0">
          {!hasConsumptionData ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
              No recipe-driven consumption recorded for {range.label.toLowerCase()} — this fills in once an order for a product with a recipe is accepted. Add recipes from{" "}
              <Link href="/app/iq/products" className="underline underline-offset-2">
                product pages
              </Link>
              .
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-medium text-muted-foreground">Theoretical</span>
                <span className="tabular font-money text-[26px] leading-none tracking-[-0.01em]">{formatINR(foodCostComparison.theoreticalCost, "whole")}</span>
                <span className="text-[12.5px] leading-[1.4] text-muted-foreground">Recipe cost of {foodCostComparison.saleMovementCount} sale {foodCostComparison.saleMovementCount === 1 ? "movement" : "movements"} — zero waste assumed.</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-medium text-muted-foreground">Actual</span>
                <span className="tabular font-money text-[26px] leading-none tracking-[-0.01em]">{formatINR(foodCostComparison.actualCost, "whole")}</span>
                <span className="text-[12.5px] leading-[1.4] text-muted-foreground">Sales, plus waste and shrinkage counted this period.</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-medium text-muted-foreground">Variance</span>
                <span className={cn("tabular font-money text-[26px] leading-none tracking-[-0.01em]", foodCostComparison.varianceCost > 0n && "text-loss")}>
                  {foodCostComparison.varianceCost === 0n ? "₹0" : `+${formatINR(foodCostComparison.varianceCost, "whole")}`}
                </span>
                <span className="text-[12.5px] leading-[1.4] text-muted-foreground">
                  {foodCostComparison.varianceCost === 0n ? "No waste or shrinkage recorded this period." : `What waste and shrinkage cost${varianceOfTheoreticalBps !== null ? ` — ${formatBps(varianceOfTheoreticalBps, 1)} above theoretical` : ""}.`}
                </span>
              </div>
            </div>
          )}
        </PanelBody>
      </Panel>

      {!pnl.hasExpenses ? (
        <EmptyState
          title="No costs recorded for this period"
          detail="Revenue is already tracked from your orders. Record what you spend — rent, gas, chicken, packaging — and this becomes a real profit figure rather than a sales total."
          action={
            canRecord ? (
              <Button variant="inverse" asChild>
                <Link href="/app/iq/expenses/new">Record an expense</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiTile label="Revenue" value={formatINR(pnl.revenue, "whole")} note={`${pnl.orderCount} paid ${pnl.orderCount === 1 ? "order" : "orders"}`} />
            <KpiTile label="Gross profit" value={formatINR(result.grossProfit, "whole")} note={result.grossMarginBps === null ? "No sales yet" : `${formatBps(result.grossMarginBps, 1)} margin after direct costs`} />
            <KpiTile label="Net profit" value={formatINR(result.netProfit, "whole")} note={result.netMarginBps === null ? "No sales yet" : `${formatBps(result.netMarginBps, 1)} margin after operating expenses`} emphasis />
            <KpiTile
              label="Food cost"
              value={result.foodCostBps === null ? "—" : formatBps(result.foodCostBps, 1)}
              missing={result.foodCostBps === null}
              meta={pnl.foodCostTargetBps !== null ? `target ${formatBps(pnl.foodCostTargetBps, 1)}` : undefined}
              note={
                result.foodCostBps === null
                  ? "Needs revenue and a direct cost in the period"
                  : overTarget && pnl.foodCostTargetBps !== null
                    ? `Over target by ${formatBps(result.foodCostBps - pnl.foodCostTargetBps, 1)} — about ${formatINR((pnl.revenue / 10_000n) as Paise, "whole")} of profit per point at this revenue`
                    : pnl.foodCostTargetBps === null
                      ? "No target set for this month"
                      : "Within target"
              }
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Panel className="lg:col-span-2">
              <PanelHeader title="Statement" description="Revenue, direct costs, gross profit, operating expenses, net profit." />
              <PanelBody className="pt-0">
                <table className="tabular-nums w-full text-[13px]">
                  <caption className="sr-only">Profit and loss for {range.label}</caption>
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted-foreground">
                      <th scope="col" className="pb-2 text-left font-semibold">
                        Line
                      </th>
                      <th scope="col" className="pb-2 text-right font-semibold">
                        Amount
                      </th>
                      <th scope="col" className="pb-2 text-right font-semibold">
                        % of revenue
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="font-semibold">
                      <td className="py-2">Revenue</td>
                      <td className="tabular py-2 text-right">{formatINR(pnl.revenue, "whole")}</td>
                      <td className="tabular py-2 text-right text-muted-foreground">100.0%</td>
                    </tr>
                    <Section title="Direct costs" rows={pnl.direct} revenue={pnl.revenue} total={formatINR(directTotal, "whole")} />
                    <tr className="border-t border-border font-semibold">
                      <td className="py-2">Gross profit</td>
                      <td className="tabular py-2 text-right">{formatINR(result.grossProfit, "whole")}</td>
                      <td className="tabular py-2 text-right text-muted-foreground">{result.grossMarginBps === null ? "—" : formatBps(result.grossMarginBps, 1)}</td>
                    </tr>
                    <Section title="Operating expenses" rows={pnl.fixed} revenue={pnl.revenue} total={formatINR(fixedTotal, "whole")} />
                    <tr className="border-t-2 border-foreground text-base font-bold">
                      <td className="py-3">Net profit</td>
                      <td className="tabular py-3 text-right">{formatINR(result.netProfit, "whole")}</td>
                      <td className="tabular py-3 text-right">{result.netMarginBps === null ? "—" : formatBps(result.netMarginBps, 1)}</td>
                    </tr>
                    {pnl.nonOperating.length > 0 && <Section title="Not operating costs" rows={pnl.nonOperating} revenue={pnl.revenue} total={formatINR(nonOperatingTotal, "whole")} />}
                  </tbody>
                </table>
                {pnl.nonOperating.length > 0 && <p className="mt-3 text-[12.5px] text-muted-foreground">Drawings and loan principal are real money leaving the business, but they are not a cost of running the month — counting them above would make a profitable month read as a loss.</p>}
              </PanelBody>
            </Panel>

            <div className="flex flex-col gap-6">
              <Panel>
                <PanelHeader title="Where the money went" description="Direct against operating." />
                <PanelBody className="pt-0">
                  <CostBreakdownDonut directTotal={directTotal} fixedTotal={fixedTotal} />
                </PanelBody>
              </Panel>
              <Panel>
                <PanelHeader title="Food cost by week" description="Direct costs against revenue, the last eight weeks." meta={weeksWithData > 0 ? `${weeksWithData} of 8 weeks` : undefined} />
                <PanelBody className="pt-0">
                  {weeksWithData === 0 ? <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">No week in the last eight has both revenue and a recorded direct cost.</p> : <FoodCostChart points={foodCost} targetBps={pnl.foodCostTargetBps} />}
                </PanelBody>
              </Panel>
            </div>
          </div>
        </>
      )}

      <p className="text-[13px] text-muted-foreground">
        Revenue comes from your paid orders — nothing here is typed in twice.{" "}
        <Link href="/app/iq/expenses" className="underline underline-offset-2">
          Record what you spend
        </Link>{" "}
        to keep this accurate.
      </p>
    </div>
  );
}
