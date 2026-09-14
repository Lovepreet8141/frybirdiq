import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { statusLabel } from "@/components/staff/order-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FulfilmentType, OrderStatus } from "@/domain/order-status";
import { type Paise, formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface OpenOrderRow {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly fulfilment: FulfilmentType;
  readonly customerName: string | null;
  readonly tableName: string | null;
  readonly items: readonly { name: string; quantity: number }[];
  readonly grandTotal: Paise;
  readonly isPaid: boolean;
  readonly placedAt: Date | null;
  readonly estimatedReadyAt: Date | null;
}

function where(row: OpenOrderRow): string {
  if (row.fulfilment === "DINE_IN") return row.tableName ?? "Dine-in";
  if (row.fulfilment === "DELIVERY") return "Delivery";
  return "Collection";
}

function itemsSummary(items: OpenOrderRow["items"]): string {
  const shown = items.slice(0, 2).map((item) => (item.quantity > 1 ? `${item.quantity}× ${item.name}` : item.name));
  const more = items.length - shown.length;
  return more > 0 ? `${shown.join(", ")} +${more}` : shown.join(", ") || "No items";
}

const minutesSince = (date: Date, now: number) => Math.max(0, Math.floor((now - date.getTime()) / 60_000));

/**
 * The purchased E-commerce dashboard's `RecentOrders` card
 * (`ecommerce/components/recent-orders.tsx`, registry `tables14`/`tables9`):
 * a dense table inside a card with a header action. Its demo customers and
 * products became the counter's open orders — every row is an order the
 * counter still has to do something about, and clicking one opens it on
 * the Orders board. "Late" is the same fact Live operations uses: past the
 * time the counter promised.
 */
export function OpenOrdersCard({ orders, now, className }: { orders: readonly OpenOrderRow[]; now: number; className?: string }) {
  const late = orders.filter((row) => row.estimatedReadyAt !== null && row.estimatedReadyAt.getTime() < now).length;
  return (
    <Card className={cn("h-full", className)}>
      <CardHeader>
        <CardTitle>Open orders</CardTitle>
        <CardDescription>{orders.length === 0 ? "Nothing the counter still has to act on" : `${orders.length} in progress${late > 0 ? ` · ${late} past the promised time` : ""}`}</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" asChild>
            <Link href="/app/orders">
              Orders board
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className={cn(orders.length > 0 && "px-0 pb-0")}>
        {orders.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">No open orders. New orders appear here the moment they are placed.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-(--card-spacing)">Order</TableHead>
                  <TableHead className="hidden md:table-cell">Items</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Waiting</TableHead>
                  <TableHead className="pr-(--card-spacing) text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.slice(0, 8).map((row) => {
                  const isLate = row.estimatedReadyAt !== null && row.estimatedReadyAt.getTime() < now;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="pl-(--card-spacing)">
                        <div className="flex flex-col gap-0.5">
                          <Link href={`/app/orders?open=${row.id}`} className="tabular font-semibold underline-offset-2 hover:underline">
                            #{row.orderNumber}
                          </Link>
                          <span className="text-[11.5px] text-muted-foreground">
                            {where(row)}
                            {row.customerName ? ` · ${row.customerName}` : ""}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden max-w-[260px] truncate text-muted-foreground md:table-cell">{itemsSummary(row.items)}</TableCell>
                      <TableCell>
                        <Badge variant={isLate ? "destructive" : row.status === "READY" ? "success" : "outline"}>{isLate ? "Late" : statusLabel(row.status, row.fulfilment)}</Badge>
                      </TableCell>
                      <TableCell className={cn("tabular hidden text-right sm:table-cell", isLate ? "font-semibold text-loss" : "text-muted-foreground")}>{row.placedAt ? `${minutesSince(row.placedAt, now)} min` : "—"}</TableCell>
                      <TableCell className="tabular pr-(--card-spacing) text-right font-semibold">
                        {formatINR(row.grandTotal, "whole")}
                        {!row.isPaid && <span className="ml-1 text-[11px] font-medium text-flag">unpaid</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
