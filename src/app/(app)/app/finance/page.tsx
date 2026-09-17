import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { CapturedChart } from "@/components/finance/captured-chart";
import { PaymentsTable } from "@/components/finance/payments-table";
import { PeriodSwitch } from "@/components/iq/period-switch";
import { BarList, DataTrust, KpiTile, Panel, PanelBody, PanelHeader, StatusWord } from "@/components/iq/ui";
import { PageHeader } from "@/components/staff/page-header";
import { PermissionDenied } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireStaff, staffCan } from "@/lib/auth";
import { type RangeKey, daysInRange, resolveRange } from "@/lib/dates";
import { capturedByDay, methodShares, tillSplit } from "@/lib/finance/ledger-view";
import { formatBps, formatINR } from "@/lib/money";
import { type RefundRow, getPaymentsLedger } from "@/lib/repositories/finance";
import { cn } from "@/lib/utils";

/** Only SUCCEEDED money went back; the other two are shown so nobody reads them as refunded. */
const REFUND_TONE: Record<RefundRow["status"], "gain" | "flag" | "loss"> = { SUCCEEDED: "gain", RESERVED: "flag", FAILED: "loss" };

function refundStatusText(row: RefundRow): string {
  if (row.status === "SUCCEEDED") return "Refunded";
  if (row.status === "FAILED") return "Failed — no money moved";
  return row.stale ? "Stuck in progress — check it" : "In progress — held, not refunded yet";
}

export const metadata: Metadata = { title: "Finance", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "mtd", label: "This month" },
];

/**
 * FINANCE — the workspace over the payments ledger. Gated on
 * `finance.view` (OWNER and MANAGER). Everything on it is `getPaymentsLedger`
 * regrouped: captured is money that arrived and is deliberately never
 * called revenue (that figure is Overview's); cash sessions, handovers and
 * reconciliation are not connected yet and the screen says so.
 */
