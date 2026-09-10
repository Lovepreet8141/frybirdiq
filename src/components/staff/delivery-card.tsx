"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bike, Check, ExternalLink, Loader2, Phone } from "lucide-react";
import { type Paise, formatINR } from "@/lib/money";
import { formatDistance } from "@/lib/delivery";
import { completeDeliveryAction } from "@/lib/auth/staff-actions";
import type { OrderStatus } from "@/domain/order-status";

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
export function DeliveryCard({ delivery }: { delivery: RiderDelivery }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const close = (cashCollected: boolean) =>
    startTransition(async () => {
      setError(null);
      const result = await completeDeliveryAction({ orderId: delivery.id, cashCollected });
      if (!result.ok) setError(result.error ?? "That didn't work.");
      router.refresh();
    });

  const onTheRoad = delivery.status === "OUT_FOR_DELIVERY";

  return (
    <li className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="tabular font-heading text-2xl font-bold">#{delivery.orderNumber}</span>
          <span className="text-sm text-muted-foreground">{delivery.customerName}</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="tabular text-2xl font-bold">{formatINR(delivery.grandTotal)}</span>
          <span className={delivery.isPaid ? "text-xs font-semibold text-[#3F9D52]" : "text-xs font-semibold text-warning"}>
            {delivery.isPaid ? "Already paid" : "Collect cash"}
          </span>
        </div>
      </div>

      {delivery.delivery && (
        <div className="flex flex-col gap-2 rounded-md bg-surface-muted p-4">
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
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${delivery.delivery.lat},${delivery.delivery.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 font-semibold text-primary-foreground"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              Navigate
            </a>
            {delivery.customerPhone && (
              <a
                href={`tel:${delivery.customerPhone}`}
                className="inline-flex min-h-[56px] items-center justify-center gap-2 rounded-md border border-border-strong px-4 font-semibold"
              >
                <Phone className="size-4" aria-hidden="true" />
                Call
              </a>
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

      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}

      {onTheRoad ? (
        <div className="flex flex-col gap-2">
          {/*
            Cash and delivery are one event at the door. Splitting them lets a
            rider close the job and forget the money, or book money for an
            order still in the bag.
          */}
          <button
            type="button"
            disabled={pending}
            onClick={() => close(!delivery.isPaid)}
            className="flex min-h-[64px] items-center justify-center gap-3 rounded-md bg-primary px-6 text-lg font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="size-5" aria-hidden="true" />
            )}
            {delivery.isPaid ? "Delivered" : `Delivered · took ${formatINR(delivery.grandTotal)}`}
          </button>

          {!delivery.isPaid && (
            <button
              type="button"
              disabled={pending}
              onClick={() => close(false)}
              className="flex min-h-[48px] items-center justify-center rounded-md border border-border px-4 text-sm font-semibold text-muted-foreground transition-colors hover:bg-surface-muted disabled:opacity-50"
            >
              Delivered without taking cash
            </button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Waiting for the kitchen to send this out.</p>
      )}
    </li>
  );
}
