/**
 * The words on the Close Shop panel in Admin → Restaurant (ops-1 S4b).
 *
 * Pure, so the copy is testable and the panel is left with layout and state.
 * The headline and the choices match the POS switch (S4a) word for word, as
 * the owner asked for one switch in two places.
 */

import { businessDate } from "@/lib/dates";
import { formatBusinessClock, pausedUntilFor, type PauseMode } from "@/lib/orders/opening-hours";

export const SHOP_OPEN_HEADLINE = "Shop is OPEN for orders";
export const SHOP_CLOSED_HEADLINE = "Shop is CLOSED for orders";

export const PAUSE_MODE_LABELS: Record<PauseMode, string> = {
  UNTIL_NEXT_OPENING: "Until we next open",
  UNTIL_RESUMED: "Until I switch it back on",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** "today at 11:30 AM" / "tomorrow at 11:30 AM" — the phrasing the hours refusal and the POS use. */
export function dayAndClock(at: Date, now: Date): string {
  return `${businessDate(at) === businessDate(now) ? "today" : "tomorrow"} at ${formatBusinessClock(at)}`;
}

/** When a pause began: "today at 7:42 PM", "yesterday at 7:42 PM", or the date. */
export function sinceLabel(at: Date, now: Date): string {
  const day = businessDate(at);
  const when = day === businessDate(now) ? "today" : day === businessDate(new Date(now.getTime() - DAY_MS)) ? "yesterday" : day;
  return `${when} at ${formatBusinessClock(at)}`;
}

/**
 * The line shown BEFORE pausing. Paused before opening, "until we next open"
 * ends at today's opening, so a 9 am broken fryer would restart at 11:30 — the
 * confirm spells that out so the person can pick "until I switch it back on".
 */
export function restartLine(mode: PauseMode, now: Date, openingTime: string, closingTime: string): string {
  const until = pausedUntilFor(mode, now, openingTime, closingTime);
  return until ? `Orders restart ${dayAndClock(until, now)}.` : "Orders stay off until you switch them back on.";
}

/** The count line in the confirm; null when there is nothing to remind anyone of. */
export function stillDueLine(count: number): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? "order is" : "orders are"} already placed and still to be made. Closing does not cancel ${count === 1 ? "it" : "them"}.`;
}
