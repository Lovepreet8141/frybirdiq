"use client";

import { useState } from "react";
import { Bike, ChevronDown, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Map } from "@/components/delivery/map";
import { formatDistance } from "@/lib/delivery";
import { type Paise, formatINR } from "@/lib/money";

/**
 * Where a delivery order is going.
 *
 * The map is collapsed by default. A counter screen during a rush may hold a
 * dozen tickets, and mounting a dozen Leaflet instances to show maps nobody is
 * looking at costs memory and tiles for nothing.
 *
 * "Open in Maps" is the link that actually gets used: it hands the coordinates
 * to whatever navigation app the rider already has, rather than asking them to
 * navigate from a small embedded map.
 */
export function DeliveryPanel({
  line1,
  landmark,
  lat,
  lng,
  distanceMetres,
  fee,
}: {
  line1: string;
  landmark: string;
  lat: number;
  lng: number;
  distanceMetres: number | null;
  fee: Paise;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Bike className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="font-semibold">{line1}</p>
            {landmark && <p className="text-sm text-muted-foreground">{landmark}</p>}
          </div>
        </div>

        <div className="flex flex-col items-end gap-0.5 text-sm">
          {distanceMetres !== null && <span className="tabular font-semibold">{formatDistance(distanceMetres)}</span>}
          <span className="tabular text-muted-foreground">{formatINR(fee)} delivery</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm" className="gap-2">
          <a href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-4" aria-hidden="true" />
            Open in Maps
          </a>
        </Button>

        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="gap-2">
          <ChevronDown
            className={`size-4 transition-transform duration-[var(--duration-standard)] ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
          {open ? "Hide map" : "Show map"}
        </Button>
      </div>

      {open && <Map centre={{ lat, lng }} pin={{ lat, lng }} className="h-48" />}
    </div>
  );
}
