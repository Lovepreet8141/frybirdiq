"use client";

import { useEffect, useState, useTransition } from "react";
import { Crosshair, Loader2, MapPin, Plus } from "lucide-react";
import { Map, type Point } from "./map";
import { type DeliveryQuoteResult, quoteDeliveryAction } from "@/lib/cart/delivery-action";
import { cn } from "@/lib/utils";

/**
 * Address capture for a delivery order.
 *
 * A pin plus a landmark, because a typed street address in Ambala frequently
 * will not navigate — "near the water tank, behind Sharma Sweets" is how people
 * actually give directions here. The pin is what gets the rider to the door;
 * the text is what gets read out when the pin is slightly wrong.
 *
 * Every figure shown comes back from the server already formatted. The client
 * never adds a fee to a subtotal — that is the client computing money.
 */
export interface SavedAddressOption {
  id: string;
  line1: string;
  landmark: string | null;
  lat: number;
  lng: number;
  /** Set for the address remembered on this device rather than in an account. */
  onThisDevice?: boolean;
}

export function DeliveryFields({ shop, saved }: { shop: Point; saved: SavedAddressOption[] }) {
  /*
   * A returning customer should not retype their doorstep.
   *
   * Saved addresses are offered first and the newest is preselected, so the
   * common case — ordering to the same place again — is zero taps. The map
   * only appears when there is genuinely a new address to place.
   */
  const [chosenId, setChosenId] = useState<string | null>(saved[0]?.id ?? null);
  const chosen = saved.find((option) => option.id === chosenId) ?? null;

  const [pin, setPin] = useState<Point | null>(
    saved[0] ? { lat: saved[0].lat, lng: saved[0].lng } : null,
  );
  const [quote, setQuote] = useState<DeliveryQuoteResult | null>(null);
  const [locating, setLocating] = useState(false);
  const [pending, startTransition] = useTransition();

  // Re-quote whenever the pin settles. The fee is recomputed from the pin again
  // when the order is placed; this is display only.
  const pinLat = pin?.lat;
  const pinLng = pin?.lng;
  useEffect(() => {
    if (pinLat === undefined || pinLng === undefined) return;
    startTransition(async () => {
      setQuote(await quoteDeliveryAction({ lat: pinLat, lng: pinLng }));
    });
  }, [pinLat, pinLng]);

  function useMyLocation() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPin({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocating(false);
      },
      // Denied or unavailable is not an error worth shouting about — the map
      // still works, the customer just places the pin themselves.
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function chooseSaved(option: SavedAddressOption) {
    setChosenId(option.id);
    setPin({ lat: option.lat, lng: option.lng });
  }

  function chooseNew() {
    setChosenId(null);
    setPin(null);
    setQuote(null);
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Submitted with the form; the server re-reads and re-prices them. */}
      <input type="hidden" name="lat" value={pin?.lat ?? ""} />
      <input type="hidden" name="lng" value={pin?.lng ?? ""} />

      {saved.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold">Deliver to</legend>

          <div className="flex flex-col gap-2">
            {saved.map((option) => (
              <label
                key={option.id}
                className={cn(
                  "flex min-h-[56px] cursor-pointer items-start gap-3 rounded-md border px-4 py-3 transition-colors duration-[var(--duration-micro)]",
                  chosenId === option.id
                    ? "border-primary bg-primary/10"
                    : "border-border bg-surface hover:border-border-strong",
                )}
              >
                <input
                  type="radio"
                  name="savedAddress"
                  checked={chosenId === option.id}
                  onChange={() => chooseSaved(option)}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold">{option.line1}</span>
                  {option.landmark && <span className="text-sm text-muted-foreground">{option.landmark}</span>}
                  {option.onThisDevice && (
                    <span className="text-xs text-muted-foreground">Remembered on this device</span>
                  )}
                </span>
              </label>
            ))}

            <label
              className={cn(
                "flex min-h-[56px] cursor-pointer items-center gap-3 rounded-md border px-4 py-3 transition-colors duration-[var(--duration-micro)]",
                chosenId === null ? "border-primary bg-primary/10" : "border-border bg-surface hover:border-border-strong",
              )}
            >
              <input
                type="radio"
                name="savedAddress"
                checked={chosenId === null}
                onChange={chooseNew}
                className="size-4 shrink-0 accent-[var(--primary)]"
              />
              <span className="flex items-center gap-2 font-semibold">
                <Plus className="size-4" aria-hidden="true" />
                Somewhere else
              </span>
            </label>
          </div>
        </fieldset>
      )}

      <div className={cn("flex flex-col gap-2", chosen && "hidden")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold">Where are we bringing it?</span>
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-border px-3 text-sm font-semibold transition-colors hover:bg-surface disabled:opacity-50"
          >
            {locating ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Crosshair className="size-4" aria-hidden="true" />
            )}
            Use my location
          </button>
        </div>

        <Map centre={pin ?? shop} pin={pin ?? shop} shop={shop} onPinChange={setPin} />

        <p className="text-sm text-muted-foreground">
          {pin ? "Drag the amber pin or tap the map to adjust." : "Tap the map to drop a pin where you are."}
        </p>
      </div>

      {/* The quote. Rendered only once a pin exists, so nothing implies a price
          before there is a distance to price. */}
      {pin && (
        <div role="status" aria-live="polite" className="rounded-lg border border-border bg-surface p-4">
          {pending || !quote ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Working out the delivery charge
            </p>
          ) : quote.available ? (
            <div className="flex flex-col gap-1.5 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-muted-foreground">Delivery · {quote.distance}</span>
                <span className={cn("tabular font-semibold", quote.waived && "text-gain")}>{quote.waived ? "Free delivery" : `Delivery ${quote.fee}`}</span>
              </div>
              {quote.freeDeliveryGap && (
                <p className="text-[12.5px] text-muted-foreground">Add {quote.freeDeliveryGap} more for free delivery.</p>
              )}
              <div className="flex items-baseline justify-between gap-4 border-t border-border pt-1.5">
                <span className="font-semibold">To pay</span>
                <span className="tabular text-lg font-bold">{quote.orderTotal}</span>
              </div>
              {quote.taxTotal !== null && (
                <p className="tabular text-xs text-muted-foreground">Includes {quote.taxTotal} GST</p>
              )}
            </div>
          ) : (
            <p className="text-sm">{quote.reason}</p>
          )}
        </div>
      )}

      {/*
        When a saved address is chosen its details ride along as hidden fields.
        The server still validates and re-prices them — a saved address is a
        convenience, not a shortcut past the checks.
      */}
      {chosen ? (
        <>
          <input type="hidden" name="addressLine1" value={chosen.line1} />
          <input type="hidden" name="landmark" value={chosen.landmark ?? ""} />
        </>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <label htmlFor="addressLine1" className="text-sm font-semibold">
              House / flat / shop
            </label>
            <input
              id="addressLine1"
              name="addressLine1"
              required
              autoComplete="address-line1"
              className="h-[52px] rounded-md border border-border bg-surface px-4 text-base focus-visible:border-border-strong"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="landmark" className="text-sm font-semibold">
              Landmark
            </label>
            <input
              id="landmark"
              name="landmark"
              required
              className="h-[52px] rounded-md border border-border bg-surface px-4 text-base focus-visible:border-border-strong"
            />
            <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              What the rider should look for — a shop, a turning, a gate.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
