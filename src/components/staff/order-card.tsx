"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Clock, FileText, Loader2, Printer } from "lucide-react";
import { type Paise, formatINR } from "@/lib/money";
import { advanceOrderAction, markPaidAction } from "@/lib/auth/staff-actions";
import type { OrderStatus } from "@/domain/order-status";
import { cn } from "@/lib/utils";
import { DeliveryPanel } from "./delivery-panel";
import { openKotWindow } from "./print-kot";
import { WhatsAppButton } from "@/components/order/whatsapp-button";

export interface StaffOrder {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  customerName: string | null;
  customerPhone: string | null;
  grandTotal: Paise;
  isPaid: boolean;
  fulfilment: "DINE_IN" | "TAKEAWAY" | "DELIVERY";
  placedAt: string | null;
  notes: string | null;
  items: { name: string; quantity: number; modifiers: string[] }[];
  invoiceNumber: string | null;
  estimatedReadyAt: string | null;
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
 * The next step for a ticket, given where it is and how it is going out.
 *
 * Only ever one step forward. The domain state machine is the authority — this
 * decides what to label the button, and the server decides whether the move is
 * legal.
 *
 * An unpaid order can be accepted. Cash on collection and cash on delivery
 * both take the money at the end, so waiting for payment before cooking would
 * mean a collection order is not started until the customer is at the counter,
 * and a delivery order is never started at all.
 */
function nextStep(
  status: OrderStatus,
  fulfilment: StaffOrder["fulfilment"],
): { to: OrderStatus; label: string } | null {
  switch (status) {
    case "PENDING_PAYMENT":
    case "PAID":
      return { to: "ACCEPTED", label: "Accept" };
    case "ACCEPTED":
      return { to: "PREPARING", label: "Start cooking" };
    case "PREPARING":
      return { to: "READY", label: fulfilment === "DELIVERY" ? "Ready to send" : "Ready" };
    case "READY":
      return fulfilment === "DELIVERY"
        ? { to: "OUT_FOR_DELIVERY", label: "Send out" }
        : { to: "COMPLETED", label: "Handed over" };
    case "OUT_FOR_DELIVERY":
      return { to: "COMPLETED", label: "Delivered" };
    default:
      return null;
  }
}

function statusLabel(status: OrderStatus, fulfilment: StaffOrder["fulfilment"]): string {
  switch (status) {
    case "PENDING_PAYMENT":
      return "New";
    case "PAID":
      return "Paid";
    case "ACCEPTED":
      return "Accepted";
    case "PREPARING":
      return "Cooking";
    case "READY":
      return fulfilment === "DELIVERY" ? "Ready to send" : "Ready to collect";
    case "OUT_FOR_DELIVERY":
      return "Out for delivery";
    default:
      return status;
  }
}

export function OrderCard({
  order,
  canSettle,
  canAdvance,
  canPrintKot,
}: {
  order: StaffOrder;
  canSettle: boolean;
  canAdvance: boolean;
  canPrintKot: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const next = nextStep(order.status, order.fulfilment);
  const isDelivery = order.fulfilment === "DELIVERY";
  /** Handing over an unpaid order is giving food away. */
  const blockedByPayment = !order.isPaid && next?.to === "COMPLETED";

  const run = (work: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await work();
      if (!result.ok) setError(result.error ?? "That didn't work.");
      router.refresh();
    });

  /**
   * Accepting an order is the moment the kitchen needs paper. The ticket
   * window opens here, synchronously in the click, before `run` even
   * starts its transition — a browser only lets `window.open` through
   * without being treated as a pop-up when it runs in the same tick as the
   * tap that caused it.
   */
  const acceptAndPrint = () => {
    const kot = openKotWindow();
    run(async () => {
      const result = await advanceOrderAction({ orderId: order.id, to: "ACCEPTED" });
      if (result.ok) kot.commit(order.id);
      else kot.cancel();
      return result;
    });
  };

  return (
    <li className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <span className="tabular font-heading text-2xl font-bold">#{order.orderNumber}</span>
            <span className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {isDelivery ? "Delivery" : "Collection"}
            </span>
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em]",
                order.status === "READY" || order.status === "OUT_FOR_DELIVERY"
                  ? "bg-[#3F9D52]/20 text-foreground"
                  : order.status === "PENDING_PAYMENT"
                    ? "bg-warning/20 text-foreground"
                    : "bg-surface-muted text-muted-foreground",
              )}
            >
              {statusLabel(order.status, order.fulfilment)}
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

      {order.estimatedReadyAt && order.status !== "COMPLETED" && (
        <p className="tabular flex items-center gap-1.5 text-sm font-semibold">
          <Clock className="size-4 text-primary" aria-hidden="true" />
          Promised for{" "}
          {new Date(order.estimatedReadyAt).toLocaleTimeString("en-IN", {
            timeZone: "Asia/Kolkata",
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      )}

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
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {next && canAdvance && (
            <button
              type="button"
              /*
               * Blocked rather than refused. Completing an unpaid order is the
               * one move the server rejects, and letting it be pressed just to
               * fail repeats the reason back as an error — the same sentence
               * twice, once as a hint and once as an alert. §56 lists
               * `disabled` as a state to build, not a case to explain after.
               */
              disabled={pending || blockedByPayment}
              onClick={
                next.to === "ACCEPTED"
                  ? acceptAndPrint
                  : () => run(() => advanceOrderAction({ orderId: order.id, to: next.to }))
              }
              className="flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-md bg-primary px-5 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : next.label}
            </button>
          )}

          {!order.isPaid && canSettle && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => markPaidAction({ orderId: order.id }))}
              className={cn(
                "flex min-h-[56px] items-center justify-center gap-2 rounded-md px-5 font-semibold transition-colors disabled:opacity-50",
                next
                  ? "border border-border-strong hover:bg-surface-muted"
                  : "flex-1 bg-primary text-primary-foreground hover:opacity-90",
              )}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="size-4" aria-hidden="true" />
              )}
              {/*
                For delivery the cash is collected at the customer's door, not
                here. Labelling it "Take" would ask the counter to do something
                it cannot do; the rider hands the money over on their return.
              */}
              {isDelivery ? `Cash in ${formatINR(order.grandTotal)}` : `Take ${formatINR(order.grandTotal)}`}
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <WhatsAppButton orderId={order.id} phone={order.customerPhone} />
          <Link
            href={`/order/${order.id}/invoice`}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-border px-4 text-sm font-semibold transition-colors hover:bg-surface-muted"
          >
            <FileText className="size-4" aria-hidden="true" />
            {order.invoiceNumber ?? "Receipt"}
          </Link>
          {canPrintKot && (
            <button
              type="button"
              onClick={() => openKotWindow().commit(order.id)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-border px-4 text-sm font-semibold transition-colors hover:bg-surface-muted"
            >
              <Printer className="size-4" aria-hidden="true" />
              Print KOT
            </button>
          )}
        </div>

        {/* Said before it is pressed, rather than as an error afterwards. */}
        {blockedByPayment && (
          <p className="text-sm text-muted-foreground">
            {isDelivery
              ? "Record the cash from the rider before closing this order."
              : "Take payment before handing this over."}
          </p>
        )}
      </div>
    </li>
  );
}
