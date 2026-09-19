/**
 * Is the shop taking orders right now — for display.
 *
 * Reads the same `openingTime`/`closingTime` the checkout schedule picker and
 * `isValidScheduledTime` read (organizations row), and uses the same window
 * arithmetic (`timeOnBusinessDate`, no overnight wrap: FRYBIRD's 11:30–23:00
 * never crosses midnight). Display only — the server's own refusal of an ASAP
 * order is the authority; this just stops a customer building a cart into a
 * shop that is shut.
 */

import { businessDate, timeOnBusinessDate } from "@/lib/dates";

export type ShopHoursState =
  | { readonly open: true; readonly closesAt: string }
  | { readonly open: false; readonly opensAt: string; readonly opensToday: boolean };

export function shopHoursState(now: Date, openingTime: string, closingTime: string): ShopHoursState {
  const today = businessDate(now);
  const opening = timeOnBusinessDate(today, openingTime);
  const closing = timeOnBusinessDate(today, closingTime);
  if (now.getTime() >= opening.getTime() && now.getTime() < closing.getTime()) {
    return { open: true, closesAt: closingTime };
  }
  return { open: false, opensAt: openingTime, opensToday: now.getTime() < opening.getTime() };
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
