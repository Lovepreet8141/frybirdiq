import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AnalyticsSectionNav } from "@/components/iq/analytics-section-nav";
import { PeriodSwitch } from "@/components/iq/period-switch";
import { BarList, DataTrust, KpiTile, Panel, PanelBody, PanelHeader } from "@/components/iq/ui";
import { PageHeader } from "@/components/staff/page-header";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getStaff, staffCan } from "@/lib/auth";
import { type RangeKey, resolveRange } from "@/lib/dates";
import { type Paise, ZERO, add, formatBps, formatINR, ratioBps } from "@/lib/money";
import { listExpenses } from "@/lib/repositories/expenses";

export const metadata: Metadata = { title: "Expenses — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "mtd", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "30d", label: "Last 30 days" },
];

const paidOn = (date: string) => new Date(`${date}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** ANALYTICS › Expenses — the ledger of money out that the P&L reads. Seeing it is analytics; recording into it is finance. */
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ range?: string; saved?: string }> }) {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("analytics.view"))) redirect("/app/orders");

  const { range: requested, saved } = await searchParams;
  const key = (RANGES.find((option) => option.key === requested)?.key ?? "mtd") as RangeKey;
  const range = resolveRange(key);
  const [rows, canRecord, canSeeCustomers] = await Promise.all([listExpenses(staff.orgId, range), staffCan("finance.view"), staffCan("customers.view")]);

  const total = add(...rows.map((row) => row.amount));
  const direct = add(...rows.filter((row) => row.behaviour === "DIRECT").map((row) => row.amount));
  const fixed = add(...rows.filter((row) => row.behaviour === "FIXED").map((row) => row.amount));
  const byCategory = new Map<string, Paise>();
  for (const row of rows) byCategory.set(row.categoryName, add(byCategory.get(row.categoryName) ?? ZERO, row.amount));
  const categories = [...byCategory.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title="Expenses"
        description={`Money out ${range.label.toLowerCase()}, as recorded. Direct costs move with sales and set food cost; fixed costs are the month's overheads.`}
        actions={
          <>
            <PeriodSwitch basePath="/app/iq/expenses" options={RANGES} current={key} />
            {canRecord && (
              <Button variant="inverse" asChild>
                <Link href="/app/iq/expenses/new">Record expense</Link>
              </Button>
            )}
          </>
        }
      />
      <AnalyticsSectionNav current="expenses" canSeeCustomers={canSeeCustomers} />

      {saved === "1" && (
        <p role="status" className="rounded-md border-l-2 border-gain bg-gain-soft/60 px-4 py-3 text-sm">
          Expense recorded.
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={`Nothing recorded ${range.label.toLowerCase()}`}
          detail="Rent, gas, chicken, packaging, wages. Record them and FRYBIRD IQ can show net profit rather than just sales."
          action={
            canRecord ? (
              <Button variant="inverse" asChild>
                <Link href="/app/iq/expenses/new">Record the first one</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <DataTrust items={[{ tone: "gain", text: `${rows.length} ${rows.length === 1 ? "entry" : "entries"} · feeds the P&L for ${range.label.toLowerCase()}` }, { tone: "flag", text: "Purchase orders and receiving not connected — every entry here is typed in (roadmap 3.7)" }]} />

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiTile label="Recorded" value={formatINR(total, "whole")} note={`${rows.length} ${rows.length === 1 ? "entry" : "entries"}`} emphasis />
            <KpiTile label="Direct costs" value={formatINR(direct, "whole")} meta={total > ZERO ? formatBps(ratioBps(direct, total), 0) : undefined} note="Move with sales — food, packaging, riders" />
            <KpiTile label="Fixed costs" value={formatINR(fixed, "whole")} meta={total > ZERO ? formatBps(ratioBps(fixed, total), 0) : undefined} note="The month's overheads" />
            <KpiTile label="Largest category" value={categories[0] ? formatINR(categories[0][1], "whole") : "—"} missing={!categories[0]} note={categories[0] ? categories[0][0] : "No entries"} link={{ label: "Profit & loss", href: "/app/iq/pnl" }} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Panel>
              <PanelHeader title="By category" meta={`${categories.length}`} />
              <PanelBody className="pt-0">
                <BarList rows={categories.map(([name, amount]) => ({ key: name, label: name, share: total > ZERO ? ratioBps(amount, total) / 10_000 : 0, shareLabel: total > ZERO ? formatBps(ratioBps(amount, total), 0) : "—", amount: formatINR(amount, "whole") }))} />
              </PanelBody>
            </Panel>
            <Panel className="lg:col-span-2">
              <PanelHeader title="Every entry" meta={`${rows.length}`} />
              <PanelBody flush className="border-t border-border pb-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="hidden sm:table-cell">Paid on</TableHead>
                      <TableHead>What for</TableHead>
                      <TableHead className="hidden md:table-cell">Category</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="tabular hidden whitespace-nowrap text-muted-foreground sm:table-cell">{paidOn(row.paidOn)}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium">{row.description}</span>
                            <span className="text-xs text-muted-foreground">
                              <span className="sm:hidden">{paidOn(row.paidOn)} · </span>
                              <span className="md:hidden">{row.categoryName}</span>
                              {row.accountName && <span className="hidden md:inline">{row.accountName}</span>}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <div className="flex items-center gap-2">
                            <span>{row.categoryName}</span>
                            <Badge variant={row.behaviour === "DIRECT" ? "info" : "outline"}>{row.behaviour === "DIRECT" ? "Moves with sales" : "Fixed"}</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="tabular text-right font-semibold">{formatINR(row.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </PanelBody>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
