/**
 * The words on the Close Shop panel in Admin → Restaurant (ops-1 S4b).
 *
 * Pure, so the copy is testable and the panel is left with layout and state.
 * The headline and the choices match the POS switch (S4a) word for word, as
 * the owner asked for one switch in two places.
 */

import { businessDate } from "@/lib/dates";
import { formatBusinessClock, type PauseMode } from "@/lib/orders/opening-hours";
import type { StaffOrderingStatus } from "@/lib/repositories/shop-status";

export const SHOP_OPEN_HEADLINE = "Shop is OPEN for orders";
export const SHOP_CLOSED_HEADLINE = "Shop is CLOSED for orders";

export const PAUSE_MODE_LABELS: Record<PauseMode, string> = {
  UNTIL_NEXT_OPENING: "Until we next open",
  UNTIL_RESUMED: "Until I switch it back on",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a pause began: "today at 7:42 PM", "yesterday at 7:42 PM", or the date. */
export function sinceLabel(at: Date, now: Date): string {
  const day = businessDate(at);
  const when = day === businessDate(now) ? "today" : day === businessDate(new Date(now.getTime() - DAY_MS)) ? "yesterday" : day;
  return `${when} at ${formatBusinessClock(at)}`;
}

/**
 * The line shown BEFORE pausing. `nextOpeningLabel` is what `previewPauseAction`
 * returned when the chooser opened ("today at 11:30 AM") — read on the server's
 * clock at that moment, not at page render, so a phone left open across
 * opening time cannot show an earlier restart than the real one. Paused before
 * opening, "until we next open" ends at today's opening, so a 9 am broken fryer
 * would restart at 11:30: the confirm spells that out so the person can pick
 * "until I switch it back on".
 */
export function restartLine(mode: PauseMode, nextOpeningLabel: string | null): string | null {
  if (mode === "UNTIL_RESUMED") return "Orders stay off until you switch them back on.";
  return nextOpeningLabel ? `Orders restart ${nextOpeningLabel}.` : null;
}

export interface PauseChoice {
  readonly mode: PauseMode;
  readonly reason: string;
}

export interface PauseOutcome {
  /** True when the chooser should close; false keeps it open so the person can try again. */
  readonly close: boolean;
  readonly message: { readonly tone: "error" | "note"; readonly text: string } | null;
}

function pauseInForce(status: StaffOrderingStatus): string {
  if (status.state !== "paused") return "";
  const who = status.pausedBy ? (status.pausedBy.name ?? "a staff member") : "someone";
  const until = status.reopensAtLabel ? `Orders restart ${status.reopensAtLabel}.` : "Orders stay off until someone switches them back on.";
  return `Already switched off by ${who}${status.reason ? ` ("${status.reason}")` : ""}. ${until}`;
}

/**
 * What to tell the person after a pause request came back ok. Decided from the
 * status the server returned — never from the click:
 *  - the shop is not paused: the pause did not take, say so and stay open;
 *  - it was already paused (changed: false) by a different choice: say the
 *    choice was NOT applied, and name the pause in force;
 *  - otherwise the pause is what they chose.
 */
export function pauseOutcome(result: { readonly changed: boolean; readonly status: StaffOrderingStatus }, chosen: PauseChoice): PauseOutcome {
  const { status, changed } = result;
  if (status.state !== "paused") {
    const still = status.state === "open" ? "The shop is still open for orders." : "Online orders are not switched off.";
    return { close: false, message: { tone: "error", text: `That didn't take. ${still} Try again, and tell the owner if it keeps happening.` } };
  }
  if (!changed) {
    const same = status.mode === chosen.mode && (status.reason ?? "").trim() === chosen.reason.trim();
    return { close: true, message: { tone: same ? "note" : "error", text: same ? pauseInForce(status) : `Your choice was not applied. ${pauseInForce(status)}` } };
  }
  return { close: true, message: null };
}

/** The count line in the confirm; null when there is nothing to remind anyone of. */
export function stillDueLine(count: number): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? "order is" : "orders are"} not finished yet. Closing does not cancel ${count === 1 ? "it" : "them"}.`;
}
