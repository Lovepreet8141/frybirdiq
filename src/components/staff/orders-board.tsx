"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bike, Eye, Globe, Loader2, MoreHorizontal, Printer, Search, ShoppingBag, Utensils, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { OrderStatus } from "@/domain/order-status";
import { advanceOrderAction } from "@/lib/auth/staff-actions";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import { OrderCard, type StaffOrder, nextStep, statusLabel } from "@/components/staff/order-card";
import { openKotWindow } from "@/components/staff/print-kot";

/**
 * The orders list as a card-row board — the "Frybird Orders v2" design,
 * built on FRYBIRD's real states and actions.
 *
 * What it owns: slicing, sorting and presenting the `orders` array the page
 * already fetched. What it does not own: any order logic. The next-step
 * button asks `advanceOrderAction` for the one transition `nextStep` names,
 * and the server decides whether the move is legal (`assertTransition`);
 * the ⋯ menu and the row click open the same sheet and `OrderCard` as
 * before, so every action still has exactly one implementation.
 *
 * Colour is only ever a token utility (MASTER.md §5 "Order tints"). Type
 * and status tints are looked up from literal class strings so Tailwind can
 * see them.
 */

type OrderType = "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "ONLINE";

/**
 * Where the food is going, and — for a collection — where the order came
 * from. Delivery is delivery whoever placed it; dine-in is a table; a
 * collection rung up at the counter is TAKEAWAY and one placed on the
 * website is ONLINE, because the counter handles those two differently.
 */
function orderType(order: StaffOrder): OrderType {
  if (order.fulfilment === "DELIVERY") return "DELIVERY";
  if (order.fulfilment === "DINE_IN") return "DINE_IN";
  return order.channel === "ONLINE" ? "ONLINE" : "TAKEAWAY";
}

const TYPES: readonly OrderType[] = ["DINE_IN", "TAKEAWAY", "DELIVERY", "ONLINE"];

const TYPE: Record<OrderType, { label: string; icon: LucideIcon; rail: string; swatch: string }> = {
  DINE_IN: { label: "Dine-in", icon: Utensils, rail: "bg-type-dine-in text-type-dine-in-fg border-type-dine-in-line", swatch: "bg-type-dine-in-swatch" },
  TAKEAWAY: { label: "Takeaway", icon: ShoppingBag, rail: "bg-type-takeaway text-type-takeaway-fg border-type-takeaway-line", swatch: "bg-type-takeaway-swatch" },
  DELIVERY: { label: "Delivery", icon: Bike, rail: "bg-type-delivery text-type-delivery-fg border-type-delivery-line", swatch: "bg-type-delivery-swatch" },
  ONLINE: { label: "Online", icon: Globe, rail: "bg-type-online text-type-online-fg border-type-online-line", swatch: "bg-type-online-swatch" },
};

/** The five tints. PENDING_PAYMENT and PAID are both "new" to the counter: nobody has accepted them yet. */
type StatusKey = "new" | "accepted" | "cooking" | "ready" | "outForDelivery";

function statusKey(status: OrderStatus): StatusKey {
  switch (status) {
    case "ACCEPTED":
      return "accepted";
    case "PREPARING":
      return "cooking";
    case "READY":
      return "ready";
    case "OUT_FOR_DELIVERY":
      return "outForDelivery";
    default:
      return "new";
  }
}

const STATUS: Record<StatusKey, { pill: string; dot: string }> = {
  new: { pill: "bg-status-new text-status-new-fg", dot: "bg-status-new-dot" },
  accepted: { pill: "bg-status-accepted text-status-accepted-fg", dot: "bg-status-accepted-dot" },
  cooking: { pill: "bg-status-cooking text-status-cooking-fg", dot: "bg-status-cooking-dot" },
  ready: { pill: "bg-status-ready text-status-ready-fg", dot: "bg-status-ready-dot" },
  outForDelivery: { pill: "bg-status-out-for-delivery text-status-out-for-delivery-fg", dot: "bg-status-out-for-delivery-dot" },
};

