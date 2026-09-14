import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { StatTile } from "@/components/iq/stat-tile";
import { EmptyState } from "@/components/states";
import { getStaff, staffCan } from "@/lib/auth";
import { type RangeKey, resolveRange } from "@/lib/dates";
import { formatBps, formatINR } from "@/lib/money";
import { type CategoryTotal, getProfitAndLoss } from "@/lib/repositories/expenses";

export const metadata: Metadata = {
  title: "Profit and loss — FRYBIRD IQ",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * Calendar months only. A profit-and-loss over a rolling window double-counts
 * or misses the monthly costs it is meant to account for.
 */
const RANGES: { key: RangeKey; label: string }[] = [
  { key: "mtd", label: "This month" },
  { key: "lastMonth", label: "Last month" },
];

function Section({
  title,
  rows,
  revenue,
  total,
}: {
  title: string;
  rows: readonly CategoryTotal[];
  revenue: bigint;
  total: string;
}) {
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
          <td className="tabular py-1.5 text-right text-muted-foreground">
            {revenue > 0n ? formatBps(Number((row.amount * 10_000n) / revenue), 1) : "—"}
          </td>
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

export default async function PnlPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("analytics.view"))) redirect("/app/orders");
  const canRecord = await staffCan("finance.view");

  const { range: requested } = await searchParams;
  const key = (RANGES.find((option) => option.key === requested)?.key ?? "mtd") as RangeKey;
  const range = resolveRange(key);
  const pnl = await getProfitAndLoss(staff.orgId, range);
  const { result } = pnl;

  const directTotal = pnl.direct.reduce((sum, row) => sum + row.amount, 0n);
  const fixedTotal = pnl.fixed.reduce((sum, row) => sum + row.amount, 0n);
  const nonOperatingTotal = pnl.nonOperating.reduce((sum, row) => sum + row.amount, 0n);

  const overTarget =
    pnl.foodCostTargetBps !== null &&
    result.foodCostBps !== null &&
    result.foodCostBps > pnl.foodCostTargetBps;

  return (
    <div className="mx-auto w-full max-w-4xl px-[var(--gutter)] py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-[26px] font-semibold leading-[1.15] tracking-[-0.015em]">Profit and loss</h1>
          <p className="mt-1 text-[13.5px] text-muted-foreground">{range.label} · captured payments only · INR</p>
        </div>
        <nav className="inline-flex max-w-full flex-wrap gap-0.5 rounded-[10px] border border-border bg-panel p-1" aria-label="Period">
          {RANGES.map((option) => (
            <Link
              key={option.key}
              href={`/app/iq/pnl?range=${option.key}`}
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
      </div>

      {!pnl.hasExpenses ? (
        <div className="mt-8">
          <EmptyState
            title="No costs recorded for this period."
            detail="Revenue is already tracked from your orders. Record what you spend — rent, gas, chicken, packaging — and this becomes a real profit figure rather than a sales total."
            action={
              canRecord ? (
                <Link
                  href="/app/iq/expenses/new"
                  className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
                >
                  Record an expense
                </Link>
              ) : undefined
            }
          />
          <p className="tabular mt-6 text-sm text-muted-foreground">
            Revenue so far: <strong className="text-foreground">{formatINR(pnl.revenue, "whole")}</strong>{" "}
            across {pnl.orderCount} paid {pnl.orderCount === 1 ? "order" : "orders"}.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <StatTile label="Revenue" value={formatINR(pnl.revenue, "whole")} detail={`${pnl.orderCount} paid orders`} />
            <StatTile
              label="Gross profit"
              value={formatINR(result.grossProfit, "whole")}
              detail={result.grossMarginBps === null ? "No sales yet" : `${formatBps(result.grossMarginBps, 1)} margin`}
            />
            <StatTile
              label="Net profit"
              value={formatINR(result.netProfit, "whole")}
              detail={result.netMarginBps === null ? "No sales yet" : `${formatBps(result.netMarginBps, 1)} margin`}
            />
          </div>

          <div className="mt-6 rounded-xl border border-border bg-panel px-5 py-3"><table className="tabular-nums w-full text-[13px]">
            <caption className="sr-only">Profit and loss for {range.label}</caption>
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted-foreground">
                <th scope="col" className="pb-2 text-left font-semibold">Line</th>
                <th scope="col" className="pb-2 text-right font-semibold">Amount</th>
                <th scope="col" className="pb-2 text-right font-semibold">% of revenue</th>
              </tr>
            </thead>
            <tbody>
              <tr className="font-semibold">
                <td className="py-2">Revenue</td>
                <td className="tabular py-2 text-right">{formatINR(pnl.revenue, "whole")}</td>
                <td className="tabular py-2 text-right text-muted-foreground">100.0%</td>
              </tr>

              <Section title="Direct costs" rows={pnl.direct} revenue={pnl.revenue} total={formatINR(directTotal as never, "whole")} />

              <tr className="border-t border-border font-semibold">
                <td className="py-2">Gross profit</td>
                <td className="tabular py-2 text-right">{formatINR(result.grossProfit, "whole")}</td>
                <td className="tabular py-2 text-right text-muted-foreground">
                  {result.grossMarginBps === null ? "—" : formatBps(result.grossMarginBps, 1)}
                </td>
              </tr>

              <Section title="Operating expenses" rows={pnl.fixed} revenue={pnl.revenue} total={formatINR(fixedTotal as never, "whole")} />

              <tr className="border-t-2 border-foreground text-base font-bold">
                <td className="py-3">Net profit</td>
                <td className="tabular py-3 text-right">{formatINR(result.netProfit, "whole")}</td>
                <td className="tabular py-3 text-right">
                  {result.netMarginBps === null ? "—" : formatBps(result.netMarginBps, 1)}
                </td>
              </tr>

              {pnl.nonOperating.length > 0 && (
                <Section
                  title="Not operating costs"
                  rows={pnl.nonOperating}
                  revenue={pnl.revenue}
                  total={formatINR(nonOperatingTotal as never, "whole")}
                />
              )}
            </tbody>
          </table></div>

          {pnl.nonOperating.length > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              Drawings and loan principal are real money leaving the business, but they are not a cost of
              running the month — counting them above would make a profitable month read as a loss.
            </p>
          )}

          {overTarget && result.foodCostBps !== null && pnl.foodCostTargetBps !== null && (
            <p className="mt-6 border-l-2 border-[var(--destructive)] bg-surface px-4 py-3 text-sm">
              <strong>Food cost is {formatBps(result.foodCostBps, 1)}</strong>, against your target of{" "}
              {formatBps(pnl.foodCostTargetBps, 1)}. Every point above target is{" "}
              {formatINR((pnl.revenue / 10_000n) as never, "whole")} of profit a month at this revenue.
            </p>
          )}
        </>
      )}

      <p className="mt-8 text-sm text-muted-foreground">
        Revenue comes from your paid orders — nothing here is typed in twice.{" "}
        <Link href="/app/iq/expenses" className="underline underline-offset-2">
          Record what you spend
        </Link>{" "}
        to keep this accurate.
      </p>
    </div>
  );
}
