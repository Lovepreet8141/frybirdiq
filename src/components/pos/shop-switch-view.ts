/**
 * What the POS shop switch says, worked out without a screen (ops-1 S4a).
 *
 * Plain logic, so every sentence a cashier reads and every rule about when to
 * show it is tested without a DOM: the switch component only renders this.
 * Everything here reads `StaffOrderingStatus` — the one read the ordering gate
 * also uses (RELIABILITY RULE 1) — and never a column, so a pause that did not
 * take shows as OPEN on the very screen where it was pressed.
 *
 * Words are the owner's where the owner gave them ("Shop is OPEN for orders",
 * "until we next open", "until I switch it back on"); the rest follow the
 * voice rules — short, plain, no exclamation marks.
 */

import { businessDate } from "@/lib/dates";
import type { PauseMode } from "@/lib/orders/opening-hours";
import { formatBusinessClock } from "@/lib/orders/opening-hours";
import type { StaffOrderingStatus } from "@/lib/repositories/shop-status";

export const OPEN_TITLE = "Shop is OPEN for orders";
export const CLOSED_TITLE = "Shop is CLOSED for orders";

export interface ShopSwitchView {
  /** The switch position: true unless someone has paused ordering. */
  readonly open: boolean;
  readonly title: typeof OPEN_TITLE | typeof CLOSED_TITLE;
  /** Who, when and when it reopens — always visible (owner requirement 1). */
  readonly detail: string;
  /** Staff's reason, shown to staff only, while closed. */
  readonly reason: string | null;
}

export function shopSwitchView(status: StaffOrderingStatus, now: Date): ShopSwitchView {
  if (status.state === "paused") {
    const who = status.pausedBy?.name ?? "a staff member";
    const when = sinceLabel(status.pausedAt, now);
    const reopens = status.reopensAtLabel ? `Reopens ${status.reopensAtLabel}.` : "Stays closed until someone opens it.";
    return { open: false, title: CLOSED_TITLE, detail: `Closed ${when} by ${who}. ${reopens}`, reason: status.reason };
  }
  if (status.state === "closedByHours") {
    // The switch is on; the hours are what is stopping orders right now.
    return { open: true, title: OPEN_TITLE, detail: `Outside opening hours. Orders start ${status.reopensAtLabel}.`, reason: null };
  }
  return { open: true, title: OPEN_TITLE, detail: "Taking online orders.", reason: null };
}

/** The two choices when switching off, in the owner's words. The default comes first. */
export const PAUSE_MODES: readonly { readonly mode: PauseMode; readonly label: string }[] = [
  { mode: "UNTIL_NEXT_OPENING", label: "Until we next open" },
  { mode: "UNTIL_RESUMED", label: "Until I switch it back on" },
];

/**
 * What confirming would do, said before anyone presses it.
 *
 * The first line is the one that stops the 9 am mistake: paused before
 * opening, "until we next open" ends at 11:30 TODAY, so it says "today" in
 * words rather than leaving the cashier to assume "tomorrow".
 */
export function pauseConfirmLines(mode: PauseMode, preview: { readonly nextOpeningLabel: string; readonly ordersStillDue: number }): readonly string[] {
  const restart =
    mode === "UNTIL_NEXT_OPENING" ? `Orders restart ${preview.nextOpeningLabel}.` : "Orders stay off until someone switches them back on.";
  const due =
    preview.ordersStillDue === 0
      ? "No orders are waiting."
      : `${preview.ordersStillDue} ${preview.ordersStillDue === 1 ? "order is" : "orders are"} still due. Closing does not cancel ${preview.ordersStillDue === 1 ? "it" : "them"}; call the customer if you can't make ${preview.ordersStillDue === 1 ? "it" : "them"}.`;
  return [restart, due];
}

/**
 * The visible answer when a Pause changed nothing because a pause at least as
 * strict was already in force (god's S4a ruling). Not a screen-reader-only
 * note and not a closed dialog: a cashier who chose "until I switch it back
 * on" must SEE that it was not applied, and whose pause is in force instead.
 */
export function pauseNotAppliedLine(status: StaffOrderingStatus): string | null {
  if (status.state !== "paused") return null;
  const who = status.pausedBy?.name ?? "a staff member";
  const until = status.reopensAtLabel ? `until ${status.reopensAtLabel}` : "until someone switches it back on";
  return `Already closed by ${who} ${until}. Your choice was not applied.`;
}

export type PauseResultView =
  /** The pause is in force and is the one asked for: close the dialog. */
  | { readonly kind: "closed" }
  /** The server's read says the shop is not paused: the click changed nothing. Stay open, say so. */
  | { readonly kind: "not-taken"; readonly message: string }
  /** A pause at least as strict was already in force: this choice was not applied. Stay open, say so. */
  | { readonly kind: "not-applied"; readonly message: string };

/**
 * What the dialog does with a Pause answer that came back ok. Decided from the
 * status the server returned, never from the tap (RULE 1).
 */
export function pauseResultView(result: { readonly changed: boolean; readonly status: StaffOrderingStatus }): PauseResultView {
  if (result.status.state !== "paused") {
    return { kind: "not-taken", message: "That didn't take. The shop is still open for orders. Try again, and tell the owner if it keeps happening." };
  }
  if (!result.changed) return { kind: "not-applied", message: pauseNotAppliedLine(result.status) ?? "Your choice was not applied." };
  return { kind: "closed" };
}

/**
 * The first-screen-of-the-day question for a pause nobody reopened (ops-1 R1),
 * or null when there is nothing to ask. `alreadyAskedToday` is the business
 * date the prompt was last dismissed on, if any: it is asked once a day, not on
 * every reload.
 */
export function morningPrompt(status: StaffOrderingStatus, now: Date, alreadyAskedOn: string | null): string | null {
  if (status.state !== "paused" || !status.carriedOver) return null;
  if (alreadyAskedOn === businessDate(now)) return null;
  const who = status.pausedBy?.name ?? "a staff member";
  const why = status.reason ? ` (${status.reason})` : "";
  const ends = status.reopensAtLabel ? ` It reopens ${status.reopensAtLabel} unless you keep it closed.` : "";
  return `Online orders have been closed since ${sinceLabel(status.pausedAt, now, true)}, by ${who}${why}.${ends} Keep them closed, or open for orders now?`;
}

/** "at 7:42 PM" today, "yesterday at 7:42 PM", or the date for anything older. `bare` drops the leading "at". */
export function sinceLabel(at: Date, now: Date, bare = false): string {
  const clock = formatBusinessClock(at);
  const today = businessDate(now);
  const day = businessDate(at);
  if (day === today) return bare ? clock : `at ${clock}`;
  const yesterday = businessDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  if (day === yesterday) return `yesterday at ${clock}`;
  return `${dayMonth(day)} at ${clock}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * "15 Sep" from a business date. Not `toLocaleDateString`: `en-IN` gives
 * "Sept" on this ICU build and "Sep" on others, the same machine-dependent
 * drift `formatBusinessClock` pins down for times.
 */
function dayMonth(businessDay: string): string {
  const [, month = "1", day = "1"] = businessDay.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? ""}`;
}

/** Storage key for "asked today". Per org, so a device used for two shops keeps them apart. */
export function morningPromptKey(orgId: string): string {
  return `frybird:shop-switch:morning-asked:${orgId}`;
}
