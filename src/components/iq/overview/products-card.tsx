import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type Paise, formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface TopProductRow {
  readonly name: string;
  readonly quantity: number;
  readonly revenue: Paise;
}

export interface GapRow {
  readonly name: string;
  readonly slug: string;
  readonly price: Paise;
}

/**
 * The purchased Sales dashboard's `BestSellingProducts` list
 * (`sales/components/best-selling-products.tsx`, registry `product-list-card1`)
 * — bordered rows, name left, "N sold" right — with the kit's tabs-in-header
 * idiom so the other half of "what is selling" (nothing sold) sits behind a
 * second tab instead of a second card. Thumbnails are omitted: the top
 * sellers query carries no image, and a placeholder square is decoration.
 */
export function ProductsCard({ top, gaps, periodLabel, className }: { top: readonly TopProductRow[]; gaps: readonly GapRow[]; periodLabel: string; className?: string }) {
  const peak = Math.max(1, ...top.map((row) => row.quantity));
  return (
    <Card className={cn("h-full", className)}>
      <Tabs defaultValue="top" className="flex h-full flex-col gap-0">
        <CardHeader>
          <CardTitle>Products</CardTitle>
          <CardDescription>{periodLabel} · by revenue</CardDescription>
          <CardAction>
            <TabsList variant="line" className="h-8">
              <TabsTrigger value="top" className="text-[12.5px]">
                Top sellers
              </TabsTrigger>
              <TabsTrigger value="gaps" className="text-[12.5px]">
                Not selling <span className="tabular ml-1 text-muted-foreground">{gaps.length}</span>
              </TabsTrigger>
            </TabsList>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col">
          <TabsContent value="top" className="flex-1">
            {top.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">Nothing sold {periodLabel.toLowerCase()}.</p>
            ) : (
              <ol className="space-y-2">
                {top.slice(0, 6).map((row, index) => (
                  <li key={row.name} className="rounded-md border border-border px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="tabular w-4 shrink-0 text-[11.5px] text-muted-foreground">{index + 1}</span>
                        <span className="truncate text-[13px] font-medium">{row.name}</span>
                      </div>
                      <div className="tabular shrink-0 text-[12.5px]">
                        <span className="font-semibold">{formatINR(row.revenue, "whole")}</span>
                        <span className="text-muted-foreground"> · {row.quantity} sold</span>
                      </div>
                    </div>
                    <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <div className="h-full rounded-full bg-ramp-4" style={{ width: `${Math.max(3, (row.quantity / peak) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </TabsContent>
          <TabsContent value="gaps" className="flex-1">
            {gaps.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">Everything on the menu sold at least once {periodLabel.toLowerCase()}.</p>
            ) : (
              <ul className="space-y-2">
                {gaps.slice(0, 6).map((row) => (
                  <li key={row.slug} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                    <span className="truncate text-[13px] font-medium">{row.name}</span>
                    <span className="tabular shrink-0 text-[12.5px] text-muted-foreground">{formatINR(row.price, "whole")} · no sales</span>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
          <div className="mt-3 border-t border-border pt-3">
            <Button variant="link" size="sm" className="h-auto p-0 text-[12px] text-muted-foreground hover:text-foreground" asChild>
              <Link href="/app/iq/products">
                Every product
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Tabs>
    </Card>
  );
}
