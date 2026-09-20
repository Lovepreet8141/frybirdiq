import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBps, formatINR, type Paise } from "@/lib/money";
import { SMALL_SAMPLE_ORDERS } from "@/lib/promotions/aov";
import type { PromotionAovRow } from "@/lib/repositories/promotion-aov";

export const AOV_RANGES = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "mtd", label: "This month" },
] as const;
export type AovRangeKey = (typeof AOV_RANGES)[number]["key"];

const NO_DATA = <span className="text-muted-foreground">No data</span>;
const inr = (value: Paise | null) => (value === null ? NO_DATA : formatINR(value, "whole"));

/**
 * Average order value with and without each promotion, over a stated IST
 * window. Facts and their definitions only: no verdict, no forecast. A row
 * with a small sample is labelled, not hidden.
 */
export function PromotionAovCard({ rows, rangeLabel, activeRange }: { rows: readonly PromotionAovRow[]; rangeLabel: string; activeRange: AovRangeKey }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="font-heading text-lg font-semibold">Average order value by promotion</h2>
            <p className="text-sm text-muted-foreground">{rangeLabel}, Ambala time. Paid orders only.</p>
          </div>
          <nav aria-label="Window" className="flex gap-1">
            {AOV_RANGES.map((range) => (
              <Link
                key={range.key}
                href={`?range=${range.key}`}
                aria-current={range.key === activeRange ? "page" : undefined}
                className="inline-flex min-h-[36px] items-center rounded-md border border-border px-3 text-sm aria-[current=page]:bg-inverse aria-[current=page]:text-inverse-foreground"
              >
                {range.label}
              </Link>
            ))}
          </nav>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No promotions yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Promotion</TableHead>
                <TableHead className="text-right">Orders with it</TableHead>
                <TableHead className="text-right">AOV with it</TableHead>
                <TableHead className="text-right">Orders without</TableHead>
                <TableHead className="text-right">AOV without</TableHead>
                <TableHead className="text-right">Difference</TableHead>
                <TableHead className="text-right">Discount given</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const c = row.comparison;
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-semibold">{row.name}</div>
                      {c === null && <div className="text-xs text-muted-foreground">No code, so its orders can&apos;t be identified.</div>}
                      {c?.smallSample && <Badge variant="outline">Small sample: under {SMALL_SAMPLE_ORDERS} orders on one side</Badge>}
                    </TableCell>
                    <TableCell className="tabular text-right">{c ? (c.with.orders === 0 ? NO_DATA : c.with.orders) : NO_DATA}</TableCell>
                    <TableCell className="tabular text-right">{inr(c?.with.aov ?? null)}</TableCell>
                    <TableCell className="tabular text-right">{c ? (c.without.orders === 0 ? NO_DATA : c.without.orders) : NO_DATA}</TableCell>
                    <TableCell className="tabular text-right">{inr(c?.without.aov ?? null)}</TableCell>
                    <TableCell className="tabular text-right">
                      {c?.aovGap == null ? (
                        NO_DATA
                      ) : (
                        <>
                          {c.aovGap < 0n ? "-" : "+"}
                          {formatINR((c.aovGap < 0n ? -c.aovGap : c.aovGap) as Paise, "whole")}
                          {c.aovGapBps !== null && <span className="text-muted-foreground"> ({c.aovGapBps < 0 ? "-" : "+"}{formatBps(Math.abs(c.aovGapBps))})</span>}
                        </>
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right">{c === null || c.with.orders === 0 ? NO_DATA : formatINR(c.with.discount, "whole")}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>AOV is net-of-GST revenue divided by orders. GST is not revenue.</li>
          <li>&quot;Without&quot; is every other paid order in the same window, including orders that used a different promotion.</li>
          <li>Discount given is the discount stored on the orders that carried the code, as calculated at the time of sale.</li>
          <li>The difference is a description of these orders, not a measure of what the promotion caused.</li>
        </ul>
      </CardContent>
    </Card>
  );
}
