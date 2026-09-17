"use client";

import { useMemo, useState } from "react";
import { ListFilter, Search } from "lucide-react";
import { DataTable, dataColumns, expandColumn } from "@/components/iq/data-table";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ORDER_CHANNEL_LABELS, type OrderChannel } from "@/domain/order-channel";
import type { OrderPaymentState } from "@/domain/order-payment-state";
import type { FulfilmentType, OrderStatus } from "@/domain/order-status";
import { formatINR, type Paise } from "@/lib/money";

/** A finished order as the page hands it over — dates as ISO strings, money as paise. */
export interface OrderHistoryEntry {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly fulfilment: FulfilmentType;
  readonly channel: OrderChannel;
  readonly customerName: string | null;
  readonly grandTotal: Paise;
  readonly isPaid: boolean;
  readonly paymentState: OrderPaymentState;
  readonly placedAt: string | null;
  readonly closedAt: string;
  readonly cancellationReason: string | null;
  readonly items: readonly { readonly name: string; readonly quantity: number; readonly modifiers: readonly string[]; readonly lineSubtotal: Paise }[];
}

const STATUS: Record<OrderStatus, { label: string; variant: "success" | "destructive" | "warning" | "secondary" }> = {
  COMPLETED: { label: "Completed", variant: "success" },
  CANCELLED: { label: "Cancelled", variant: "secondary" },
  FAILED: { label: "Failed", variant: "destructive" },
  REFUNDED: { label: "Refunded", variant: "warning" },
  // Not terminal — never in this table, but the map stays total so a new status cannot slip through unlabelled.
  DRAFT: { label: "Draft", variant: "secondary" },
  PENDING_PAYMENT: { label: "New", variant: "warning" },
  PAID: { label: "Paid", variant: "secondary" },
  ACCEPTED: { label: "Accepted", variant: "secondary" },
  PREPARING: { label: "Cooking", variant: "secondary" },
  READY: { label: "Ready", variant: "secondary" },
  OUT_FOR_DELIVERY: { label: "Out for delivery", variant: "secondary" },
};

const FULFILMENT: Record<FulfilmentType, string> = { DINE_IN: "Dine-in", TAKEAWAY: "Takeaway", DELIVERY: "Delivery" };

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** A paid order can still owe money back — REFUNDED and PARTIALLY_REFUNDED take priority over the plain paid/not-paid read. */
export function paymentLabel(order: Pick<OrderHistoryEntry, "isPaid" | "paymentState">): string {
  if (order.paymentState === "REFUNDED") return "Refunded";
  if (order.paymentState === "PARTIALLY_REFUNDED") return "Partly refunded";
  return order.isPaid ? "Paid" : "Not paid";
}

const column = dataColumns<OrderHistoryEntry>();

/**
 * Finished orders on the shared `DataTable`, with the purchased
 * `data-table2` expand pattern: the chevron (or the row) opens a detail row
 * showing the lines as they were sold — snapshot names, quantities and
 * line subtotals from `order_items`, never today's menu.
 */
