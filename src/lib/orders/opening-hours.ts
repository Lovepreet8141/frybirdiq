/**
 * When the shop is open, in one place.
 *
 * The rule was already written down once, inside the scheduling picker: a
 * day's opening and closing are `openingTime`/`closingTime` (both "HH:MM" on
 * `organizations`) resolved onto a business date with `timeOnBusinessDate`.
 * Only the SCHEDULED branch of `placeOrder` ever consulted it, so an ASAP
 * order at 2am was accepted with nobody in the kitchen (launch audit C1 /
 * P0-3a). Rather than write a second answer to "are we open" next to the ASAP
 * branch, the window lives here and every caller reads it — the ASAP gate, the
 * scheduled-time validator, the picker, and the website's open/closed chip.
 *
 * Pure: no database, no ambient clock. `now` is always passed in, so every
 * boundary is testable and the server's own clock is the only clock that
 * decides. The hours themselves are never defined here — they arrive from the
 * org row, which is the owner's to set.
 *
 * A trading day may run past midnight. `openHoursSpan` in `@/lib/dates`
 * already says so — it wraps when closing is not after opening, and is tested
 * for it — and `getSmart86Projections` and `inventoryAvailability` both size
 * their windows with it. An earlier version of this file did NOT wrap, and
 * cited those two functions as the precedent for not wrapping, which had it
 * exactly backwards. The cost was not theoretical: with hours saved as
 * 18:00–02:00, `isOpenAt` was false at all 24 hours of the day, so ASAP was
 * refused around the clock while Smart 86 and inventory carried on treating
 * the shop as open eight hours a day. Wrapping here is what keeps those
 * screens telling one story, and `updateBusinessProfile` (settings.ts) writes
 * both times straight from two `<input type="time">` fields with no check that
 * closing is after opening, so overnight hours are one form submission away
 * for an owner who never tells anybody.
 */

import { BUSINESS_TIMEZONE, addDays, businessDate, timeOnBusinessDate } from "@/lib/dates";

/**
 * Just the two fields, so `asapRefusal` can take an org row whole.
 *
 * The functions below keep their two explicit `"HH:MM"` arguments rather than
 * moving to this shape: that signature is already published to the customer
 * site's open/closed helper, and quietly changing a contract another agent has
 * built against costs more than the symmetry is worth.
 */
export interface OpeningHours {
  readonly openingTime: string;
  readonly closingTime: string;
}

export interface BusinessHoursWindow {
  /** First instant of the session that starts on that business date. Inclusive. */
  readonly opening: Date;
  /** Its closing instant. Exclusive — 23:00 sharp is shut. On the next day when the session runs past midnight. */
  readonly closing: Date;
}

/**
 * One trading session: the one that *starts* on `date`.
 *
 * When closing is not after opening the session runs past midnight and closing
 * lands on the following day — the same rule, and the same `<=` boundary, as
 * `openHoursSpan`, so an 18:00–02:00 day is eight hours here too and an
 * opening equal to its closing is a full 24 (which is how that function reads
 * "09:00–09:00", and disagreeing would be worse than either answer).
 */
export function businessHoursWindow(date: string, openingTime: string, closingTime: string): BusinessHoursWindow {
  const opening = timeOnBusinessDate(date, openingTime);
  const sameDayClosing = timeOnBusinessDate(date, closingTime);
  const closing = sameDayClosing.getTime() <= opening.getTime() ? timeOnBusinessDate(addDays(date, 1), closingTime) : sameDayClosing;
  return { opening, closing };
}

function contains(window: BusinessHoursWindow, at: Date): boolean {
  return at.getTime() >= window.opening.getTime() && at.getTime() < window.closing.getTime();
}

/**
 * Whether the kitchen is open at this instant.
 *
 * Two sessions can contain one instant: the one that starts on its own
 * business date, and the one that started the day before and has not closed
 * yet. Checking both is what makes 00:30 "open" under 18:00–02:00 hours —
 * looking only at today's session is how the overnight case came to refuse
 * every hour of the day. For hours that do not cross midnight the previous
 * day's session closed yesterday and the extra check can never match, so
 * 11:30–23:00 behaves exactly as before.
 *
 * Open is inclusive, closing is exclusive. Used for a requested time as well
 * as for `now`, so ASAP and "choose a time" cannot refuse each other's edge.
 */
export function isOpenAt(at: Date, openingTime: string, closingTime: string): boolean {
  const date = businessDate(at);
  return (
    contains(businessHoursWindow(date, openingTime, closingTime), at) ||
    contains(businessHoursWindow(addDays(date, -1), openingTime, closingTime), at)
  );
}

