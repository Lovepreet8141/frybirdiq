"use client";

import { useEffect, useState } from "react";
import { Bike } from "lucide-react";
import { Map } from "@/components/delivery/map";
import { POSITION_POST_INTERVAL_MS } from "@/lib/delivery/tracking";

interface Tracking {
  state: "hidden" | "waiting" | "stale" | "live";
  ageSeconds: number | null;
  rider: { lat: number; lng: number; at: string } | null;
  destination: { lat: number; lng: number } | null;
  shop: { lat: number; lng: number } | null;
}

/**
 * Where the rider is, on a map, while the order is out for delivery (Lane B).
 *
 * Asks the server every 15 seconds while the tab is visible; the server answers only for the person who placed the order.
 * If the rider's phone has stopped reporting, the map does NOT keep showing the last dot as if it were live: it says the position
 * is not available right now (BUILD-PLAN §62: do not fake live location). Rendered only for the order's owner, on an order that is out.
 */
export function RiderTracker({ orderId }: { orderId: string }) {
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch(`/api/order/${orderId}/rider`, { cache: "no-store" });
        if (!response.ok) throw new Error("not ok");
        const body = (await response.json()) as Tracking;
        if (!cancelled) {
          setTracking(body);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    void load();
    const timer = setInterval(load, POSITION_POST_INTERVAL_MS);
    const onVisible = () => void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [orderId]);

  if (tracking?.state === "hidden") return null;
  const live = tracking?.state === "live" && tracking.rider !== null;
  const centre = tracking?.rider ?? tracking?.destination ?? tracking?.shop;

  return (
    <section aria-labelledby="rider-tracker-heading" className="mt-8 rounded-2xl border border-border p-5">
      <h2 id="rider-tracker-heading" className="flex items-center gap-2 font-heading text-lg font-semibold">
        <Bike aria-hidden className="size-5 text-primary" />
        Your rider
      </h2>
      <p role="status" className="mt-1 text-sm text-muted-foreground">
        {failed && !tracking
          ? "Couldn't load your rider's position. Trying again."
          : !tracking
            ? "Looking for your rider…"
            : live
              ? "Live position, updated every few seconds."
              : tracking.state === "stale"
                ? "Your rider's position isn't available right now. They are still on the way."
                : "Your rider's position will show here once their phone starts sharing it."}
      </p>
      {centre && tracking && (
        <div className="mt-3">
          <Map centre={centre} pin={tracking.destination} shop={tracking.shop} rider={live ? tracking.rider : null} className="h-64" />
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Your rider&apos;s location is shared only while your order is on its way, and is deleted after 24 hours.</p>
    </section>
  );
}