export default async function FinancePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const staff = await requireStaff();
  const [canView, canRefund, canExport, canSeeAnalytics] = await Promise.all([staffCan("finance.view"), staffCan("orders.refund"), staffCan("reports.export"), staffCan("analytics.view")]);

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view finance" />
      </div>
    );
  }

  const { range: requested } = await searchParams;
  const key = (RANGES.find((option) => option.key === requested)?.key ?? "today") as RangeKey;
  const range = resolveRange(key);
  const ledger = await getPaymentsLedger(staff.orgId, range);

  const days = daysInRange(range);
  const series = capturedByDay(ledger.payments, days);
  const shares = methodShares(ledger.byMethod, ledger.capturedTotal);
  const split = tillSplit(ledger.byMethod);
  const top = shares[0];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title="Finance"
        description={`Every payment taken ${range.label.toLowerCase()}. Captured means the money arrived; it is not the revenue figure on Overview.`}
        actions={
          <>
            <PeriodSwitch basePath="/app/finance" options={RANGES} current={key} />
            {canSeeAnalytics && (
              <>
                <Button variant="outline" asChild>
                  <Link href="/app/iq/pnl">
                    Profit &amp; loss
                    <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/app/iq/expenses">
                    Expenses
                    <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
                  </Link>
                </Button>
              </>
            )}
          </>
        }
      />

      <DataTrust
        items={[
          { tone: "gain", text: `Payments ledger live · ${ledger.payments.length} ${ledger.payments.length === 1 ? "record" : "records"} ${range.label.toLowerCase()}` },
          { tone: "neutral", text: "Captured payments only are summed; pending and failed are listed, never counted" },
          { tone: "flag", text: "Cash sessions, rider handovers and reconciliation not connected (roadmap 5.1–5.3)" },
        ]}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile label="Captured" value={formatINR(ledger.capturedTotal, "whole")} note={ledger.capturedCount === 0 ? `No captured payments ${range.label.toLowerCase()}` : `${ledger.capturedCount} ${ledger.capturedCount === 1 ? "payment" : "payments"} · ${range.label}`} emphasis={ledger.capturedCount > 0} />
        <KpiTile label="Cash payments" value={split.cashBps === null ? "—" : formatBps(split.cashBps, 0)} missing={split.cashBps === null} note={split.cashBps === null ? "Nothing captured yet, so no split to show" : `${formatINR(split.cash, "whole")} cash · ${formatINR(split.online, "whole")} through a provider`} />
        <KpiTile label="Provider fees" value={ledger.feeTotal === 0n ? "—" : formatINR(ledger.feeTotal)} note={ledger.feeTotal === 0n ? "No provider fees recorded; cash carries none" : "Kept separate so a payout reconciles"} />
        <KpiTile
          label="Refunded"
          value={ledger.refundedCount === 0 ? "—" : formatINR(ledger.refundedTotal, "whole")}
          note={[
            ledger.refundedCount === 0 ? `No refunds ${range.label.toLowerCase()}` : `${ledger.refundedCount} ${ledger.refundedCount === 1 ? "refund" : "refunds"}`,
            ledger.reservedRefundCount > 0 ? `${formatINR(ledger.reservedRefundTotal)} in progress, not counted` : null,
            ledger.staleReservedRefundCount > 0 ? `${ledger.staleReservedRefundCount} stuck` : null,
          ]
            .filter((part) => part !== null)
            .join(" · ")}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader title="Captured by day" description="Cash under, provider payments over — the two piles a payout has to reconcile against." meta={ledger.capturedCount > 0 ? `${days.length} ${days.length === 1 ? "day" : "days"}` : undefined} />
          <PanelBody className="pt-0">
            {ledger.capturedCount === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">Nothing captured {range.label.toLowerCase()}.</p>
            ) : days.length === 1 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border px-4 py-3">
                  <p className="text-[13px] text-muted-foreground">Cash</p>
                  <p className="tabular font-money mt-1 text-[26px] leading-none">{formatINR(split.cash, "whole")}</p>
                </div>
                <div className="rounded-lg border border-border px-4 py-3">
                  <p className="text-[13px] text-muted-foreground">Through a provider</p>
                  <p className="tabular font-money mt-1 text-[26px] leading-none">{formatINR(split.online, "whole")}</p>
                </div>
              </div>
            ) : (
              <CapturedChart days={series} />
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="By method" meta={top ? `${top.label} leads` : undefined} />
          <PanelBody className="pt-0">
            {shares.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">No captured payments to split.</p>
            ) : (
              <BarList rows={shares.map((row) => ({ key: row.method, label: `${row.label} · ${row.count}`, share: row.share, shareLabel: row.shareLabel, amount: formatINR(row.total, "whole") }))} />
            )}
          </PanelBody>
        </Panel>
      </div>

      <Tabs defaultValue="payments" className="flex flex-col gap-4">
        <TabsList variant="line" aria-label="Ledger">
          <TabsTrigger value="payments">
            Payments <span className="tabular ml-1.5 text-xs text-muted-foreground">{ledger.payments.length}</span>
          </TabsTrigger>
          <TabsTrigger value="refunds">
            Refunds <span className="tabular ml-1.5 text-xs text-muted-foreground">{ledger.refunds.length}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="payments">
          <PaymentsTable
            payments={ledger.payments.map((row) => ({
              id: row.id,
              orderNumber: row.orderNumber,
              channel: row.channel,
              status: row.status,
              method: row.method,
              provider: row.provider,
              providerPaymentId: row.providerPaymentId,
              amount: row.amount,
              feeAmount: row.feeAmount,
              capturedBy: row.capturedBy,
              at: row.at.toISOString(),
              refunded: row.refunded,
              refundReserved: row.refundReserved,
              refundStuck: row.refundStuck,
              refundFailedCount: row.refundFailedCount,
            }))}
            periodLabel={range.label}
            canRefund={canRefund}
            canExport={canExport}
          />
        </TabsContent>

        <TabsContent value="refunds">
          {ledger.refunds.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border-strong/70 bg-panel px-4 py-10 text-center text-[13px] text-muted-foreground">No refunds {range.label.toLowerCase()}.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-panel">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Status</TableHead>
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
                      <TableCell className="whitespace-normal">
                        <StatusWord tone={REFUND_TONE[row.status]}>{refundStatusText(row)}</StatusWord>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{row.by ?? "System"}</TableCell>
                      <TableCell className={cn("tabular text-right font-semibold", row.status !== "SUCCEEDED" && "text-muted-foreground")}>{formatINR(row.amount)}</TableCell>
                      <TableCell className="tabular hidden text-right text-muted-foreground sm:table-cell">{row.at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
