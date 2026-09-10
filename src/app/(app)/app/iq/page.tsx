import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { RevenueChart } from "@/components/iq/revenue-chart";
import { StatTile } from "@/components/iq/stat-tile";
import { EmptyState } from "@/components/states";
import { getStaff, staffCan } from "@/lib/auth";
import { type RangeKey, resolveRange } from "@/lib/dates";
import { formatINR, ratioBps, formatBps } from "@/lib/money";
import { getDashboard } from "@/lib/repositories/analytics";

export const metadata: Metadata = { title: "FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

export default async function IqPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("analytics.view"))) redirect("/app/orders");

  const { range: requested } = await searchParams;
  const key = (RANGES.find((option) => option.key === requested)?.key ?? "today") as RangeKey;
  const range = resolveRange(key);
  const data = await getDashboard(staff.orgId, range);

  const deliveryShare =
    data.collection.orders + data.delivery.orders === 0
      ? 0
      : ratioBps(
          BigInt(data.delivery.orders) as never,
          BigInt(data.collection.orders + data.delivery.orders) as never,
        );

  return (
    <div className="mx-auto w-full max-w-6xl px-[var(--gutter)] py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">
            FRYBIRD <span className="text-primary">IQ</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{range.label}, Sector 9</p>
          <nav aria-label="FRYBIRD IQ sections" className="mt-3 flex flex-wrap gap-4 text-sm font-semibold">
            <span aria-current="page" className="text-foreground">Sales</span>
            <Link href="/app/iq/pnl" className="text-muted-foreground transition-colors hover:text-foreground">
              Profit and loss
            </Link>
            <Link href="/app/iq/expenses" className="text-muted-foreground transition-colors hover:text-foreground">
              Expenses
            </Link>
          </nav>
        </div>

        {/* Filters in one row above the charts. */}
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

      {data.empty ? (
        <EmptyState
          className="mt-8"
          title="No sales recorded for this period."
          detail="This is not ₹0 of takings — it is no orders at all. Try a longer period."
        />
      ) : (
        <>
          {/* One hairline-divided panel rather than five floating cards: the
              figures are one band of related numbers, not five widgets. */}
          <div className="mt-8 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Revenue"
              value={formatINR(data.revenue.value, "whole")}
              changeBps={data.revenue.changeBps}
              comparedTo="the period before"
            />
            <StatTile
              label="Orders"
              value={String(data.orders.value)}
              changeBps={data.orders.changeBps}
              comparedTo="the period before"
            />
            <StatTile
              label="Average order"
              value={formatINR(data.averageOrder.value, "whole")}
              changeBps={data.averageOrder.changeBps}
              comparedTo="the period before"
            />
            <StatTile
              label="Waiting on payment"
              value={formatINR(data.openValue, "whole")}
              detail={`${data.openOrders} open ${data.openOrders === 1 ? "order" : "orders"}`}
              inverted
            />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <section aria-labelledby="revenue" className="rounded-lg border border-border bg-surface p-5">
              <h2 id="revenue" className="font-heading text-lg font-semibold">
                Revenue by day
              </h2>
              <RevenueChart series={data.series} className="mt-4" />
            </section>

            <div className="flex flex-col gap-6">
              <section aria-labelledby="split" className="rounded-lg border border-border bg-surface p-5">
                <h2 id="split" className="font-heading text-lg font-semibold">
                  How they ordered
                </h2>

                {/*
                  A share of a whole, so one hue against a track — not two
                  categorical colours. This palette has no second categorical
                  hue that survives a colourblindness check, and inventing one
                  would be worse than not needing it.
                */}
                <div
                  className="mt-4 flex h-2 overflow-hidden rounded-full bg-border"
                  role="img"
                  aria-label={`${formatBps(deliveryShare, 0)} of orders were delivery`}
                >
                  <div className="h-full bg-primary" style={{ width: `${deliveryShare / 100}%` }} />
                </div>

                <dl className="mt-4 flex flex-col gap-3 text-sm">
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="flex items-center gap-2">
                      <span className="size-2.5 rounded-full bg-primary" aria-hidden="true" />
                      Delivery
                    </dt>
                    <dd className="tabular">
                      {data.delivery.orders} · <strong>{formatINR(data.delivery.revenue, "whole")}</strong>
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="flex items-center gap-2">
                      <span className="size-2.5 rounded-full bg-border-strong" aria-hidden="true" />
                      Collection
                    </dt>
                    <dd className="tabular">
                      {data.collection.orders} · <strong>{formatINR(data.collection.revenue, "whole")}</strong>
                    </dd>
                  </div>
                </dl>
              </section>

              <section aria-labelledby="top" className="rounded-lg border border-border bg-surface p-5">
                <h2 id="top" className="font-heading text-lg font-semibold">
                  Top sellers
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">By revenue, not by count.</p>

                {data.topProducts.length === 0 ? (
                  <p className="mt-4 text-sm text-muted-foreground">Nothing sold in this period.</p>
                ) : (
                  <ol className="mt-4 flex flex-col gap-2.5 text-sm">
                    {data.topProducts.map((product) => (
                      <li key={product.name} className="flex items-baseline justify-between gap-4">
                        <span className="min-w-0 truncate">{product.name}</span>
                        <span className="tabular shrink-0 text-muted-foreground">
                          {product.quantity} · <strong className="text-foreground">{formatINR(product.revenue, "whole")}</strong>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          </div>

          <p className="mt-8 text-sm text-muted-foreground">
            Revenue counts orders that have been paid for. Orders taken but not yet settled are shown separately as
            waiting on payment.
          </p>
        </>
      )}
    </div>
  );
}
