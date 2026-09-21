"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bike, Check, ExternalLink, Loader2, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type Paise, formatINR } from "@/lib/money";
import { formatDistance } from "@/lib/delivery";
import { completeDeliveryAction } from "@/lib/auth/staff-actions";
import type { OrderStatus } from "@/domain/order-status";
import { classifyCloseResult, type CloseOutcome } from "./delivery-close";
import { AssignRiderControl, FailDeliveryControl, ReleaseDeliveryControl, type RiderOption } from "./delivery-rider-controls";

export interface RiderDelivery {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  customerName: string | null;
  customerPhone: string | null;
  grandTotal: Paise;
  isPaid: boolean;
  items: { name: string; quantity: number; modifiers: string[] }[];
  notes: string | null;
  /** The rider it is assigned to (roadmap 6.3); null when unassigned. */
  riderUserId?: string | null;
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
 * One delivery, as a rider sees it on a phone.
 *
 * Big targets, the address and the money first, and two taps to finish: open
 * the map, then close the job. Nothing on this card can move any other order.
 */
export function DeliveryCard({ delivery, riders, canRelease = false, staleMinutes = null }: { delivery: RiderDelivery; /** Present only for people who may assign (`delivery.assign`): shows the assign control. */ riders?: readonly RiderOption[]; /** A rider looking at their own delivery: shows Release. */ canRelease?: boolean; /** Held by a rider and not moved for a while (flag only, for the manager). */ staleMinutes?: number | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<CloseOutcome | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasPending = useRef(false);

  // A disabled button can't hold focus — the browser drops it to <body> the
  // moment `pending` goes true, and never restores it. Put it back on the
  // button when the request finishes, so a keyboard user can retry without
  // re-tabbing from the top of the card.
  useEffect(() => {
    if (wasPending.current && !pending) closeButtonRef.current?.focus();
    wasPending.current = pending;
  }, [pending]);

  const close = (cashCollected: boolean) =>
    startTransition(async () => {
      setOutcome(null);
      let result: CloseOutcome;
      try {
        result = classifyCloseResult({ thrown: false, result: await completeDeliveryAction({ orderId: delivery.id, cashCollected }) });
      } catch {
        result = classifyCloseResult({ thrown: true });
      }
      setOutcome(result);
      // Offline: nothing changed, so there is nothing to refresh yet — the
      // button just re-enables (via `pending`) for another try. Every other
      // outcome, including "closed elsewhere", reflects real server state.
      if (result.kind !== "offline") router.refresh();
    });

  const onTheRoad = delivery.status === "OUT_FOR_DELIVERY";

  return (
    <li className="flex flex-col gap-4 rounded-xl border border-border bg-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="tabular font-heading text-2xl font-bold">#{delivery.orderNumber}</span>
          <span className="text-sm text-muted-foreground">{delivery.customerName ?? "Walk-in"}</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="tabular text-2xl font-bold">{formatINR(delivery.grandTotal)}</span>
          <span className={delivery.isPaid ? "text-xs font-semibold text-gain" : "text-xs font-semibold text-flag"}>
            {delivery.isPaid ? "Already paid" : "Collect cash"}
          </span>
        </div>
      </div>

      {delivery.delivery && (
        <div className="flex flex-col gap-3 rounded-lg bg-surface-muted p-4">
          <div className="flex items-start gap-2">
            <Bike className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="flex flex-col">
              <span className="font-semibold">{delivery.delivery.line1}</span>
              <span className="text-sm text-muted-foreground">{delivery.delivery.landmark}</span>
              {delivery.delivery.distanceMetres !== null && (
                <span className="tabular text-sm text-muted-foreground">
                  {formatDistance(delivery.delivery.distanceMetres)} away
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button asChild size="lg" className="min-h-14 flex-1 gap-2 text-base">
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${delivery.delivery.lat},${delivery.delivery.lng}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                Navigate
              </a>
            </Button>
            {delivery.customerPhone && (
              <Button asChild variant="outline" size="lg" className="min-h-14 gap-2 text-base">
                <a href={`tel:${delivery.customerPhone}`}>
                  <Phone className="size-4" aria-hidden="true" />
                  Call
                </a>
              </Button>
            )}
          </div>
        </div>
      )}

      <ul className="flex flex-col gap-1 text-sm">
        {delivery.items.map((item, index) => (
          <li key={index}>
            <span className="tabular font-semibold">{item.quantity}×</span> {item.name}
            {item.modifiers.length > 0 && <span className="text-muted-foreground"> — {item.modifiers.join(", ")}</span>}
          </li>
        ))}
      </ul>

      {delivery.notes && <p className="rounded-md bg-surface-muted px-3 py-2 text-sm">{delivery.notes}</p>}

      {staleMinutes !== null && (
        <p role="status" className="rounded-md border-l-2 border-flag bg-flag-soft/60 px-3 py-2 text-sm font-semibold">
          Held for {staleMinutes} min without moving. Check with the rider.
        </p>
      )}

      {riders && <AssignRiderControl orderId={delivery.id} riderUserId={delivery.riderUserId ?? null} riders={riders} />}

      {outcome && outcome.kind !== "ok" && (
        <p role="alert" className="rounded-md border-l-2 border-loss bg-loss-soft/60 px-4 py-3 text-sm">
          {outcome.kind === "offline" && "No connection — try again."}
          {outcome.kind === "closed-elsewhere" && "Already closed by someone else."}
          {outcome.kind === "error" && outcome.message}
        </p>
      )}

      {onTheRoad ? (
        <div className="flex flex-col gap-2">
          {/*
            Cash and delivery are one event at the door. Splitting them lets a
            rider close the job and forget the money, or book money for an
            order still in the bag.
          */}
          <Button
            ref={closeButtonRef}
            type="button"
            disabled={pending}
            aria-busy={pending}
            onClick={() => close(!delivery.isPaid)}
            size="lg"
            className="min-h-16 gap-3 text-lg"
          >
            {pending ? (
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="size-5" aria-hidden="true" />
            )}
            {delivery.isPaid ? "Delivered" : `Delivered · took ${formatINR(delivery.grandTotal)}`}
          </Button>

          {/*
            No "delivered without cash" button on an unpaid order: an order
            cannot be closed until money is recorded against it, so that
            button could only ever fail. The shop records the payment first;
            the card then shows "Already paid" and plain "Delivered".
          */}
          {!delivery.isPaid && (
            <p className="text-center text-sm text-muted-foreground">
              Customer paid another way? Leave this open and call the shop. The shop records the payment, then you can close it.
            </p>
          )}

          {/* A paid order that failed needs a manager's refund: the server refuses it here. */}
          {!delivery.isPaid && <FailDeliveryControl orderId={delivery.id} />}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">Waiting for the kitchen to send this out.</p>
          {canRelease && <ReleaseDeliveryControl orderId={delivery.id} />}
        </div>
      )}
    </li>
  );
}
