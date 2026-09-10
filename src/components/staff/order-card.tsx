"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { type Paise, formatINR } from "@/lib/money";
import { advanceOrderAction, markPaidAction } from "@/lib/auth/staff-actions";
import type { OrderStatus } from "@/domain/order-status";
import { cn } from "@/lib/utils";
import { DeliveryPanel } from "./delivery-panel";

export interface StaffOrder {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  customerName: string | null;
  customerPhone: string | null;
  grandTotal: Paise;
  isPaid: boolean;
  placedAt: string | null;
  notes: string | null;
  items: { name: string; quantity: number; modifiers: string[] }[];
  delivery: {
    line1: string;
    landmark: string;
    lat: number;
    lng: number;
    distanceMetres: number | null;
    fee: Paise;
  } | null;
}

/**
 * The next step for a ticket, given where it is.
 *
 * Only ever one step forward. The domain state machine is the authority — this
 * map decides what to label the button, and the server decides whether the
 * move is legal.
 */
const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  PAID: { to: "ACCEPTED", label: "Accept" },
  ACCEPTED: { to: "PREPARING", label: "Start cooking" },
  PREPARING: { to: "READY", label: "Ready" },
  READY: { to: "COMPLETED", label: "Collected" },
};

const STATUS_LABEL: Partial<Record<OrderStatus, string>> = {
  PENDING_PAYMENT: "Awaiting payment",
  PAID: "Paid",
  ACCEPTED: "Accepted",
  PREPARING: "Cooking",
  READY: "Ready to collect",
};

export function OrderCard({
  order,
  canSettle,
  canAdvance,
}: {
  order: StaffOrder;
  canSettle: boolean;
  canAdvance: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const next = NEXT[order.status];

  const run = (work: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await work();
      if (!result.ok) setError(result.error ?? "That didn't work.");
      router.refresh();
    });

  return (
    <li className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <span className="tabular font-heading text-2xl font-bold">#{order.orderNumber}</span>
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em]",
                order.status === "READY"
                  ? "bg-[#3F9D52]/20 text-foreground"
                  : order.status === "PENDING_PAYMENT"
                    ? "bg-warning/20 text-foreground"
                    : "bg-surface-muted text-muted-foreground",
              )}
            >
              {STATUS_LABEL[order.status] ?? order.status}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {order.customerName}
            {order.customerPhone && <span className="tabular"> · {order.customerPhone}</span>}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <span className="tabular text-xl font-bold">{formatINR(order.grandTotal)}</span>
          {/* Paid state is a word, not only a colour. §55. */}
          <span className={cn("text-xs font-semibold", order.isPaid ? "text-[#3F9D52]" : "text-muted-foreground")}>
            {order.isPaid ? "Paid" : "Unpaid"}
          </span>
        </div>
      </div>

      <ul className="flex flex-col gap-1 border-t border-border pt-3 text-sm">
        {order.items.map((item, index) => (
          <li key={index}>
            <span className="tabular font-semibold">{item.quantity}×</span> {item.name}
            {item.modifiers.length > 0 && <span className="text-muted-foreground"> — {item.modifiers.join(", ")}</span>}
          </li>
        ))}
      </ul>

      {order.delivery && <DeliveryPanel {...order.delivery} />}

      {order.notes && <p className="rounded-md bg-surface-muted px-3 py-2 text-sm">{order.notes}</p>}

      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}

      {/* 56px targets: staff move fast, often with wet hands. interaction.md */}
      <div className="flex flex-wrap gap-2">
        {!order.isPaid && canSettle && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => markPaidAction({ orderId: order.id }))}
            className="flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-md bg-primary px-5 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="size-4" aria-hidden="true" />
            )}
            Take {formatINR(order.grandTotal)}
          </button>
        )}

        {next && canAdvance && order.status !== "PENDING_PAYMENT" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => advanceOrderAction({ orderId: order.id, to: next.to }))}
            className="flex min-h-[56px] flex-1 items-center justify-center rounded-md border border-border-strong px-5 font-semibold transition-colors hover:bg-surface-muted disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : next.label}
          </button>
        )}
      </div>
    </li>
  );
}
