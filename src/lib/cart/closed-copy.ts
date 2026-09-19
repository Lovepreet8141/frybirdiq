/**
 * What a closed shop tells the customer.
 *
 * Whether the shop is open is `@/lib/orders/opening-hours` (the server gate's
 * own module); nothing here decides that. This only words it. A refused
 * order's wording comes from the server's `ShopClosedRefusal.opensAtLabel`
 * verbatim — this module never rebuilds it and never reads a browser clock.
 */

import type { ShopClosedRefusal } from "@/lib/repositories/orders";

/** "11:30" → "11:30 AM", matching the hours line elsewhere on the site. */
export function clockLabel(time: string): string {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

/** The pre-cart notice, from `nextOpening`'s day and the org's opening time. */
export function closedNoticeText(day: "TODAY" | "TOMORROW", openingTime: string): string {
  return `We're closed right now. We open ${day === "TODAY" ? "today" : "tomorrow"} at ${clockLabel(openingTime)}. You can look around, but ordering as soon as possible isn't available until then.`;
}

/** An ASAP order the server refused because the shop is shut. Rendered from `closed`, never from the error message. */
export function refusedClosedText(closed: Pick<ShopClosedRefusal, "opensAtLabel">): string {
  return `We're closed, so this order wasn't placed and nothing was charged. We open ${closed.opensAtLabel}. Choose a time to order ahead.`;
}
