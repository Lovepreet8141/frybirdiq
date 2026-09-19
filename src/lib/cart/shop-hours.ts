/**
 * Is the shop taking orders right now — for display.
 *
 * An adapter over `@/lib/orders/opening-hours`, the server gate's own
 * predicate (open inclusive, close exclusive) — no second definition of "open"
 * lives here; this only shapes it for the display copy. Display only — the server's own refusal of an ASAP
 * order is the authority; this just stops a customer building a cart into a
 * shop that is shut.
 */

import { isOpenAt, nextOpening } from "@/lib/orders/opening-hours";

export type ShopHoursState =
  | { readonly open: true; readonly closesAt: string }
  | { readonly open: false; readonly opensAt: string; readonly opensToday: boolean };

export function shopHoursState(now: Date, openingTime: string, closingTime: string): ShopHoursState {
  if (isOpenAt(now, openingTime, closingTime)) return { open: true, closesAt: closingTime };
  const opens = nextOpening(now, openingTime, closingTime);
  return { open: false, opensAt: openingTime, opensToday: opens.day === "TODAY" };
}

/** "11:30" → "11:30 AM", matching the hours line elsewhere on the site. */
export function clockLabel(time: string): string {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

/** The sentence a closed shop shows. Says when it opens, never promises an order will be taken. */
export function closedMessage(state: Extract<ShopHoursState, { open: false }>): string {
  return `We're closed right now. We open ${state.opensToday ? "today" : "tomorrow"} at ${clockLabel(state.opensAt)}. You can look around, but ordering as soon as possible isn't available until then.`;
}
