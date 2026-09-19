/**
 * Is the shop taking orders right now — for display.
 *
 * An adapter over `@/lib/orders/opening-hours`, the server gate's own
 * predicate (open inclusive, close exclusive) — no second definition of "open"
 * lives here; this only shapes it for the display copy. Display only — the server's own refusal of an ASAP
 * order is the authority; this just stops a customer building a cart into a
 * shop that is shut.
 */

import { timeOnBusinessDate } from "@/lib/dates";
import { type ShopStatus, formatBusinessClock, isOpenAt, nextOpening, orderingRefusal } from "@/lib/orders/opening-hours";

export type ShopHoursState =
  | { readonly open: true; readonly closesAt: string }
  | { readonly open: false; readonly opensAt: string; readonly opensToday: boolean };

export function shopHoursState(now: Date, openingTime: string, closingTime: string): ShopHoursState {
  if (isOpenAt(now, openingTime, closingTime)) return { open: true, closesAt: closingTime };
  const opens = nextOpening(now, openingTime, closingTime);
  return { open: false, opensAt: openingTime, opensToday: opens.day === "TODAY" };
}

/** "11:30" → the shared business-clock label, so this notice and the refusal spell a time identically. */
export function clockLabel(time: string): string {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  // A wall-clock time has no date of its own; any IST day pins it, and the
  // shared formatter (explicit hour12, normalised spacing/case) does the wording.
  return formatBusinessClock(timeOnBusinessDate("2026-01-01", `${hours}:${minutes}`));
}

/** The sentence a closed shop shows. Says when it opens, never promises an order will be taken. */
export function closedMessage(state: Extract<ShopHoursState, { open: false }>): string {
  return `We're closed right now. We open ${state.opensToday ? "today" : "tomorrow"} at ${clockLabel(state.opensAt)}. You can look around, but ordering as soon as possible isn't available until then.`;
}

/**
 * Open, closed by the hours, or paused by hand — the one answer every customer
 * page should render from (ops-1, RELIABILITY req R1).
 *
 * `shopHoursState` above answers from the hours alone, and three pages read it
 * (home, checkout's ASAP default, the closed notice). None of them know about
 * the Close Shop switch, so while paused in trading hours the home page shows
 * nothing, checkout pre-selects ASAP, and the customer builds a cart only to be
 * refused at submit. Asking each page to also read the pause would put three
 * call sites in charge of "paused or closed?" — the two-predicates problem this
 * module exists to prevent.
 *
 * So the decision comes from `orderingRefusal`, the server gate itself, and
 * cannot disagree with what submitting would do. `shopHoursState` is left
 * exactly as it is, because its callers are not this module's to change; they
 * move over to this one in their own slice (S5) and it can then go.
 *
 * - OPEN: ASAP and scheduling both available.
 * - CLOSED: the hours say no; scheduling is the way forward.
 * - PAUSED: neither. `withinHours` is for the copy only — "check back soon"
 *   invites a retry at 01:00 that the hours would refuse anyway, so a page
 *   should drop it when the pause and the hours agree.
 */
export type ShopOrderingState =
  | { readonly state: "OPEN"; readonly closesAt: string }
  | { readonly state: "CLOSED"; readonly opensAt: string; readonly opensToday: boolean }
  | { readonly state: "PAUSED"; readonly withinHours: boolean };

export function shopOrderingState(now: Date, shop: ShopStatus): ShopOrderingState {
  const refusal = orderingRefusal(now, shop, "ASAP");
  if (refusal?.kind === "PAUSED") return { state: "PAUSED", withinHours: isOpenAt(now, shop.openingTime, shop.closingTime) };
  if (refusal?.kind === "CLOSED") return { state: "CLOSED", opensAt: shop.openingTime, opensToday: refusal.closed.opensDay === "TODAY" };
  return { state: "OPEN", closesAt: shop.closingTime };
}
