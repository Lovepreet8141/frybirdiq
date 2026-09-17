"use client";

import { type ReactNode, useMemo, useState } from "react";
import {
  type SortingState,
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  flexRender,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Download, ListFilter, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/states";
import { RefundDialog } from "@/components/staff/refund-dialog";
import { ORDER_CHANNEL_LABELS, type OrderChannel } from "@/domain/order-channel";
import { METHOD_LABELS, type PaymentMethod, type PaymentStatus, STATUS_LABELS, paymentsCsv } from "@/lib/finance/ledger-view";
import { type RefundBadgeKind, paymentRefundBadges } from "@/lib/finance/refunds";
import { type Paise, ZERO, add, formatINR, subtract } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface PaymentRowView {
  readonly id: string;
  readonly orderNumber: string;
  readonly channel: OrderChannel;
  readonly status: PaymentStatus;
  readonly method: PaymentMethod;
  readonly provider: string;
  readonly providerPaymentId: string | null;
  readonly amount: Paise;
  readonly feeAmount: Paise;
  readonly capturedBy: string | null;
  readonly at: string;
  readonly refunded: Paise;
  /** Held by refunds still in progress (RESERVED): not returned yet, but not refundable again either. */
  readonly refundReserved: Paise;
  readonly refundStuck: boolean;
  readonly refundFailedCount: number;
}

const REFUND_BADGE_VARIANT: Record<RefundBadgeKind, "warning" | "destructive" | "outline"> = { in_progress: "warning", stuck: "destructive", failed: "outline" };

/** The payment's status, then any refund not simply done: in progress or stuck (money held), and failed attempts. Words, never colour alone. */
function PaymentStatusBadges({ row }: { row: PaymentRowView }) {
  const badges = paymentRefundBadges({ reserved: row.refundReserved, stuck: row.refundStuck, failedCount: row.refundFailedCount });
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABELS[row.status]}</Badge>
      {badges.map((badge) => {
        const held = formatINR(row.refundReserved);
        const detail = badge.showsHeldAmount ? `${badge.description}: ${held}` : badge.description;
        return (
          // The held amount is in the visible words; title and aria-label add the full sentence.
          <Badge key={badge.kind} variant={REFUND_BADGE_VARIANT[badge.kind]} aria-label={detail} title={detail}>
            {badge.showsHeldAmount ? `${badge.label} · ${held}` : badge.label}
          </Badge>
        );
      })}
    </span>
  );
}

const STATUS_VARIANT: Record<PaymentStatus, "success" | "warning" | "destructive" | "outline"> = {
  CAPTURED: "success",
  PENDING: "warning",
  AUTHORIZED: "warning",
  FAILED: "destructive",
  REFUNDED: "outline",
  PARTIALLY_REFUNDED: "outline",
};

const STATUS_FILTERS: readonly PaymentStatus[] = ["CAPTURED", "PENDING", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"];
const PAGE_SIZES = [10, 20, 50] as const;

const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  columnMeta: {} as { align?: "right"; className?: string },
});
const column = createColumnHelper<typeof features, PaymentRowView>();

function pageNumbers(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  if (current <= 3 || current >= total - 2) return [1, 2, 3, "ellipsis", total - 2, total - 1, total];
  return [1, "ellipsis", current - 1, current, current + 1, "ellipsis", total];
}

function when(iso: string, style: "short" | "full" = "short"): string {
  const date = new Date(iso);
  return style === "full"
    ? date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })
    : date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** What can still go back: captured, less what went back, less what refunds in progress hold. */
function leftToRefund(row: PaymentRowView): Paise {
  return subtract(row.amount, add(row.refunded, row.refundReserved));
}

function refundable(row: PaymentRowView): boolean {
  return (row.status === "CAPTURED" || row.status === "PARTIALLY_REFUNDED") && leftToRefund(row) > ZERO;
}

