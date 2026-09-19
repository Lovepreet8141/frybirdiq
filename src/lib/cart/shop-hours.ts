import { businessDate } from "@/lib/dates";
import { type PauseMode, type ShopStatus, formatBusinessClock, isOpenAt, orderingRefusal } from "@/lib/orders/opening-hours";

/**
 * Open, closed by the hours, or paused by hand — the one answer every screen
 * renders from: the POS control, the Admin control, and the website banner
 * (ops-1, RELIABILITY req R1; owner requirements 1-2).
 *
 * This decides from `orderingRefusal` — the server gate itself — so it cannot
 * disagree with what submitting would do. (The hours-only `shopHoursState` that
 * used to sit beside it is gone: every customer page now renders from this, via
 * `getOrderingStatus`.)
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
