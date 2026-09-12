import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MiniStat } from "@/components/staff/mini-stat";
import { PageHeader } from "@/components/staff/page-header";
import { PaymentsTable } from "@/components/staff/payments-table";
import { PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { type RangeKey, resolveRange } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { getPaymentsLedger } from "@/lib/repositories/finance";

export const metadata: Metadata = { title: "Payments", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "mtd", label: "This month" },
];

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  NETBANKING: "Net banking",
  WALLET: "Wallet",
  OTHER: "Other",
};

/**
 * The payments ledger. FINANCE > Payments. Gated on `finance.view`
 * (OWNER and MANAGER) — the till-level view of who took what, by what
 * method, which is a different question from the dashboard's revenue
 * figure and deliberately labelled "captured", never "revenue".
 */
export default async function FinancePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const staff = await requireStaff();
  const canView = await staffCan("finance.view");

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view payments" />
      </div>
    );
  }

  const { range: requested } = await searchParams;
  const key = (RANGES.find((option) => option.key === requested)?.key ?? "today") as RangeKey;
  const range = resolveRange(key);
  const ledger = await getPaymentsLedger(staff.orgId, range);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title="Payments"
        description={`Every payment taken, ${range.label.toLowerCase()}. Captured means the money arrived; it is not the revenue figure on Overview.`}
        actions={
          <nav className="flex flex-wrap gap-1" aria-label="Period">
            {RANGES.map((option) => (
              <Link
                key={option.key}
                href={`/app/finance?range=${option.key}`}
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
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MiniStat label="Captured" value={formatINR(ledger.capturedTotal, "whole")} hint={`${ledger.capturedCount} ${ledger.capturedCount === 1 ? "payment" : "payments"}`} />
        <MiniStat label="Provider fees" value={ledger.feeTotal === 0n ? "—" : formatINR(ledger.feeTotal)} hint="Kept separate so a payout reconciles" />
        <MiniStat label="Refunded" value={ledger.refunds.length === 0 ? "—" : formatINR(ledger.refundedTotal, "whole")} hint={`${ledger.refunds.length} ${ledger.refunds.length === 1 ? "refund" : "refunds"}`} />
        <MiniStat
          label="Top method"
          value={ledger.byMethod[0] ? (METHOD_LABELS[ledger.byMethod[0].method] ?? ledger.byMethod[0].method) : "—"}
          hint={ledger.byMethod[0] ? `${formatINR(ledger.byMethod[0].total, "whole")} across ${ledger.byMethod[0].count}` : "No captured payments"}
        />
      </div>

      {ledger.byMethod.length > 1 && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <h2 className="font-heading text-lg font-semibold">By method</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Payments</TableHead>
                  <TableHead className="text-right">Captured</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.byMethod.map((row) => (
                  <TableRow key={row.method}>
                    <TableCell className="font-medium">{METHOD_LABELS[row.method] ?? row.method}</TableCell>
                    <TableCell className="tabular text-right text-muted-foreground">{row.count}</TableCell>
                    <TableCell className="tabular text-right font-semibold">{formatINR(row.total, "whole")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <section aria-labelledby="payments-heading" className="flex flex-col gap-3">
        <h2 id="payments-heading" className="font-heading text-lg font-semibold">
          Payments
        </h2>
        <PaymentsTable payments={ledger.payments.map((row) => ({ ...row, at: row.at.toISOString() }))} />
      </section>

      <section aria-labelledby="refunds-heading" className="flex flex-col gap-3">
        <h2 id="refunds-heading" className="font-heading text-lg font-semibold">
          Refunds
        </h2>
        {ledger.refunds.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">
            No refunds in this period.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="hidden md:table-cell">By</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.refunds.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="tabular font-semibold">#{row.orderNumber}</TableCell>
                    <TableCell className="whitespace-normal">{row.reason}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{row.by ?? "System"}</TableCell>
                    <TableCell className="tabular text-right font-semibold">{formatINR(row.amount)}</TableCell>
                    <TableCell className="tabular hidden text-right text-muted-foreground sm:table-cell">
                      {row.at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
