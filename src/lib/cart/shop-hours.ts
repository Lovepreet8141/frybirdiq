/**
 * Is the shop taking orders right now — for display.
 *
 * An adapter over `@/lib/orders/opening-hours`, the server gate's own
 * predicate (open inclusive, close exclusive) — no second definition of "open"
 * lives here; this only shapes it for the display copy. Display only — the server's own refusal of an ASAP
 * order is the authority; this just stops a customer building a cart into a
 * shop that is shut.
 */

import { businessDate, timeOnBusinessDate } from "@/lib/dates";
import { type PauseMode, type ShopStatus, formatBusinessClock, isOpenAt, nextOpening, orderingRefusal } from "@/lib/orders/opening-hours";

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
 * Open, closed by the hours, or paused by hand — the one answer every screen
 * renders from: the POS control, the Admin control, and the website banner
 * (ops-1, RELIABILITY req R1; owner requirements 1-2).
 *
 * `shopHoursState` above answers from the hours alone, and three pages read it
 * (home, checkout's ASAP default, the closed notice). None of them know about
 * the switch, so while paused in trading hours the home page shows nothing,
 * checkout pre-selects ASAP, and the customer builds a cart only to be refused
 * at submit. So this decides from `orderingRefusal` — the server gate itself —
 * and cannot disagree with what submitting would do. `shopHoursState` is left
 * as it is: its callers are CUSTOMER-WEB's, and move over in S5.
 *
 * - open: ASAP and pre-orders both available.
 * - closedByHours: the hours say no; pre-ordering is the way forward.
 * - paused: neither, until `reopensAt` — or, for UNTIL_RESUMED, until someone
 *   switches it back on, and `reopensAt` is null. The owner's copy follows
 *   from that: "We open again [day] at [time]" when there is a time, "Please
 *   check back soon" when there is not. `withinHours` is there so a page can
 *   also drop "check back soon" at 01:00, when the hours would refuse a retry
 *   anyway.
 *
 * `reopensAtLabel` is the finished phrase ("tomorrow at 11:30 AM"), built once
 * here with the shared business-clock formatter, so the banner, the POS and
 * Admin cannot spell the same time three ways. Who paused is not here: that is
 * a name from the staff table, which the repository read adds.
 */
export type ShopOrderingState =
  | { readonly state: "open"; readonly closesAt: string }
  | { readonly state: "closedByHours"; readonly reopensAt: Date; readonly reopensAtLabel: string }
  | {
      readonly state: "paused";
      readonly mode: PauseMode;
      readonly pausedAt: Date;
      readonly reopensAt: Date | null;
      readonly reopensAtLabel: string | null;
      readonly withinHours: boolean;
    };

export function shopOrderingState(now: Date, shop: ShopStatus): ShopOrderingState {
  const refusal = orderingRefusal(now, shop, "ASAP");
  if (refusal?.kind === "PAUSED" && shop.orderingPausedAt instanceof Date) {
    const until = shop.orderingPausedUntil instanceof Date ? shop.orderingPausedUntil : null;
    return {
      state: "paused",
      mode: until ? "UNTIL_NEXT_OPENING" : "UNTIL_RESUMED",
      pausedAt: shop.orderingPausedAt,
      reopensAt: until,
      reopensAtLabel: until ? dayAndClock(until, now) : null,
      withinHours: isOpenAt(now, shop.openingTime, shop.closingTime),
    };
  }
  if (refusal?.kind === "CLOSED") {
    const reopensAt = new Date(refusal.closed.opensAt);
    return { state: "closedByHours", reopensAt, reopensAtLabel: refusal.closed.opensAtLabel };
  }
  return { state: "open", closesAt: shop.closingTime };
}

/** "today at 11:30 AM" / "tomorrow at 11:30 AM" — the same phrasing the hours refusal uses. */
export function dayAndClock(at: Date, now: Date): string {
  return `${businessDate(at) === businessDate(now) ? "today" : "tomorrow"} at ${formatBusinessClock(at)}`;
}