/** Every non-terminal status a tab can filter on, in the order a ticket moves. */
const STATUS_TABS: readonly { status: OrderStatus; label: string }[] = [
  { status: "PENDING_PAYMENT", label: "New" },
  { status: "PAID", label: "Paid" },
  { status: "ACCEPTED", label: "Accepted" },
  { status: "PREPARING", label: "Cooking" },
  { status: "READY", label: "Ready" },
  { status: "OUT_FOR_DELIVERY", label: "Out for delivery" },
];

/** "Due soon" is the spec's threshold: promised within 15 minutes, or already late. */
const SOON_MINUTES = 15;

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
}

/**
 * The clock the due column reads against. Quantised to half a minute so the
 * snapshot is stable between ticks (a getSnapshot that changed on every
 * call would re-render forever), and the server's value is used for the
 * first client render so hydration matches.
 */
const TICK_MS = 30_000;
function subscribeToClock(onTick: () => void) {
  const timer = setInterval(onTick, TICK_MS);
  return () => clearInterval(timer);
}
function useNow(serverNow: number): number {
  return useSyncExternalStore(
    subscribeToClock,
    () => Math.floor(Date.now() / TICK_MS) * TICK_MS,
    () => serverNow,
  );
}

interface Due {
  /** Minutes until promised; negative when late; null when no time was promised. */
  readonly minutes: number | null;
  readonly late: boolean;
  readonly soon: boolean;
  readonly label: string;
  readonly by: string | null;
}

function dueFor(order: StaffOrder, now: number): Due {
  if (!order.estimatedReadyAt) return { minutes: null, late: false, soon: false, label: "No time", by: null };
  const minutes = Math.round((new Date(order.estimatedReadyAt).getTime() - now) / 60_000);
  const late = minutes < 0;
  return {
    minutes,
    late,
    soon: !late && minutes <= SOON_MINUTES,
    label: late ? `${-minutes} min late` : minutes === 0 ? "Due now" : `${minutes} min`,
    by: formatClock(order.estimatedReadyAt),
  };
}

