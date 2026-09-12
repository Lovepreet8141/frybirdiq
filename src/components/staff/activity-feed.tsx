"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { FulfilmentType, OrderStatus } from "@/domain/order-status";
import { cn } from "@/lib/utils";

export interface ActivityRow {
  readonly id: string;
  readonly orderNumber: string;
  readonly fulfilment: FulfilmentType;
  readonly from: OrderStatus | null;
  readonly to: OrderStatus;
  readonly actorName: string | null;
  readonly reason: string | null;
  readonly at: string;
}

/** What each transition is called when spoken about after the fact. */
const VERB: Record<OrderStatus, string> = {
  DRAFT: "Started",
  PENDING_PAYMENT: "Placed",
  PAID: "Paid",
  ACCEPTED: "Accepted",
  PREPARING: "Started cooking",
  READY: "Marked ready",
  OUT_FOR_DELIVERY: "Sent out",
  COMPLETED: "Completed",
  CANCELLED: "Turned down",
  FAILED: "Failed",
  REFUNDED: "Refunded",
};

function verb(row: ActivityRow): string {
  // Money arriving on an order that stays where it is (cash on a ticket
  // already accepted) is written as a same-status event by `recordCashPayment`.
  if (row.from === row.to) return "Payment recorded";
  return VERB[row.to];
}

function dotClass(to: OrderStatus): string {
  if (to === "COMPLETED" || to === "READY") return "bg-[#3F9D52]";
  if (to === "CANCELLED" || to === "FAILED" || to === "REFUNDED") return "bg-destructive";
  if (to === "PENDING_PAYMENT") return "bg-warning";
  return "bg-muted-foreground";
}

function fulfilmentLabel(fulfilment: FulfilmentType): string {
  return fulfilment === "DINE_IN" ? "Dine-in" : fulfilment === "DELIVERY" ? "Delivery" : "Collection";
}

const DAY = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" });
const TIME = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });

/**
 * The activity timeline. The rail-and-dot layout is adapted from the
 * purchased `changelog1` block (the closest activity pattern in the
 * registry); the content is FRYBIRD's `order_events`, one line per status
 * change, grouped by business day. Search is client-side over the rows the
 * page already fetched — no second query.
 */
export function ActivityFeed({ events }: { events: readonly ActivityRow[] }) {
  const [search, setSearch] = useState("");
  const [hideSystem, setHideSystem] = useState(false);
  const normalised = search.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      events.filter((row) => {
        if (hideSystem && row.actorName === null) return false;
        if (normalised === "") return true;
        return (
          row.orderNumber.toLowerCase().includes(normalised) ||
          (row.actorName ?? "system").toLowerCase().includes(normalised) ||
          verb(row).toLowerCase().includes(normalised) ||
          (row.reason ?? "").toLowerCase().includes(normalised)
        );
      }),
    [events, hideSystem, normalised],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search order #, staff or action"
            aria-label="Search activity"
            className="h-9 pl-8"
          />
        </div>
        <label className="flex min-h-[36px] cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={hideSystem} onChange={(event) => setHideSystem(event.target.checked)} className="size-4 accent-[var(--primary)]" />
          Hide system events
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-sm text-muted-foreground">
          {events.length === 0 ? "No order activity yet." : "Nothing matches that search."}
        </p>
      ) : (
        <ol className="relative flex flex-col border-l border-border pl-6">
          {filtered.map((row, index) => {
            const day = DAY.format(new Date(row.at));
            const previousDay = index > 0 ? DAY.format(new Date(filtered[index - 1]!.at)) : null;
            return (
              <li key={row.id} className="relative pb-5">
                {day !== previousDay && (
                  <p className="mb-3 -ml-6 pl-6 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{day}</p>
                )}
                <span className={cn("absolute top-1.5 -left-[29px] size-2.5 rounded-full ring-4 ring-background", dotClass(row.to))} aria-hidden="true" />
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="tabular text-xs text-muted-foreground">{TIME.format(new Date(row.at))}</span>
                  <span className="font-semibold">
                    {verb(row)} <span className="tabular">#{row.orderNumber}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{fulfilmentLabel(row.fulfilment)}</span>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {row.actorName ?? "System"}
                  {row.reason && <span> — {row.reason}</span>}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
