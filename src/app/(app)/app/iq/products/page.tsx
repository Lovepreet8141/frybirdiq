import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BestSellersCard } from "@/components/iq/best-sellers-card";
import { MiniStat } from "@/components/staff/mini-stat";
import { PageHeader } from "@/components/staff/page-header";
import { EmptyState, PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { type RangeKey, resolveRange } from "@/lib/dates";
import { formatBps, formatINR } from "@/lib/money";
import { getMenuPerformance } from "@/lib/repositories/analytics";

export const metadata: Metadata = { title: "Products", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "mtd", label: "This month" },
];

function delta(changeBps: number | null): string {
  if (changeBps === null) return "—";
  return `${changeBps > 0 ? "+" : ""}${formatBps(changeBps, 1)}`;
}

/**
 * ANALYTICS › Products — what each product actually did over a range.
 * Menu engineering's first half: volume, revenue, share, average paid. The
 * second half — cost, margin, contribution — waits on recipes having
 * ingredient lines and a net-of-tax path through `src/lib/pricing`, so the
 * "Recipe" column says honestly how far each product is from that.
 */
export default async function ProductsAnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const staff = await requireStaff();
  if (!(await staffCan("analytics.view"))) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view product analytics" />
      </div>
    );
  }

  const { range: requested } = await searchParams;
  const key = (RANGES.find((option) => option.key === requested)?.key ?? "7d") as RangeKey;
  const range = resolveRange(key);
  const performance = await getMenuPerformance(staff.orgId, range);

  const withRecipeLines = performance.products.filter((product) => product.recipe.ingredientCount > 0).length;
  const byUnits = [...performance.products].sort((a, b) => b.quantity - a.quantity).slice(0, 5);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title="Products"
        description={`What each product did, ${range.label.toLowerCase()} — revenue includes GST, as the customer paid it.`}
        actions={
          <nav className="flex flex-wrap gap-1" aria-label="Period">
            {RANGES.map((option) => (
              <Link
                key={option.key}
                href={`/app/iq/products?range=${option.key}`}
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

      {performance.empty ? (
        <EmptyState title="No paid orders in this period." detail="Product performance appears once an order in this range has been paid for." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MiniStat label="Product revenue" value={formatINR(performance.total, "whole")} hint={`${performance.products.length} products sold`} />
            <MiniStat label="Top product" value={performance.products[0]?.name ?? "—"} hint={performance.products[0] ? `${formatBps(performance.products[0].shareBps, 1)} of revenue` : undefined} />
            <MiniStat label="Categories" value={String(performance.categories.length)} hint={performance.categories[0] ? `${performance.categories[0].name} leads` : undefined} />
            <MiniStat
              label="Costed recipes"
              value={`${withRecipeLines} / ${performance.products.filter((product) => product.productId !== null).length}`}
              hint="Products with recipe lines — the prerequisite for margin"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <BestSellersCard
              title="Best sellers"
              description={`By units, ${range.label.toLowerCase()}`}
              products={byUnits.map((product) => ({ key: product.productId ?? product.name, name: product.name, imageUrl: product.imageUrl, quantity: product.quantity }))}
            />
            <Card>
              <CardContent className="flex flex-col gap-3">
                <h2 className="font-heading text-lg font-semibold">By category</h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Units</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {performance.categories.map((row) => (
                      <TableRow key={row.name}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell className="tabular text-right text-muted-foreground">{row.quantity}</TableCell>
                        <TableCell className="tabular text-right font-semibold">{formatINR(row.revenue, "whole")}</TableCell>
                        <TableCell className="tabular text-right text-muted-foreground">{formatBps(row.shareBps, 1)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <section aria-labelledby="products-heading" className="flex flex-col gap-3">
            <h2 id="products-heading" className="font-heading text-lg font-semibold">
              Every product
            </h2>
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Orders</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="hidden text-right md:table-cell">vs previous</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Share</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">Avg paid</TableHead>
                    <TableHead className="hidden lg:table-cell">Recipe</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {performance.products.map((product) => (
                    <TableRow key={product.productId ?? `name:${product.name}`}>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold">{product.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {product.productId === null ? "Removed from menu" : (product.category ?? "Uncategorised")}
                            {product.productId !== null && !product.isActive ? " · inactive" : ""}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="tabular text-right">{product.quantity}</TableCell>
                      <TableCell className="tabular hidden text-right text-muted-foreground sm:table-cell">{product.orders}</TableCell>
                      <TableCell className="tabular text-right font-semibold">{formatINR(product.revenue.value, "whole")}</TableCell>
                      <TableCell className="tabular hidden text-right text-muted-foreground md:table-cell">{delta(product.revenue.changeBps)}</TableCell>
                      <TableCell className="tabular hidden text-right text-muted-foreground md:table-cell">{formatBps(product.shareBps, 1)}</TableCell>
                      <TableCell className="tabular hidden text-right lg:table-cell">{formatINR(product.averagePaid)}</TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {product.productId === null ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : product.recipe.ingredientCount > 0 ? (
                          <Badge variant="outline">{product.recipe.ingredientCount} ingredients</Badge>
                        ) : product.recipe.linked ? (
                          <Badge variant="outline">No lines yet</Badge>
                        ) : (
                          <Badge variant="destructive">No recipe</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