export function OrderHistoryTable({ orders, periodLabel }: { orders: readonly OrderHistoryEntry[]; periodLabel: string }) {
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<ReadonlySet<OrderStatus>>(new Set());
  const [channels, setChannels] = useState<ReadonlySet<OrderChannel>>(new Set());

  const statusOptions = useMemo(() => {
    const counts = new Map<OrderStatus, number>();
    for (const order of orders) counts.set(order.status, (counts.get(order.status) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [orders]);
  const channelOptions = useMemo(() => {
    const counts = new Map<OrderChannel, number>();
    for (const order of orders) counts.set(order.channel, (counts.get(order.channel) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [orders]);

  const normalised = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      orders.filter((order) => {
        if (statuses.size > 0 && !statuses.has(order.status)) return false;
        if (channels.size > 0 && !channels.has(order.channel)) return false;
        if (normalised === "") return true;
        return order.orderNumber.toLowerCase().includes(normalised) || (order.customerName ?? "").toLowerCase().includes(normalised) || order.items.some((item) => item.name.toLowerCase().includes(normalised));
      }),
    [orders, statuses, channels, normalised],
  );

  const columns = useMemo(
    () =>
      column.columns([
        expandColumn<OrderHistoryEntry>(),
        column.accessor((row) => row.orderNumber, {
          id: "order",
          header: "Order",
          cell: ({ row }) => (
            <div className="flex flex-col gap-0.5">
              <span className="tabular font-semibold">#{row.original.orderNumber}</span>
              <span className="text-xs text-muted-foreground">
                {row.original.customerName ?? "Walk-in"} · {row.original.items.reduce((sum, item) => sum + item.quantity, 0)} items
              </span>
            </div>
          ),
        }),
        column.accessor((row) => row.status, {
          id: "status",
          header: "Status",
          enableSorting: false,
          cell: ({ row }) => <Badge variant={STATUS[row.original.status].variant}>{STATUS[row.original.status].label}</Badge>,
        }),
        column.accessor((row) => row.channel, {
          id: "channel",
          header: "Channel",
          meta: { className: "hidden md:table-cell" },
          cell: ({ row }) => (
            <span className="text-muted-foreground">
              {ORDER_CHANNEL_LABELS[row.original.channel]} · {FULFILMENT[row.original.fulfilment]}
            </span>
          ),
        }),
        column.accessor((row) => new Date(row.closedAt).getTime(), {
          id: "closed",
          header: "Closed",
          meta: { className: "hidden sm:table-cell" },
          cell: ({ row }) => <span className="tabular text-muted-foreground">{formatWhen(row.original.closedAt)}</span>,
        }),
        column.accessor((row) => Number(row.grandTotal), {
          id: "total",
          header: "Total",
          meta: { align: "right" },
          cell: ({ row }) => (
            <div className="flex flex-col items-end gap-0.5">
              <span className="tabular font-semibold">{formatINR(row.original.grandTotal)}</span>
              <span className="text-xs text-muted-foreground">{paymentLabel(row.original)}</span>
            </div>
          ),
        }),
      ]),
    [],
  );

  if (orders.length === 0) {
    return <EmptyState title={`No finished orders ${periodLabel.toLowerCase()}`} detail="Completed, cancelled, failed and refunded orders appear here once the live board is done with them. Try a wider period." />;
  }

  const activeFilters = statuses.size + channels.size;
  const toggle = <K,>(set: ReadonlySet<K>, key: K): ReadonlySet<K> => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Order number, customer or item" aria-label="Search order history" className="h-9 pl-8" />
        </div>
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <ListFilter data-icon="inline-start" aria-hidden="true" />
                Filter
                {activeFilters > 0 && <span className="tabular flex size-5 items-center justify-center rounded-full bg-inverse text-[11px] font-semibold text-inverse-foreground">{activeFilters}</span>}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Status</DropdownMenuLabel>
              {statusOptions.map(([status, count]) => (
                <DropdownMenuCheckboxItem key={status} checked={statuses.has(status)} onCheckedChange={() => setStatuses((current) => toggle(current, status))}>
                  {STATUS[status].label} <span className="tabular ml-auto text-xs text-muted-foreground">{count}</span>
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Channel</DropdownMenuLabel>
              {channelOptions.map(([channel, count]) => (
                <DropdownMenuCheckboxItem key={channel} checked={channels.has(channel)} onCheckedChange={() => setChannels((current) => toggle(current, channel))}>
                  {ORDER_CHANNEL_LABELS[channel]} <span className="tabular ml-auto text-xs text-muted-foreground">{count}</span>
                </DropdownMenuCheckboxItem>
              ))}
              {activeFilters > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      setStatuses(new Set());
                      setChannels(new Set());
                    }}
                  >
                    Clear filters
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        rowKey={(row) => row.id}
        initialSorting={[{ id: "closed", desc: true }]}
        noun="orders"
        totalCount={orders.length}
        empty={<span>No orders match. Clear the search or filters.</span>}
        renderExpanded={(order) => (
          <div className="grid gap-3 px-4 py-4 text-[13px] sm:px-14">
            <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-muted-foreground">Placed</dt>
              <dd className="tabular">{order.placedAt ? formatWhen(order.placedAt) : "—"}</dd>
              <dt className="text-muted-foreground">Closed</dt>
              <dd className="tabular">{formatWhen(order.closedAt)}</dd>
              <dt className="text-muted-foreground">Handover</dt>
              <dd>
                {ORDER_CHANNEL_LABELS[order.channel]} · {FULFILMENT[order.fulfilment]}
              </dd>
              {order.cancellationReason && (
                <>
                  <dt className="text-muted-foreground">Reason</dt>
                  <dd>{order.cancellationReason}</dd>
                </>
              )}
            </dl>
            <div className="rounded-lg border border-border bg-panel">
              <ul className="divide-y divide-border">
                {order.items.map((item, index) => (
                  <li key={`${order.id}-${index}`} className="flex items-start justify-between gap-4 px-3 py-2">
                    <div className="min-w-0">
                      <span className="font-medium">{item.name}</span>
                      {item.modifiers.length > 0 && <p className="text-xs text-muted-foreground">{item.modifiers.join(", ")}</p>}
                    </div>
                    <div className="flex shrink-0 items-baseline gap-3 text-right">
                      <span className="tabular text-xs text-muted-foreground">× {item.quantity}</span>
                      <span className="tabular font-medium">{formatINR(item.lineSubtotal)}</span>
                    </div>
                  </li>
                ))}
                {order.items.length === 0 && <li className="px-3 py-2 text-muted-foreground">No lines were stored for this order.</li>}
              </ul>
              <div className="flex items-center justify-between gap-4 border-t border-border px-3 py-2 font-semibold">
                <span>Total · {paymentLabel(order).toLowerCase()}</span>
                <span className="tabular">{formatINR(order.grandTotal)}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Line amounts are before discount and GST, as stored at the time of sale; the total is what the customer paid.</p>
          </div>
        )}
      />
    </div>
  );
}
