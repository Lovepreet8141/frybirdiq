"use client";

import { AssignRiderControl, type RiderOption } from "./delivery-rider-controls";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Clock, FileText, Loader2, MessageCircle, Printer } from "lucide-react";
import { type Paise, formatINR } from "@/lib/money";
import { advanceOrderAction, markPaidAction } from "@/lib/auth/staff-actions";
import type { OrderStatus } from "@/domain/order-status";
// Pure, so the Command Center's Server Component can call it too — a
// function exported from this "use client" file is a client reference there.
import { statusLabel } from "@/domain/order-status-labels";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeliveryPanel } from "./delivery-panel";
import { openKotWindow } from "./print-kot";

/**
 * The five order-status tints (MASTER.md §5 "Order tints"). Mirrors
 * `orders-board.tsx`'s own local `statusKey`/`STATUS` map rather than
 * importing it — this card is what that board's row opens into a detail
 * sheet, and `orders-board.tsx` already imports `OrderCard` from here, so
 * the reverse import would cycle. Literal class strings, so Tailwind can
 * see them.
 */
type OrderStatusKey = "new" | "accepted" | "cooking" | "ready" | "outForDelivery";

function orderStatusKey(status: OrderStatus): OrderStatusKey {
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

const ORDER_STATUS_TINT: Record<OrderStatusKey, { pill: string; dot: string }> = {
  new: { pill: "bg-status-new text-status-new-fg", dot: "bg-status-new-dot" },
  accepted: { pill: "bg-status-accepted text-status-accepted-fg", dot: "bg-status-accepted-dot" },
  cooking: { pill: "bg-status-cooking text-status-cooking-fg", dot: "bg-status-cooking-dot" },
  ready: { pill: "bg-status-ready text-status-ready-fg", dot: "bg-status-ready-dot" },
  outForDelivery: { pill: "bg-status-out-for-delivery text-status-out-for-delivery-fg", dot: "bg-status-out-for-delivery-dot" },
};

export interface StaffOrder {
  id: string;
  orderNumber: string;
  /** The rider a delivery is assigned to (roadmap 6.3). */
  riderUserId?: string | null;
  status: OrderStatus;
  customerName: string | null;
  customerPhone: string | null;
  customerId: string | null;
  grandTotal: Paise;
  isPaid: boolean;
  /** Waiting on an online payment: the kitchen refuses it until money is recorded, so no Accept button. */
  awaitingOnlinePayment?: boolean;
  fulfilment: "DINE_IN" | "TAKEAWAY" | "DELIVERY";
  channel: "DINE_IN" | "TAKEAWAY" | "ONLINE";
  tableName: string | null;
  placedBy: string | null;
  placedAt: string | null;
  /** The customer's own requested time — distinct from `estimatedReadyAt`, the kitchen's promise. Null on an ASAP order. */
  scheduledFor: string | null;
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

import { nextStep } from "./next-step";
export { nextStep };

export function OrderCard({
  order,
  canSettle,
  canAdvance,
  canPrintKot,
  canSeeCustomers = false,
  riders,
}: {
  order: StaffOrder;
  /** Present only for people who may assign a rider (`delivery.assign`): shows the assign control on a delivery order. */
  riders?: readonly RiderOption[];
  canSettle: boolean;
  canAdvance: boolean;
  canPrintKot: boolean;
  /** `customers.view` — turns the customer's name into a link to their Customer 360 page. */
  canSeeCustomers?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const next = nextStep(order.status, order.fulfilment, order.awaitingOnlinePayment);
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

  const statusTint = ORDER_STATUS_TINT[orderStatusKey(order.status)];

  return (
    <li className="flex flex-col gap-4 rounded-xl border border-border bg-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <span className="tabular font-heading text-2xl font-bold">#{order.orderNumber}</span>
            <Badge variant="outline" className="uppercase tracking-[0.08em] text-muted-foreground">
              {isDelivery ? "Delivery" : "Collection"}
            </Badge>
            <Badge className={cn("h-7 gap-[7px] px-[11px] text-xs font-semibold", statusTint.pill)}>
              <span className={cn("size-[7px] rounded-full", statusTint.dot)} aria-hidden="true" />
              {statusLabel(order.status, order.fulfilment)}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {canSeeCustomers && order.customerId ? (
              <Link href={`/app/customers/${order.customerId}`} className="font-semibold text-foreground underline-offset-2 hover:underline">
                {order.customerName ?? "Customer"}
              </Link>
            ) : (
              order.customerName
            )}
            {order.customerPhone && <span className="tabular"> · {order.customerPhone}</span>}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <span className="tabular text-xl font-bold">{formatINR(order.grandTotal)}</span>
          {/* Paid state is a word, not only a colour. §55. */}
          <span className={cn("text-xs font-semibold", order.isPaid ? "text-gain" : "text-flag")}>
            {order.isPaid ? "Paid" : "Unpaid"}
          </span>
        </div>
      </div>

      {order.scheduledFor && order.status !== "COMPLETED" && (
        <p className="tabular flex items-center gap-1.5 text-sm font-semibold text-flag">
          <Clock className="size-4" aria-hidden="true" />
          Requested for{" "}
          {new Date(order.scheduledFor).toLocaleTimeString("en-IN", {
            timeZone: "Asia/Kolkata",
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      )}

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
      {riders && order.fulfilment === "DELIVERY" && <AssignRiderControl orderId={order.id} riderUserId={order.riderUserId ?? null} riders={riders} />}

      {order.notes && <p className="rounded-md bg-surface-muted px-3 py-2 text-sm">{order.notes}</p>}

      {error && (
        <p role="alert" className="rounded-md border-l-2 border-loss bg-loss-soft/60 px-4 py-3 text-sm">
          {error}
        </p>
      )}

      {/* 56px targets: staff move fast, often with wet hands. interaction.md */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {next && canAdvance && (
            <Button
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
              size="lg"
              className="min-h-14 flex-1 gap-2 text-base"
            >
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : next.label}
            </Button>
          )}

          {!order.isPaid && canSettle && (
            <Button
              type="button"
              variant={next ? "outline" : "default"}
              disabled={pending}
              onClick={() => run(() => markPaidAction({ orderId: order.id }))}
              size="lg"
              // The outline case keeps the stronger border the raw button used to
              // pair with, since this is uncollected cash: never a match for the
              // default outline's quieter hairline.
              className={cn("min-h-14 gap-2 text-base", next ? "border-border-strong" : "flex-1")}
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
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {/*
            Opens the customer invoice page in a new tab rather than
            reimplementing image sharing here — that page's ReceiptShare
            already renders the same invoice DOM and calls
            navigator.share({ title: "", files: [file] }), the one real
            (proven-working) image-share path. This card used to hold its
            own WhatsAppButton (a wa.me text-only link) for this; it never
            attached the invoice image, so it's gone rather than kept as a
            second, weaker way to do the same thing. Authorization is
            unchanged — the order id is the same unguessable UUID either
            page already treats as access.
          */}
          {order.customerPhone && (
            <Button asChild variant="outline" className="min-h-11 gap-2 text-sm">
              <Link href={`/order/${order.id}/invoice`} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="size-4" aria-hidden="true" />
                Send on WhatsApp
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" className="min-h-11 gap-2 text-sm">
            <Link href={`/order/${order.id}/invoice`}>
              <FileText className="size-4" aria-hidden="true" />
              {order.invoiceNumber ?? "Receipt"}
            </Link>
          </Button>
          {canPrintKot && (
            <Button
              type="button"
              variant="outline"
              onClick={() => openKotWindow().commit(order.id)}
              className="min-h-11 gap-2 text-sm"
            >
              <Printer className="size-4" aria-hidden="true" />
              Print KOT
            </Button>
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
