"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bike, Loader2, PackageOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistance } from "@/lib/delivery";
import type { DeliveryOffer } from "@/lib/delivery/offer";
import { takeDeliveryAction } from "@/lib/auth/staff-actions";
import { formatINR } from "@/lib/money";

/**
 * An available delivery, as a rider sees it before taking it: how many items, how far, what to
 * collect. Deliberately nothing about the customer or where they live: that appears once it is
 * theirs. "Take it" is first-tap-wins on the server; a rider who lost the race is told plainly.
 */
export function DeliveryOfferCard({ offer, atLimit = false }: { offer: DeliveryOffer; atLimit?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const take = () =>
    startTransition(async () => {
      setMessage(null);
      try {
        const result = await takeDeliveryAction({ orderId: offer.id });
        if (!result.ok) setMessage(result.error ?? "That did not work. Try again.");
        router.refresh();
      } catch {
        setMessage("No connection. Try again.");
      }
    });

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="tabular font-heading text-2xl font-bold">#{offer.orderNumber}</span>
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <PackageOpen className="size-4" aria-hidden="true" />
            {offer.itemCount} {offer.itemCount === 1 ? "item" : "items"} to pick up
          </span>
          {offer.distanceMetres !== null && (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Bike className="size-4" aria-hidden="true" />
              <span className="tabular">{formatDistance(offer.distanceMetres)}</span> away
            </span>
          )}
        </div>
        <div className="flex flex-col items-end">
          <span className="tabular text-2xl font-bold">{formatINR(offer.grandTotal)}</span>
          <span className={offer.isPaid ? "text-xs font-semibold text-gain" : "text-xs font-semibold text-flag"}>{offer.isPaid ? "Already paid" : "Collect cash"}</span>
        </div>
      </div>
      {message && (
        <p role="alert" className="rounded-md border-l-2 border-loss bg-loss-soft/60 px-4 py-3 text-sm">
          {message}
        </p>
      )}
      <Button type="button" size="lg" disabled={pending || atLimit} aria-busy={pending} onClick={take} className="min-h-16 gap-3 text-lg">
        {pending && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
        Take it
      </Button>
      <p className="text-center text-xs text-muted-foreground">{atLimit ? "You already hold 2 deliveries. Finish or release one to take another." : "The customer’s name and address appear once it is yours."}</p>
    </li>
  );
}
