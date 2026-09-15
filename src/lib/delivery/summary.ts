/**
 * Delivery messaging for marketing copy (the homepage), in plain English,
 * generated from the same `DeliveryRates` the checkout quote reads — never
 * a second set of hardcoded numbers that can drift from what checkout
 * actually charges. Pure formatting: no distance math, no fee calculation,
 * that all stays in `quoteDelivery` (./index.ts).
 */

import { formatINR, isZero } from "@/lib/money";
import type { DeliveryRates } from "./index";

const km = (metres: number): string => {
  const value = metres / 1000;
  return `${Number.isInteger(value) ? value : value.toFixed(1)} km`;
};

/** One short line per band, e.g. "Free up to 3 km", "₹30 up to 5 km", "₹30 + ₹10/km beyond 5 km". */
export function summarizeDeliveryBands(rates: DeliveryRates): readonly string[] {
  const lines: string[] = [];
  let previousUpTo = 0;
  for (const band of rates.bands) {
    const flatFree = isZero(band.flatFee);
    const hasPerKm = !isZero(band.perKmFee);
    if (flatFree && !hasPerKm) {
      lines.push(`Free up to ${km(band.upToMetres)}`);
    } else if (!hasPerKm) {
      lines.push(`${formatINR(band.flatFee, "auto")} up to ${km(band.upToMetres)}`);
    } else {
      const base = flatFree ? "" : `${formatINR(band.flatFee, "auto")} + `;
      lines.push(`${base}${formatINR(band.perKmFee, "auto")}/km beyond ${km(previousUpTo)}`);
    }
    previousUpTo = band.upToMetres;
  }
  return lines;
}

/** The one-line free-delivery headline, or null when the rule is off or unconfigured. */
export function summarizeFreeDelivery(rates: DeliveryRates): string | null {
  if (!rates.freeEnabled || rates.freeAboveOrderValue === null) return null;
  const distance = rates.freeMaxMetres === null ? "" : ` within ${km(rates.freeMaxMetres)}`;
  return `Free delivery${distance} on orders ${formatINR(rates.freeAboveOrderValue, "auto")}+`;
}