function itemsPreview(order: StaffOrder): { first: string; count: string } {
  const first = order.items[0];
  const name = first ? `${first.quantity > 1 ? `${first.quantity}× ` : ""}${first.name}` : "No items";
  const more = order.items.length - 1;
  return {
    first: more > 0 ? `${name} +${more} more` : name,
    count: order.items.length === 1 ? "1 item" : `${order.items.length} items`,
  };
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function StatusPill({ status, fulfilment }: { status: OrderStatus; fulfilment: StaffOrder["fulfilment"] }) {
  const tint = STATUS[statusKey(status)];
  return (
    <Badge className={cn("h-7 gap-[7px] px-[11px] text-xs font-semibold", tint.pill)}>
      <span className={cn("size-[7px] rounded-full", tint.dot)} aria-hidden="true" />
      {statusLabel(status, fulfilment)}
    </Badge>
  );
}

function PayChip({ paid }: { paid: boolean }) {
  return (
    <span
      className={cn(
        "rounded-[4px] px-[7px] py-px text-[11px] font-semibold",
        paid ? "bg-status-ready text-status-ready-fg" : "bg-surface-muted text-muted-foreground",
      )}
    >
      {paid ? "Paid" : "Unpaid"}
    </span>
  );
}

function DueCell({ due, align = "start" }: { due: Due; align?: "start" | "end" }) {
  return (
    <div className={cn("flex flex-col gap-[3px]", align === "end" && "items-end")}>
      <span
        className={cn(
          "tabular whitespace-nowrap text-[15px] font-bold",
          due.minutes === null ? "text-muted-foreground" : due.late ? "text-destructive" : due.soon ? "text-warning" : "text-foreground",
        )}
      >
        {due.label}
      </span>
      <span className="tabular whitespace-nowrap text-xs text-muted-foreground">{due.by ? `by ${due.by}` : "not promised"}</span>
    </div>
  );
}

function TypeRail({ order, layout }: { order: StaffOrder; layout: "rail" | "strip" }) {
  const type = orderType(order);
  const spec = TYPE[type];
  // Where it came from: the table for dine-in, "Till" for a counter order
  // without one, "Website" for online. A delivery is always online.
  const sub = type === "DINE_IN" ? (order.tableName ?? "Till") : type === "TAKEAWAY" ? "Till" : type === "ONLINE" ? "Website" : null;
  return (
    <div
      className={cn(
        spec.rail,
        layout === "rail"
          ? "flex h-full flex-col items-center justify-center gap-[5px] self-stretch border-r px-1"
          : "flex items-center gap-2 border-b px-3 py-1.5",
      )}
    >
      <spec.icon className={layout === "rail" ? "size-6" : "size-4"} strokeWidth={1.8} aria-hidden="true" />
      <span className="text-[11px] font-bold uppercase tracking-[0.06em]">{spec.label}</span>
      {sub && <span className={cn("rounded-full bg-background/70 px-[7px] py-px text-xs font-semibold", layout === "strip" && "ml-auto")}>{sub}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One order                                                           */
/* ------------------------------------------------------------------ */

function OrderRow({
  order,
  due,
  columns,
  minHeight,
  canAdvance,
  canPrintKot,
  onOpen,
}: {
  order: StaffOrder;
  due: Due;
  columns: string;
  minHeight: string;
  canAdvance: boolean;
  canPrintKot: boolean;
  onOpen: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const next = nextStep(order.status, order.fulfilment);
  const isDelivery = order.fulfilment === "DELIVERY";
  /** Handing over an unpaid order is giving food away — the server refuses it; say so before the press. */
  const blockedByPayment = !order.isPaid && next?.to === "COMPLETED";
  const preview = itemsPreview(order);

  const run = (work: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await work();
      if (!result.ok) setError(result.error ?? "That didn't work.");
      router.refresh();
    });

  /** Accepting is when the kitchen needs paper: the KOT window opens in the same tick as the tap (see OrderCard). */
  const advance = () => {
    if (!next) return;
    if (next.to === "ACCEPTED") {
      const kot = openKotWindow();
      run(async () => {
        const result = await advanceOrderAction({ orderId: order.id, to: "ACCEPTED" });
        if (result.ok) kot.commit(order.id);
        else kot.cancel();
        return result;
      });
      return;
    }
    run(() => advanceOrderAction({ orderId: order.id, to: next.to }));
  };

  const action = next && canAdvance && (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending || blockedByPayment}
      title={blockedByPayment ? (isDelivery ? "Record the cash from the rider first." : "Take payment before handing this over.") : undefined}
      onClick={(event) => {
        event.stopPropagation();
        advance();
      }}
      className={cn(
        "h-[34px] rounded-[9px] px-3 text-[13px] font-semibold whitespace-nowrap md:w-[120px]",
        next.to === "ACCEPTED" && "border-foreground bg-foreground text-background hover:bg-foreground/90 hover:text-background",
      )}
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : next.label}
    </Button>
  );

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={`More for order ${order.orderNumber}`}
          onClick={(event) => event.stopPropagation()}
          className="size-[34px] rounded-[9px] text-muted-foreground hover:border hover:border-border hover:bg-surface-muted"
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onClick={onOpen}>
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
  );

  const shell = cn(
    "cursor-pointer overflow-hidden rounded-[14px] border bg-surface shadow-xs transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    due.late ? "border-order-late-line" : "border-border",
  );

  return (
    <li className="list-none">
      {/* Desktop: one grid row. The rail spans the full row height. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
        className={cn(shell, "hidden items-center gap-3 pr-4 md:grid", minHeight)}
        style={{ gridTemplateColumns: columns }}
      >
        <TypeRail order={order} layout="rail" />
        <div className="flex min-w-0 flex-col gap-[3px]">
          <div className="flex items-baseline gap-2">
            <span className="tabular text-base font-bold">#{order.orderNumber}</span>
            <span className="truncate text-sm font-medium">{order.customerName ?? "Walk-in"}</span>
          </div>
          <span className="tabular text-xs text-muted-foreground">{order.customerPhone ?? "No phone on file"}</span>
        </div>
        <div className="flex min-w-0 flex-col gap-[3px]">
          <span className="truncate text-sm">{preview.first}</span>
          <span className="text-xs text-muted-foreground">{preview.count}</span>
        </div>
        <div>
          <StatusPill status={order.status} fulfilment={order.fulfilment} />
        </div>
        <DueCell due={due} />
        <div className="flex flex-col items-end gap-[3px]">
          <span className="tabular text-base font-bold">{formatINR(order.grandTotal)}</span>
          <PayChip paid={order.isPaid} />
        </div>
        <div className="flex items-center justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
          {action}
          {menu}
        </div>
      </div>

      {/* Phone: a stacked card. The rail becomes a strip across the top. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
        className={cn(shell, "md:hidden")}
      >
        <TypeRail order={order} layout="strip" />
        <div className="flex flex-col gap-2.5 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-[3px]">
              <div className="flex items-baseline gap-2">
                <span className="tabular text-base font-bold">#{order.orderNumber}</span>
                <span className="truncate text-sm font-medium">{order.customerName ?? "Walk-in"}</span>
              </div>
              <span className="tabular text-xs text-muted-foreground">{order.customerPhone ?? "No phone on file"}</span>
            </div>
            <StatusPill status={order.status} fulfilment={order.fulfilment} />
          </div>
          <div className="flex flex-col gap-[3px]">
            <span className="truncate text-sm">{preview.first}</span>
            <span className="text-xs text-muted-foreground">{preview.count}</span>
          </div>
          <div className="flex items-end justify-between gap-2">
            <DueCell due={due} />
            <div className="flex flex-col items-end gap-[3px]">
              <span className="tabular text-base font-bold">{formatINR(order.grandTotal)}</span>
              <PayChip paid={order.isPaid} />
            </div>
          </div>
          {(action || menu) && (
            <div className="flex items-center gap-2 [&>button:first-child:not(:only-child)]:min-h-[44px] [&>button:first-child:not(:only-child)]:flex-1" onClick={(event) => event.stopPropagation()}>
              {action}
              {menu}
            </div>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="px-4 pt-1.5 text-sm text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* The board                                                           */
/* ------------------------------------------------------------------ */

export function OrdersBoard({
  orders,
  nowMs,
  canSettle,
  canAdvance,
  canPrintKot,
  canSeeCustomers = false,
  initialSelectedId = null,
  density = "comfortable",
}: {
  orders: readonly StaffOrder[];
  /** The server's clock when the list was fetched; the client ticks on from it. */
  nowMs: number;
  canSettle: boolean;
  canAdvance: boolean;
  canPrintKot: boolean;
  canSeeCustomers?: boolean;
  /** An order to open on arrival — how Live operations and Activity deep-link into this screen. */
  initialSelectedId?: string | null;
  /** Row height. The spec's compact variant exists for a busier counter; there is no toggle for it yet. */
  density?: "comfortable" | "compact";
}) {
  const now = useNow(nowMs);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [typeFilter, setTypeFilter] = useState<OrderType | "all">("all");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(initialSelectedId);

  const dues = useMemo(() => new Map(orders.map((order) => [order.id, dueFor(order, now)])), [orders, now]);
  const statusCounts = useMemo(() => {
    const map = new Map<OrderStatus, number>();
    for (const order of orders) map.set(order.status, (map.get(order.status) ?? 0) + 1);
    return map;
  }, [orders]);
  const typeCounts = useMemo(() => {
    const map = new Map<OrderType, number>();
    for (const order of orders) {
      const type = orderType(order);
      map.set(type, (map.get(type) ?? 0) + 1);
    }
    return map;
  }, [orders]);
  const dueSoon = useMemo(() => orders.filter((order) => (dues.get(order.id)?.minutes ?? Infinity) <= SOON_MINUTES).length, [orders, dues]);

  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      orders
        .filter((order) => statusFilter === "all" || order.status === statusFilter)
        .filter((order) => typeFilter === "all" || orderType(order) === typeFilter)
        .filter(
          (order) =>
            q === "" ||
            order.orderNumber.toLowerCase().includes(q) ||
            (order.customerName ?? "").toLowerCase().includes(q) ||
            (order.customerPhone ?? "").includes(q) ||
            (order.tableName ?? "").toLowerCase().includes(q),
        )
        // Soonest due first, so the top of the list is what needs attention; unpromised orders last.
        .sort((a, b) => (dues.get(a.id)?.minutes ?? Infinity) - (dues.get(b.id)?.minutes ?? Infinity)),
    [orders, statusFilter, typeFilter, q, dues],
  );

  // Looked up fresh from `orders` on every render — a status change calls
  // `router.refresh()`, the page re-fetches, and the sheet must show the new
  // status or close itself if the order left the active list.
  const selectedOrder = selectedOrderId ? (orders.find((order) => order.id === selectedOrderId) ?? null) : null;

  const columns = `92px minmax(170px,1.4fr) minmax(140px,1.2fr) 134px 84px 76px ${canAdvance ? "164px" : "44px"}`;
  const minHeight = density === "compact" ? "min-h-16" : "min-h-[84px]";

  return (
    <div className="flex flex-col gap-[22px]">
      {/* Title row */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-baseline gap-3.5">
          <h1 className="font-heading text-xl font-bold tracking-tight lg:text-2xl">Orders</h1>
          <p className="flex items-center gap-2 whitespace-nowrap text-[13px] text-muted-foreground" aria-live="polite">
            <span className="inline-block size-[7px] rounded-full bg-success" aria-hidden="true" />
            <span className="tabular">{orders.length} open</span>
            <span aria-hidden="true">·</span>
            <span className={cn("tabular font-medium", dueSoon > 0 && "text-warning")}>{dueSoon} due soon</span>
          </p>
        </div>
        <div className="relative w-[300px] max-w-full">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Order #, name, phone or table"
            aria-label="Search orders"
            className="h-10 rounded-[10px] bg-surface pl-10"
          />
        </div>
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter by status">
          {[{ status: "all" as const, label: "All", count: orders.length }, ...STATUS_TABS.map((tab) => ({ ...tab, count: statusCounts.get(tab.status) ?? 0 }))]
            .filter((tab) => tab.status === "all" || tab.count > 0 || statusFilter === tab.status)
            .map((tab) => {
              const active = statusFilter === tab.status;
              return (
                <button
                  key={tab.status}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setStatusFilter(tab.status)}
                  className={cn(
                    "inline-flex h-[34px] items-center gap-[7px] rounded-full border px-3 text-[13px] font-medium transition-colors",
                    active ? "border-foreground bg-foreground text-background" : "border-border bg-surface text-foreground hover:bg-surface-muted",
                  )}
                >
                  {tab.status !== "all" && <span className={cn("size-2 rounded-full", STATUS[statusKey(tab.status)].dot)} aria-hidden="true" />}
                  <span>{tab.label}</span>
                  <span className={cn("tabular font-semibold", active ? "text-background/60" : "text-muted-foreground")}>{tab.count}</span>
                </button>
              );
            })}
        </div>

        <div className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-[10px] bg-surface-muted p-[3px]" role="tablist" aria-label="Filter by type">
          {[{ type: "all" as const, label: "All types", count: orders.length }, ...TYPES.map((type) => ({ type, label: TYPE[type].label, count: typeCounts.get(type) ?? 0 }))].map((tab) => {
            const active = typeFilter === tab.type;
            return (
              <button
                key={tab.type}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTypeFilter(tab.type)}
                className={cn(
                  "inline-flex h-[30px] shrink-0 items-center gap-[7px] rounded-lg px-3 text-[13px] font-medium transition-colors",
                  active ? "bg-surface text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.type !== "all" && <span className={cn("size-2.5 rounded-[3px]", TYPE[tab.type].swatch)} aria-hidden="true" />}
                <span>{tab.label}</span>
                <span className="tabular text-muted-foreground">{tab.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Rows */}
      <div className="flex flex-col gap-2">
        <div
          className="hidden h-8 items-center gap-3 px-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground md:grid"
          style={{ gridTemplateColumns: columns }}
          aria-hidden="true"
        >
          <div>Type</div>
          <div>Order</div>
          <div>Items</div>
          <div>Status</div>
          <div>Due</div>
          <div className="text-right">Amount</div>
          <div />
        </div>

        {rows.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-border bg-surface p-14 text-center text-sm text-muted-foreground">
            {orders.length === 0 ? "No open orders." : "No orders match."}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                due={dues.get(order.id) ?? dueFor(order, now)}
                columns={columns}
                minHeight={minHeight}
                canAdvance={canAdvance}
                canPrintKot={canPrintKot}
                onOpen={() => setSelectedOrderId(order.id)}
              />
            ))}
          </ul>
        )}
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