export interface NextOpening {
  readonly at: Date;
  /** Whether `at` is later today or the next business day — what a customer-facing message needs to say. */
  readonly day: "TODAY" | "TOMORROW";
}

/**
 * The next instant the shop opens, for telling a customer when to come back.
 *
 * Called only when closed, so there are two cases: before this business date's
 * opening (come back later today) or after it (tomorrow). Under overnight
 * hours every closed instant falls before that date's opening — 02:00 to 18:00
 * on the same business date — so this answers TODAY throughout, which is the
 * true answer and the reason the refusal message stops saying "tomorrow" for
 * ever. Tomorrow's window is computed from the same hours: this build has one
 * schedule for every day, so a per-weekday one would change this function and
 * nothing else.
 */
export function nextOpening(now: Date, openingTime: string, closingTime: string): NextOpening {
  const today = businessDate(now);
  const { opening } = businessHoursWindow(today, openingTime, closingTime);
  if (now.getTime() < opening.getTime()) return { at: opening, day: "TODAY" };
  return { at: businessHoursWindow(addDays(today, 1), openingTime, closingTime).opening, day: "TOMORROW" };
}

/**
 * Why an order was refused, when the reason is a state of the shop rather than
 * a mistake in the form.
 *
 * `error` alone is a sentence; this is the same refusal as data, so the
 * customer-facing layer can render an open/closed state (a chip, a "we open at
 * 11:30" line, a disabled button) instead of parsing prose. Re-exported from
 * `@/lib/repositories/orders`, which is where callers import it from.
 */
export interface ShopClosedRefusal {
  readonly code: "CLOSED";
  /** The org's configured hours, "HH:MM" in Asia/Kolkata. Read, never decided here. */
  readonly openingTime: string;
  readonly closingTime: string;
  /** The next instant the shop opens, as an ISO string — a Date does not survive the Server Action boundary. */
  readonly opensAt: string;
  /** Whether `opensAt` is later today or the next day. */
  readonly opensDay: "TODAY" | "TOMORROW";
  /** Ready to print: "today at 11:30 AM" / "tomorrow at 11:30 AM", in the business's own timezone. */
  readonly opensAtLabel: string;
}

/**
 * The whole ASAP decision, as one pure function: `null` when the shop is open
 * and the order may proceed, a refusal when it may not.
 *
 * Lifted out of `placeOrder` so it can be tested. The wall-clock label
 * especially: it goes through `toLocaleTimeString`, whose exact output ("11:30
 * AM" against "11:30 am", and the space before it) varies by ICU build, and an
 * assertion here is the only thing that notices if that changes underneath us.
 * What is left at the call site is one line, which is as small as the untested
 * surface can honestly get while `placeOrder` needs cookie-scoped cart state.
 */
export function asapRefusal(now: Date, { openingTime, closingTime }: OpeningHours): ShopClosedRefusal | null {
  if (isOpenAt(now, openingTime, closingTime)) return null;

  const opens = nextOpening(now, openingTime, closingTime);
  const label = `${opens.day === "TODAY" ? "today" : "tomorrow"} at ${formatBusinessClock(opens.at)}`;
  return {
    code: "CLOSED",
    openingTime,
    closingTime,
    opensAt: opens.at.toISOString(),
    opensDay: opens.day,
    opensAtLabel: label,
  };
}

/**
 * A wall-clock time in the business's timezone, as "11:30 AM". The one
 * formatter for a customer-facing clock time — the schedule picker's slot
 * labels come through here too.
 *
 * Only the timezone and the digits come from ICU. Everything a build could
 * decide differently is pinned:
 *
 * - `hour12: true`, because `hour: "numeric"` alone leaves the 12-or-24-hour
 *   choice to locale resolution. An ICU build that resolved `en-IN` to h23
 *   would render "18:00", with no meridiem to normalise, and a test asserting
 *   "6:00 PM" would pass on one machine and fail on another.
 * - the meridiem case, because this build renders "am" lowercase.
 * - the whitespace, because this build emits a narrow no-break space (U+202F)
 *   before the meridiem, which `\s` does match under the `u` flag.
 *
 * With all three fixed the string cannot vary between a laptop, CI and the
 * deployed server — which is the only reason it is safe to assert in a test at
 * all. Before this there were three formatters drifting apart: this one, the
 * picker's, and the website's own `clockLabel`. The first two are now the same
 * function; `clockLabel` lives on the customer site's branch and renders
 * "11:30 AM" by hand, so the two should be reconciled at that merge.
 */
export function formatBusinessClock(at: Date): string {
  return at
    .toLocaleTimeString("en-IN", { timeZone: BUSINESS_TIMEZONE, hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\s+/gu, " ")
    .replace(/\b(am|pm)\b/iu, (meridiem) => meridiem.toUpperCase());
}
