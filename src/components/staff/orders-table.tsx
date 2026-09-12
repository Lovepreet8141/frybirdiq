"use client";

import { useMemo, useState } from "react";
import { Clock, Eye, MoreVertical, Printer, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatINR } from "@/lib/money";
import type { OrderStatus } from "@/domain/order-status";
import { cn } from "@/lib/utils";
import { OrderCard, type StaffOrder, statusLabel, statusTone } from "@/components/staff/order-card";
import { openKotWindow } from "@/components/staff/print-kot";

/**
 * Every non-terminal status a tab can filter on, in the order the ticket
 * actually moves through. Shown even at zero count — a stable set of tabs
 * reads better than one that resizes as orders move, and a manager scanning
 * for "is anything stuck at Accepted" needs the tab to still be there.
 */
const STATUS_TABS: readonly { status: OrderStatus; label: string }[] = [
  { status: "PENDING_PAYMENT", label: "New" },
  { status: "PAID", label: "Paid" },
  { status: "ACCEPTED", label: "Accepted" },
  { status: "PREPARING", label: "Cooking" },
  { status: "READY", label: "Ready" },
  { status: "OUT_FOR_DELIVERY", label: "Out for delivery" },
];

function StatusDot({ status }: { status: OrderStatus }) {
  const tone = statusTone(status);
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        tone === "success" ? "bg-[#3F9D52]" : tone === "warning" ? "bg-warning" : "bg-muted-foreground",
      )}
      aria-hidden="true"
    />
  );
}

function formatClock(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
}

/**
 * The premium order-management workspace: a compact, filterable, searchable
 * table replacing the old vertical card list, with a Sheet on the side for
 * full detail and every existing action.
 *
 * No order logic lives here. Search and the status tabs only slice the same
 * `orders` array the page already fetched — every figure, badge and action
 * comes from `StaffOrder` exactly as `OrderCard` already renders it, and
 * `OrderCard` itself is reused unmodified inside the sheet rather than
 * reimplemented, so there is exactly one place that calls
 * `advanceOrderAction`/`markPaidAction` and prints a KOT.
 */
export function OrdersTable({
  orders,
  canSettle,
  canAdvance,
  canPrintKot,
  canSeeCustomers = false,
  initialSelectedId = null,
}: {
  orders: readonly StaffOrder[];
  canSettle: boolean;
  canAdvance: boolean;
  canPrintKot: boolean;
  canSeeCustomers?: boolean;
  /** An order to open on arrival — how Live operations and Activity deep-link into this screen. */
  initialSelectedId?: string | null;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(initialSelectedId);

  const counts = useMemo(() => {
    const map = new Map<OrderStatus, number>();
    for (const order of orders) map.set(order.status, (map.get(order.status) ?? 0) + 1);
    return map;
  }, [orders]);

  const normalisedSearch = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    return orders.filter((order) => {
      if (statusFilter !== "all" && order.status !== statusFilter) return false;
      if (normalisedSearch === "") return true;
      return (
        order.orderNumber.toLowerCase().includes(normalisedSearch) ||
        (order.customerName ?? "").toLowerCase().includes(normalisedSearch) ||
        (order.customerPhone ?? "").includes(normalisedSearch)
      );
    });
  }, [orders, statusFilter, normalisedSearch]);

  // Looked up fresh from `orders` on every render, never cached — a status
  // change inside the sheet calls `router.refresh()` (in `OrderCard`), the
  // page re-fetches, and this must reflect the new status or close itself if
  // the order left the active list entirely (e.g. it just completed).
  const selectedOrder = selectedOrderId ? (orders.find((order) => order.id === selectedOrderId) ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="max-w-full overflow-x-auto rounded-lg border border-border"
          role="tablist"
          aria-label="Filter by status"
        >
          <div className="inline-flex divide-x divide-border">
            <button
              type="button"
              role="tab"
              aria-selected={statusFilter === "all"}
              onClick={() => setStatusFilter("all")}
              className={cn(
                "whitespace-nowrap px-3.5 py-2 text-sm transition-colors first:rounded-l-lg last:rounded-r-lg",
                statusFilter === "all" ? "bg-surface-muted font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              All <span className="tabular text-xs">({orders.length})</span>
            </button>
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.status}
                type="button"
                role="tab"
                aria-selected={statusFilter === tab.status}
                onClick={() => setStatusFilter(tab.status)}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2 text-sm transition-colors first:rounded-l-lg last:rounded-r-lg",
                  statusFilter === tab.status ? "bg-surface-muted font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <StatusDot status={tab.status} />
                {tab.label} <span className="tabular text-xs">({counts.get(tab.status) ?? 0})</span>
              </button>
            ))}
          </div>
        </div>

        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search order #, name or phone"
            aria-label="Search orders"
            className="h-9 pl-8"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="hidden md:table-cell">Items</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Placed / promised</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-10" aria-label="Actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 whitespace-normal text-center text-muted-foreground">
                  {orders.length === 0 ? "No open orders." : "No orders match this filter."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((order) => {
                const isDelivery = order.fulfilment === "DELIVERY";
                const placedClock = formatClock(order.placedAt);
                const promisedClock = order.estimatedReadyAt ? formatClock(order.estimatedReadyAt) : null;

                return (
                  <TableRow
                    key={order.id}
                    onClick={() => setSelectedOrderId(order.id)}
                    className="cursor-pointer"
                  >
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="tabular font-semibold">#{order.orderNumber}</span>
                        <span className="text-xs text-muted-foreground">{isDelivery ? "Delivery" : order.fulfilment === "DINE_IN" ? "Dine-in" : "Collection"}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="truncate">{order.customerName ?? "Walk-in"}</span>
                        {order.customerPhone && <span className="tabular text-xs text-muted-foreground">{order.customerPhone}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant="outline">
                        {order.items.length} {order.items.length === 1 ? "item" : "items"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2.5 py-1 text-xs font-semibold">
                        <StatusDot status={order.status} />
                        {statusLabel(order.status, order.fulfilment)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                        {placedClock && <span className="tabular">Placed {placedClock}</span>}
                        {promisedClock && (
                          <span className="tabular flex items-center gap-1 font-semibold text-foreground">
                            <Clock className="size-3" aria-hidden="true" />
                            {promisedClock}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="tabular font-semibold">{formatINR(order.grandTotal)}</span>
                        <span className={cn("text-xs font-semibold", order.isPaid ? "text-[#3F9D52]" : "text-muted-foreground")}>
                          {order.isPaid ? "Paid" : "Unpaid"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <button
                              type="button"
                              aria-label={`Actions for order ${order.orderNumber}`}
                              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                            >
                              <MoreVertical className="size-4" aria-hidden="true" />
                            </button>
                          }
                        />

                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setSelectedOrderId(order.id)}>
                            <Eye className="size-4" aria-hidden="true" />
                            View order
                          </DropdownMenuItem>
                          {canPrintKot && (
                            <DropdownMenuItem onClick={() => openKotWindow().commit(order.id)}>
                              <Printer className="size-4" aria-hidden="true" />
                              Print KOT
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={selectedOrder !== null} onOpenChange={(open) => !open && setSelectedOrderId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{selectedOrder ? `Order #${selectedOrder.orderNumber}` : "Order"}</SheetTitle>
          </SheetHeader>
          {selectedOrder && (
            <ul className="list-none px-4 pb-4">
              <OrderCard order={selectedOrder} canSettle={canSettle} canAdvance={canAdvance} canPrintKot={canPrintKot} canSeeCustomers={canSeeCustomers} />
            </ul>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
