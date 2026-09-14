import type { Metadata } from "next";
import Link from "next/link";
import { AnalyticsSectionNav } from "@/components/iq/analytics-section-nav";
import { BestSellersCard } from "@/components/iq/best-sellers-card";
import { ProductsPerformanceTable } from "@/components/iq/products-performance-table";
import { BarList, DataTrust, KpiTile, Panel, PanelBody, PanelHeader } from "@/components/iq/ui";
import { PageHeader } from "@/components/staff/page-header";
import { EmptyState, PermissionDenied } from "@/components/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

/**
 * ANALYTICS › Products & categories — what each product and category did
 * over a range. Menu engineering's first half: volume, revenue, share,
 * average paid. Cost, margin and contribution wait on recipes having
 * ingredient lines and a net-of-tax path through `src/lib/pricing`; the
 * Recipe column says how far each product is from that.
 */
export default async function ProductsAnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string; tab?: string }> }) {
  const staff = await requireStaff();
  if (!(await staffCan("analytics.view"))) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view product analytics" />
      </div>
    );
  }

  const { range: requested, tab } = await searchParams;
  const key = (RANGES.find((option) => option.key === requested)?.key ?? "7d") as RangeKey;
  const range = resolveRange(key);
  const [performance, canExport, canSeeCustomers] = await Promise.all([getMenuPerformance(staff.orgId, range), staffCan("reports.export"), staffCan("customers.view")]);

  const catalogued = performance.products.filter((product) => product.productId !== null);
  const withRecipeLines = catalogued.filter((product) => product.recipe.ingredientCount > 0).length;
  const byUnits = [...performance.products].sort((a, b) => b.quantity - a.quantity).slice(0, 5);
  const top = performance.products[0];
  const topCategory = performance.categories[0];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title="Products & categories"
        description={`What each product did ${range.label.toLowerCase()} — revenue includes GST, as the customer paid it.`}
        actions={
          <nav className="inline-flex max-w-full flex-wrap gap-0.5 rounded-[10px] border border-border bg-panel p-1" aria-label="Period">
            {RANGES.map((option) => (
              <Link
                key={option.key}
                href={`/app/iq/products?range=${option.key}${tab ? `&tab=${tab}` : ""}`}
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
      <AnalyticsSectionNav current="products" canSeeCustomers={canSeeCustomers} />

      {performance.empty ? (
        <EmptyState title={`No paid orders ${range.label.toLowerCase()}`} detail="Product performance appears once an order in this range has been paid for. Try a wider period." />
      ) : (
        <>
          <DataTrust
            items={[
              { tone: "gain", text: `Paid orders only · same revenue rule as Overview · ${range.label}` },
              { tone: "flag", text: `Margin not connected — ${withRecipeLines} of ${catalogued.length} products have recipe lines, and revenue is not yet netted of GST for costing` },
            ]}
          />

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiTile label="Product revenue" value={formatINR(performance.total, "whole")} note={`${performance.products.length} ${performance.products.length === 1 ? "product" : "products"} sold`} emphasis />
            <KpiTile label="Top product" value={top ? formatBps(top.shareBps, 1) : "—"} missing={!top} note={top ? `${top.name} · ${formatINR(top.revenue.value, "whole")}` : "No sales in this period"} />
            <KpiTile label="Top category" value={topCategory ? formatBps(topCategory.shareBps, 1) : "—"} missing={!topCategory} note={topCategory ? `${topCategory.name} · ${performance.categories.length} ${performance.categories.length === 1 ? "category" : "categories"} sold` : "No sales in this period"} />
            <KpiTile label="Recipes with lines" value={`${withRecipeLines} of ${catalogued.length}`} note={withRecipeLines === catalogued.length ? "Every sold product can be costed" : "The prerequisite for margin per product"} link={{ label: "Menu", href: "/app/iq/menu" }} />
          </div>

          <Tabs defaultValue={tab === "categories" ? "categories" : "products"} className="flex flex-col gap-4">
            <TabsList variant="line" aria-label="Report">
              <TabsTrigger value="products">
                Products <span className="tabular ml-1.5 text-xs text-muted-foreground">{performance.products.length}</span>
              </TabsTrigger>
              <TabsTrigger value="categories">
                Categories <span className="tabular ml-1.5 text-xs text-muted-foreground">{performance.categories.length}</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="products" className="flex flex-col gap-6">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
                <BestSellersCard title="Best sellers" description={`By units, ${range.label.toLowerCase()}`} products={byUnits.map((product) => ({ key: product.productId ?? product.name, name: product.name, imageUrl: product.imageUrl, quantity: product.quantity }))} />
                <Panel>
                  <PanelHeader title="Share of revenue" description="The ten products that made the most of it." />
                  <PanelBody className="pt-0">
                    <BarList rows={performance.products.slice(0, 10).map((product) => ({ key: product.productId ?? product.name, label: product.name, share: product.shareBps / 10_000, shareLabel: formatBps(product.shareBps, 1), amount: formatINR(product.revenue.value, "whole") }))} />
                  </PanelBody>
                </Panel>
              </div>
              <ProductsPerformanceTable
                products={performance.products.map((product) => ({
                  key: product.productId ?? `name:${product.name}`,
                  productId: product.productId,
                  matchedBy: product.matchedBy,
                  name: product.name,
                  category: product.category,
                  isActive: product.isActive,
                  quantity: product.quantity,
                  orders: product.orders,
                  revenue: product.revenue.value,
                  changeBps: product.revenue.changeBps,
                  shareBps: product.shareBps,
                  averagePaid: product.averagePaid,
                  recipe: product.recipe,
                }))}
                periodLabel={range.label}
                canExport={canExport}
              />
            </TabsContent>

            <TabsContent value="categories" className="flex flex-col gap-6">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                <Panel>
                  <PanelHeader title="Share by category" />
                  <PanelBody className="pt-0">
                    <BarList rows={performance.categories.map((row) => ({ key: row.name, label: row.name, share: row.shareBps / 10_000, shareLabel: formatBps(row.shareBps, 1), amount: formatINR(row.revenue, "whole") }))} />
                  </PanelBody>
                </Panel>
                <Panel>
                  <PanelHeader title="Every category" meta={`${performance.categories.length}`} />
                  <PanelBody flush className="border-t border-border pb-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Category</TableHead>
                          <TableHead className="text-right">Units</TableHead>
                          <TableHead className="text-right">Revenue</TableHead>
                          <TableHead className="hidden text-right sm:table-cell">Share</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {performance.categories.map((row) => (
                          <TableRow key={row.name}>
                            <TableCell className="font-medium">{row.name}</TableCell>
                            <TableCell className="tabular text-right text-muted-foreground">{row.quantity}</TableCell>
                            <TableCell className="tabular text-right font-semibold">{formatINR(row.revenue, "whole")}</TableCell>
                            <TableCell className="tabular hidden text-right text-muted-foreground sm:table-cell">{formatBps(row.shareBps, 1)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </PanelBody>
                </Panel>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
