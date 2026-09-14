import type { Metadata } from "next";
import Link from "next/link";
import { PeriodSwitch } from "@/components/iq/period-switch";
import { OrderHistoryTable } from "@/components/staff/order-history-table";
import { PageHeader } from "@/components/staff/page-header";
import { PermissionDenied } from "@/components/states";
import { Button } from "@/components/ui/button";
import { requireStaff, staffCan } from "@/lib/auth";
import { type RangeKey, resolveRange } from "@/lib/dates";
import { listOrderHistory } from "@/lib/repositories/order-history";

export const metadata: Metadata = { title: "Order history", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "mtd", label: "This month" },
];

/**
 * Orders the live board is done with — completed, cancelled, failed,
 * refunded — over a period, each expandable to the lines as they were
 * sold. Read-only; the live board at /app/orders stays the place things
 * happen.
 */
export default async function OrderHistoryPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const staff = await requireStaff();
  if (!(await staffCan("orders.view"))) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view order history" />
      </div>
    );
  }

  const { range: requested } = await searchParams;
  const key = (RANGES.find((option) => option.key === requested)?.key ?? "7d") as RangeKey;
  const range = resolveRange(key);
  const orders = await listOrderHistory(staff.orgId, range);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title="Order history"
        description={`Finished orders ${range.label.toLowerCase()} — ${orders.length} ${orders.length === 1 ? "order" : "orders"}, most recent first.`}
        actions={
          <>
            <PeriodSwitch basePath="/app/orders/history" options={RANGES} current={key} />
            <Button variant="outline" asChild>
              <Link href="/app/orders">Live orders</Link>
            </Button>
          </>
        }
      />
      <OrderHistoryTable
        periodLabel={range.label}
        orders={orders.map((order) => ({
          ...order,
          placedAt: order.placedAt?.toISOString() ?? null,
          closedAt: order.closedAt.toISOString(),
          items: order.items.map((item) => ({ ...item, modifiers: [...item.modifiers] })),
        }))}
      />
    </div>
  );
}
