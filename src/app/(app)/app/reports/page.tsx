import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileSpreadsheet, Percent, Receipt, ShoppingBag, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/staff/page-header";
import { PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { type RangeKey, resolveRange } from "@/lib/dates";

export const metadata: Metadata = { title: "Exports", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "mtd", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "30d", label: "30 days" },
];

const EXPORTS: { type: string; label: string; description: string; icon: typeof ShoppingBag }[] = [
  { type: "orders", label: "Orders", description: "Every order in the range — totals, tax, channel, payment status.", icon: ShoppingBag },
  { type: "payments", label: "Payments", description: "Every payment taken, by method and provider, with refunds.", icon: Wallet },
  { type: "expenses", label: "Expenses", description: "Money out, by category — the same figures behind the P&L.", icon: Receipt },
  { type: "gst-summary", label: "GST summary", description: "CGST, SGST and total tax collected, by rate.", icon: Percent },
];

/**
 * FINANCE › Exports. Roadmap 5.4.
 *
 * Four CSV downloads, gated on `reports.export` — held by OWNER, ADMIN,
 * MANAGER and ANALYST, not by CASHIER or KITCHEN. This page only decides
 * what to show; the actual gate is `requirePermission("reports.export")` in
 * `/api/reports/export`, checked on every request that route serves,
 * because hiding these links is not authorization (§41).
 *
 * Plain `<a>` downloads rather than a form or a fetch: a CSV needs the
 * browser's own save dialog (`Content-Disposition: attachment`), which only
 * a real navigation triggers.
 */
export default async function ExportsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const staff = await requireStaff();
  const canExport = await staffCan("reports.export");

  if (!canExport) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="export reports" />
      </div>
    );
  }

  const { range: requested } = await searchParams;
  const key = (RANGES.find((option) => option.key === requested)?.key ?? "mtd") as RangeKey;
  const range = resolveRange(key);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title="Exports"
        description="CSV downloads for the period below. Money is plain rupees — 940000.00, not ₹9,40,000 — so a spreadsheet can sum it straight away."
        actions={
          <nav className="inline-flex max-w-full flex-wrap gap-0.5 rounded-[10px] border border-border bg-panel p-1" aria-label="Period">
            {RANGES.map((option) => (
              <Link
                key={option.key}
                href={`/app/reports?range=${option.key}`}
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
        }
      />

      <p className="text-sm text-muted-foreground">{range.label}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        {EXPORTS.map((item) => (
          <Card key={item.type}>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                  <item.icon className="size-4.5" aria-hidden="true" />
                </span>
                <h2 className="font-heading text-[15px] font-semibold">{item.label}</h2>
              </div>
              <p className="text-[13px] leading-[1.5] text-muted-foreground">{item.description}</p>
              <a
                href={`/api/reports/export?type=${item.type}&range=${key}`}
                className="mt-1 inline-flex min-h-[40px] w-fit items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity duration-[120ms] hover:opacity-90"
              >
                <Download className="size-4" aria-hidden="true" />
                Download CSV
              </a>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
        <FileSpreadsheet className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        Opens directly in Excel or Google Sheets. Signed in as {staff.displayName ?? staff.email ?? "staff"}.
      </p>
    </div>
  );
}
