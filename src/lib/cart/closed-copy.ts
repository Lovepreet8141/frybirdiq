/**
 * What a refused ASAP order tells the customer. Worded from the server's
 * `ShopClosedRefusal.opensAtLabel` verbatim — never rebuilt, never a browser clock.
 */

import type { ShopClosedRefusal } from "@/lib/repositories/orders";

export function refusedClosedText(closed: Pick<ShopClosedRefusal, "opensAtLabel"> & { readonly opensDay?: ShopClosedRefusal["opensDay"] } & { readonly dayOff?: ShopClosedRefusal["dayOff"] }): string {
  // A whole closed day: there is no "later today", so no promise of one.
  if (closed.dayOff) return `We're closed today, so this order wasn't placed and nothing was charged. We open again ${closed.opensAtLabel}.${closed.dayOff.note ? ` ${closed.dayOff.note}` : ""}`;
  // "Choose a time" only when the picker can have a day for it: the next opening is today or tomorrow (its horizon).
  const canPreorder = closed.opensDay === undefined || closed.opensDay !== "LATER";
  return `We're closed, so this order wasn't placed and nothing was charged. We open ${closed.opensAtLabel}.${canPreorder ? " Choose a time to order ahead." : ""}`;
}