/**
 * The payments ledger on the purchased `tables10` / `tables12` mechanics —
 * a checkbox filter menu (method and status, the way `tables10` filters
 * by category), sortable amount and time, page-size select, numbered
 * pagination and CSV export — with `tables16`'s per-payment detail moved
 * into a Sheet rather than its `min-w-[1250px]` row. Every figure is the
 * server's; this only slices, sorts and shows the rows it was given, and
 * the one action (Refund) opens the existing `RefundDialog`.
 */
export function PaymentsTable({ payments, periodLabel, canRefund, canExport }: { payments: readonly PaymentRowView[]; periodLabel: string; canRefund: boolean; canExport: boolean }) {
  const [search, setSearch] = useState("");
  const [methods, setMethods] = useState<ReadonlySet<PaymentMethod>>(new Set());
  const [statuses, setStatuses] = useState<ReadonlySet<PaymentStatus>>(new Set());
  const [sorting, setSorting] = useState<SortingState>([{ id: "at", desc: true }]);
  const [selected, setSelected] = useState<PaymentRowView | null>(null);
  const [refunding, setRefunding] = useState<PaymentRowView | null>(null);

  const presentMethods = useMemo(() => {
    const counts = new Map<PaymentMethod, number>();
    for (const row of payments) counts.set(row.method, (counts.get(row.method) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [payments]);

  const normalised = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      payments.filter((row) => {
        if (methods.size > 0 && !methods.has(row.method)) return false;
        if (statuses.size > 0 && !statuses.has(row.status)) return false;
        if (normalised === "") return true;
        return row.orderNumber.toLowerCase().includes(normalised) || (row.capturedBy ?? "").toLowerCase().includes(normalised) || (row.providerPaymentId ?? "").toLowerCase().includes(normalised);
      }),
    [payments, methods, statuses, normalised],
  );

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor((row) => Number(row.orderNumber) || row.orderNumber, {
          id: "order",
          header: "Order",
          cell: ({ row }) => (
            <div className="flex flex-col gap-0.5">
              <span className="tabular font-semibold">#{row.original.orderNumber}</span>
              <span className="text-xs text-muted-foreground">{ORDER_CHANNEL_LABELS[row.original.channel]}</span>
            </div>
          ),
        }),
        column.accessor((row) => row.method, {
          id: "method",
          header: "Method",
          enableSorting: false,
          cell: ({ row }) => <Badge variant="outline">{METHOD_LABELS[row.original.method]}</Badge>,
        }),
        column.accessor((row) => row.status, {
          id: "status",
          header: "Status",
          enableSorting: false,
          cell: ({ row }) => <PaymentStatusBadges row={row.original} />,
        }),
        column.accessor((row) => row.capturedBy ?? "", {
          id: "by",
          header: "Taken by",
          enableSorting: false,
          meta: { className: "hidden md:table-cell" },
          cell: ({ row }) => <span className="text-muted-foreground">{row.original.capturedBy ?? "—"}</span>,
        }),
        column.accessor((row) => Number(row.feeAmount), {
          id: "fee",
          header: "Fee",
          meta: { align: "right", className: "hidden lg:table-cell" },
          cell: ({ row }) => <span className="tabular text-muted-foreground">{row.original.feeAmount === 0n ? "—" : formatINR(row.original.feeAmount)}</span>,
        }),
        column.accessor((row) => Number(row.amount), {
          id: "amount",
          header: "Amount",
          meta: { align: "right" },
          cell: ({ row }) => <span className="tabular font-semibold">{formatINR(row.original.amount)}</span>,
        }),
        column.accessor((row) => new Date(row.at).getTime(), {
          id: "at",
          header: "When",
          meta: { align: "right", className: "hidden sm:table-cell" },
          cell: ({ row }) => <span className="tabular text-muted-foreground">{when(row.original.at)}</span>,
        }),
      ]),
    [],
  );

  const table = useTable({
    features,
    columns,
    data: rows,
    state: { sorting },
    onSortingChange: setSorting,
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
    autoResetPageIndex: true,
  });

  const { pageIndex, pageSize } = table.state.pagination;
  const currentPage = pageIndex + 1;
  const pageCount = Math.max(1, table.getPageCount());
  const first = rows.length === 0 ? 0 : pageIndex * pageSize + 1;
  const last = Math.min(rows.length, (pageIndex + 1) * pageSize);
  const activeFilters = methods.size + statuses.size;

  const toggle = <T,>(set: ReadonlySet<T>, key: T): ReadonlySet<T> => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  const exportCsv = () => {
    const csv = paymentsCsv(table.getSortedRowModel().rows.map(({ original: row }) => ({ ...row, channel: ORDER_CHANNEL_LABELS[row.channel], at: new Date(row.at) })));
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (payments.length === 0) {
    return <EmptyState title={`No payments ${periodLabel.toLowerCase()}`} detail="A payment appears here the moment it is taken at the counter, by a rider, or online. Try a wider period." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Order number, who took it, reference" aria-label="Search payments" className="h-9 pl-8" />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <ListFilter data-icon="inline-start" aria-hidden="true" />
                Filter
                {activeFilters > 0 && <span className="tabular flex size-5 items-center justify-center rounded-full bg-inverse text-[11px] font-semibold text-inverse-foreground">{activeFilters}</span>}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Method</DropdownMenuLabel>
              {presentMethods.map(([method, count]) => (
                <DropdownMenuCheckboxItem key={method} checked={methods.has(method)} onCheckedChange={() => setMethods((current) => toggle(current, method))}>
                  {METHOD_LABELS[method]} <span className="tabular ml-auto text-xs text-muted-foreground">{count}</span>
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Status</DropdownMenuLabel>
              {STATUS_FILTERS.map((status) => (
                <DropdownMenuCheckboxItem key={status} checked={statuses.has(status)} onCheckedChange={() => setStatuses((current) => toggle(current, status))}>
                  {STATUS_LABELS[status]}
                </DropdownMenuCheckboxItem>
              ))}
              {activeFilters > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      setMethods(new Set());
                      setStatuses(new Set());
                    }}
                  >
                    Clear filters
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Select value={String(pageSize)} onValueChange={(value) => table.setPageSize(Number(value))}>
            <SelectTrigger size="sm" className="w-[88px]" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} rows
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {canExport && (
            <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
              <Download data-icon="inline-start" aria-hidden="true" />
              <span className="hidden sm:inline">Export</span>
              <span className="sr-only sm:hidden">Export CSV</span>
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-panel">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead key={header.id} className={cn(meta?.align === "right" && "text-right", meta?.className)} aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}>
                      {header.column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn("inline-flex min-h-[32px] items-center gap-1 rounded-sm hover:text-foreground", meta?.align === "right" && "flex-row-reverse", sorted && "text-foreground")}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" ? <ArrowUp className="size-3.5" aria-hidden="true" /> : sorted === "desc" ? <ArrowDown className="size-3.5" aria-hidden="true" /> : <ChevronsUpDown className="size-3.5 text-muted-foreground/70" aria-hidden="true" />}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-28 whitespace-normal text-center text-muted-foreground">
                  <p>No payments match{normalised ? ` “${search.trim()}”` : ""}.</p>
                  <Button
                    variant="link"
                    className="mt-1 h-auto p-0 text-[13px]"
                    onClick={() => {
                      setSearch("");
                      setMethods(new Set());
                      setStatuses(new Set());
                    }}
                  >
                    Clear search and filters
                  </Button>
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.original.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`Payment for order ${row.original.orderNumber}, ${formatINR(row.original.amount)}`}
                  onClick={() => setSelected(row.original)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelected(row.original);
                    }
                  }}
                  className="cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-none"
                >
                  {row.getAllCells().map((cell) => {
                    const meta = cell.column.columnDef.meta;
                    return (
                      <TableCell key={cell.id} className={cn(meta?.align === "right" && "text-right", meta?.className)}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <p className="tabular text-[13px] text-muted-foreground">
            {rows.length === 0 ? "0 payments" : `${first}–${last} of ${rows.length}`}
            {rows.length !== payments.length && ` · ${payments.length} in the period`}
          </p>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              <ChevronLeft data-icon="inline-start" aria-hidden="true" />
              <span className="hidden sm:inline">Previous</span>
            </Button>
            {pageNumbers(currentPage, pageCount).map((page, index) =>
              page === "ellipsis" ? (
                <span key={`ellipsis-${index}`} className="px-1.5 text-muted-foreground">
                  …
                </span>
              ) : (
                <Button key={page} variant={currentPage === page ? "inverse" : "ghost"} size="icon-sm" className="tabular" onClick={() => table.setPageIndex(page - 1)} aria-current={currentPage === page ? "page" : undefined} aria-label={`Page ${page}`}>
                  {page}
                </Button>
              ),
            )}
            <Button variant="ghost" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              <span className="hidden sm:inline">Next</span>
              <ChevronRight data-icon="inline-end" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      <PaymentSheet
        payment={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        canRefund={canRefund}
        onRefund={(row) => {
          setSelected(null);
          setRefunding(row);
        }}
      />
      <RefundDialog
        open={refunding !== null}
        onOpenChange={(open) => {
          if (!open) setRefunding(null);
        }}
        // The dialog's cap is amount − refunded: a refund in progress holds its share, so it counts here.
        payment={refunding ? { id: refunding.id, orderNumber: refunding.orderNumber, amount: refunding.amount, refunded: add(refunding.refunded, refunding.refundReserved), provider: refunding.provider, method: refunding.method } : null}
      />
    </div>
  );
}

function Row({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className={cn("text-right text-[13px] font-medium", mono && "font-mono text-[12px] tracking-[0.02em]")}>{children}</dd>
    </div>
  );
}

/** One payment, every field the ledger holds for it. `tables16` puts these inline in a very wide row; on a tablet they belong in a sheet. */
function PaymentSheet({ payment, onOpenChange, canRefund, onRefund }: { payment: PaymentRowView | null; onOpenChange: (open: boolean) => void; canRefund: boolean; onRefund: (row: PaymentRowView) => void }) {
  return (
    <Sheet open={payment !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto">
        {payment && (
          <>
            <SheetHeader>
              <SheetTitle className="tabular font-heading">Order #{payment.orderNumber}</SheetTitle>
              <SheetDescription>
                {ORDER_CHANNEL_LABELS[payment.channel]} · {when(payment.at, "full")}
              </SheetDescription>
            </SheetHeader>

            <div className="px-4">
              <p className="tabular font-money text-[34px] leading-none tracking-[-0.01em]">{formatINR(payment.amount)}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <PaymentStatusBadges row={payment} />
                <Badge variant="outline">{METHOD_LABELS[payment.method]}</Badge>
              </div>

              <dl className="mt-5 flex flex-col divide-y divide-border border-y border-border">
                <Row label="Provider">{payment.provider}</Row>
                <Row label="Reference" mono>
                  {payment.providerPaymentId ?? "—"}
                </Row>
                <Row label="Provider fee">{payment.feeAmount === 0n ? "—" : formatINR(payment.feeAmount)}</Row>
                <Row label="Refunded so far">{payment.refunded === 0n ? "—" : formatINR(payment.refunded)}</Row>
                {payment.refundReserved > 0n && <Row label="Refund in progress">{formatINR(payment.refundReserved)}</Row>}
                {refundable(payment) && <Row label="Left to refund">{formatINR(leftToRefund(payment))}</Row>}
                <Row label="Taken by">{payment.capturedBy ?? "—"}</Row>
                <Row label="At">{when(payment.at, "full")}</Row>
              </dl>

              {canRefund && refundable(payment) && (
                <Button variant="outline" className="mt-5 w-full" onClick={() => onRefund(payment)}>
                  Refund this payment
                </Button>
              )}
              {!canRefund && refundable(payment) && <p className="mt-5 text-[12.5px] text-muted-foreground">Refunding needs the orders.refund permission.</p>}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
