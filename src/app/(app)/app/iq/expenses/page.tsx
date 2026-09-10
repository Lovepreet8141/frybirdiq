import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { EmptyState } from "@/components/states";
import { getStaff, staffCan } from "@/lib/auth";
import { type RangeKey, resolveRange } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { listExpenses } from "@/lib/repositories/expenses";

export const metadata: Metadata = {
  title: "Expenses — FRYBIRD IQ",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "mtd", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "30d", label: "Last 30 days" },
];

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; saved?: string }>;
}) {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("analytics.view"))) redirect("/app/orders");

  const { range: requested, saved } = await searchParams;
  const key = (RANGES.find((option) => option.key === requested)?.key ?? "mtd") as RangeKey;
  const range = resolveRange(key);
  const rows = await listExpenses(staff.orgId, range);
  const total = rows.reduce((sum, row) => sum + row.amount, 0n);

  return (
    <div className="mx-auto w-full max-w-4xl px-[var(--gutter)] py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">Expenses</h1>
          <p className="mt-1 text-sm text-muted-foreground">{range.label}</p>
        </div>
        <div className="flex items-center gap-3">
          <nav aria-label="Period" className="flex flex-wrap gap-1">
            {RANGES.map((option) => (
              <Link
                key={option.key}
                href={`/app/iq/expenses?range=${option.key}`}
                aria-current={option.key === key ? "page" : undefined}
                className={
                  option.key === key
                    ? "bg-primary flex min-h-[44px] items-center rounded-md px-4 text-sm font-semibold text-primary-foreground"
                    : "flex min-h-[44px] items-center rounded-md px-4 text-sm font-semibold text-muted-foreground transition-colors hover:bg-surface"
                }
              >
                {option.label}
              </Link>
            ))}
          </nav>
          <Link
            href="/app/iq/expenses/new"
            className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            Record expense
          </Link>
        </div>
      </div>

      {saved === "1" && (
        <p role="status" className="mt-5 border-l-2 border-[var(--success)] bg-surface px-4 py-3 text-sm">
          Expense recorded.
        </p>
      )}

      {rows.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="Nothing recorded for this period."
            detail="Rent, gas, chicken, packaging, wages. Record them and FRYBIRD IQ can show net profit rather than just sales."
            action={
              <Link
                href="/app/iq/expenses/new"
                className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
              >
                Record the first one
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <p className="tabular mt-6 text-sm text-muted-foreground">
            <strong className="text-foreground">{formatINR(total as never, "whole")}</strong> across{" "}
            {rows.length} {rows.length === 1 ? "entry" : "entries"}
          </p>

          <table className="mt-4 w-full text-sm">
            <caption className="sr-only">Expenses for {range.label}</caption>
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted-foreground">
                <th scope="col" className="pb-2 text-left font-semibold">Date</th>
                <th scope="col" className="pb-2 text-left font-semibold">What for</th>
                <th scope="col" className="pb-2 text-left font-semibold">Category</th>
                <th scope="col" className="pb-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60">
                  <td className="tabular py-2.5 whitespace-nowrap text-muted-foreground">{row.paidOn}</td>
                  <td className="py-2.5">
                    {row.description}
                    {row.accountName && (
                      <span className="text-muted-foreground"> · {row.accountName}</span>
                    )}
                  </td>
                  <td className="py-2.5">
                    {row.categoryName}
                    {/* The behaviour is written, not colour-coded: it decides
                        which side of the P&L this lands on. */}
                    <span className="block text-xs text-muted-foreground">
                      {row.behaviour === "DIRECT" ? "moves with sales" : "fixed"}
                    </span>
                  </td>
                  <td className="tabular py-2.5 text-right font-semibold">{formatINR(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <p className="mt-8 text-sm text-muted-foreground">
        <Link href="/app/iq/pnl" className="underline underline-offset-2">
          See the profit and loss
        </Link>{" "}
        these feed into.
      </p>
    </div>
  );
}
