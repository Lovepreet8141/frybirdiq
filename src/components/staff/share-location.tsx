"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, MapPinOff } from "lucide-react";
import { postRiderPositionAction } from "@/lib/auth/staff-actions";
import { POSITION_POST_INTERVAL_MS } from "@/lib/delivery/tracking";

type Sharing = "starting" | "sharing" | "denied" | "unavailable" | "offline";

/**
 * Sends this phone's position to the shop while a delivery is out, so the customer can follow it (Lane B).
 * Shown only on a rider's own OUT_FOR_DELIVERY card, so it starts when the rider leaves and stops when the delivery is closed
 * (the card unmounts). It never blocks delivering: if location is off or refused it says so and the delivery carries on.
 * The browser only reports a position while this page is open and the screen is on; a screen wake lock is requested where the
 * browser allows it, and the customer's map says "not available right now" when fixes stop rather than showing an old dot.
 */
export function ShareLocation({ orderId }: { orderId: string }) {
  const [state, setState] = useState<Sharing>("starting");
  const sending = useRef(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      queueMicrotask(() => setState("unavailable"));
      return;
    }
    let stopped = false;
    let wakeLock: { release: () => Promise<void> } | null = null;

    const send = () => {
      if (stopped || sending.current || document.visibilityState !== "visible") return;
      if (!navigator.onLine) {
        setState("offline");
        return;
      }
      sending.current = true;
      navigator.geolocation.getCurrentPosition(
        async (fix) => {
          try {
            const result = await postRiderPositionAction({ orderId, lat: fix.coords.latitude, lng: fix.coords.longitude, accuracyMetres: fix.coords.accuracy });
            if (!stopped) setState(result.ok ? "sharing" : "unavailable");
          } catch {
            if (!stopped) setState("offline");
          } finally {
            sending.current = false;
          }
        },
        (failure) => {
          sending.current = false;
          if (!stopped) setState(failure.code === failure.PERMISSION_DENIED ? "denied" : "unavailable");
        },
        { enableHighAccuracy: true, maximumAge: 10_000, timeout: 12_000 },
      );
    };

    send();
    const timer = setInterval(send, POSITION_POST_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") send();
    };
    document.addEventListener("visibilitychange", onVisible);
    (async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } };
        if (nav.wakeLock) wakeLock = await nav.wakeLock.request("screen");
      } catch {
        // Not allowed here (or the battery saver is on): sharing still works while the screen stays on.
      }
    })();

    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      void wakeLock?.release().catch(() => undefined);
    };
  }, [orderId]);

  const ok = state === "sharing" || state === "starting";
  const Icon = ok ? MapPin : MapPinOff;
  const text =
    state === "sharing"
      ? "Sharing your location with the customer. Keep this screen open."
      : state === "starting"
        ? "Starting to share your location with the customer…"
        : state === "denied"
          ? "Location is off for this page. Allow it in your browser settings so the customer can follow the delivery. You can still deliver."
          : state === "offline"
            ? "No connection: your location will resume when you are back online."
            : "Your location could not be read right now. You can still deliver.";

  return (
    <p role="status" className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${ok ? "border-border text-muted-foreground" : "border-amber-500/50 text-foreground"}`}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{text}</span>
    </p>
  );
}
