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
import { type ClosedDay, type Closures, NO_CLOSURES, WEEKDAY_NAMES, closedDay, isClosedDay, weekdayOf } from "./closures";

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
  /**
   * The weekly off day and the planned closed dates (ops-3). Optional here only
   * so a caller with just the two times still compiles; `ShopStatus`, which
   * every ordering gate reads, requires it.
   */
  readonly closures?: Closures;
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
export function isOpenAt(at: Date, openingTime: string, closingTime: string, closures: Closures = NO_CLOSURES): boolean {
  return sessionStartDate(at, openingTime, closingTime, closures) !== null;
}

/**
 * The business date of the session that contains `at`, or null when the shop is
 * shut then. The date a night's trade *belongs* to, in other words, which is not
 * always the calendar date the clock reads.
 *
 * This is what a horizon has to compare against. `scheduleDays` keys its days
 * by the date a session STARTS on, so under 18:00–02:00 hours the last day it
 * offers runs past midnight and its post-midnight slots carry a calendar date
 * one day beyond the horizon — measured, a quarter of that day's slots were
 * generated by the picker and then refused by the validator as out of range,
 * with the shop open at every one of them. Asking which session a time belongs
 * to answers both questions at once, so the two cannot drift apart again.
 *
 * Where sessions do not cross midnight, the session's start date and the
 * candidate's own date are the same string, so this changes nothing for
 * 11:30–23:00.
 */
export function sessionStartDate(at: Date, openingTime: string, closingTime: string, closures: Closures = NO_CLOSURES): string | null {
  const date = businessDate(at);
  // A session on a closed day (the weekly off day, a planned closure) does not count: the shop is shut for all of it.
  if (contains(businessHoursWindow(date, openingTime, closingTime), at) && !isClosedDay(date, closures)) return date;
  const previous = addDays(date, -1);
  if (contains(businessHoursWindow(previous, openingTime, closingTime), at) && !isClosedDay(previous, closures)) return previous;
  return null;
}

export interface NextOpening {
  readonly at: Date;
  /** The business date the shop opens on. */
  readonly date: string;
  /** Later today, the next business day, or further out (a day off or a planned closure in between). */
  readonly day: "TODAY" | "TOMORROW" | "LATER";
}

/**
 * How far ahead `nextOpening` looks for an open day. Closed dates can only be
 * added a year ahead and run at most 31 days, and at most six weekdays can be
 * closed, so an open day always turns up well inside this; running out means
 * the closures were edited around those rules, and throwing is better than
 * promising a customer a time nobody set.
 */
const OPENING_SCAN_DAYS = 800;

/**
 * The first instant the shop opens on or after `fromDate`, skipping every
 * closed day. `fromDate` itself counts when it is open.
 */
export function openingOnOrAfter(fromDate: string, openingTime: string, closingTime: string, closures: Closures = NO_CLOSURES): { readonly at: Date; readonly date: string } {
  for (let offset = 0; offset < OPENING_SCAN_DAYS; offset += 1) {
    const date = addDays(fromDate, offset);
    if (!isClosedDay(date, closures)) return { at: businessHoursWindow(date, openingTime, closingTime).opening, date };
  }
  throw new Error("nextOpening: no open day found; the closures leave the shop never opening");
}

/**
 * The next instant the shop opens, for telling a customer when to come back.
 *
 * Called only when closed. Before this date's opening, on a day that is open,
 * the answer is later today. Otherwise it is the first open day after today, so
 * Monday night with Tuesday off answers Wednesday, and a planned closure over
 * Diwali answers the day after it ends. Under overnight hours every closed
 * instant falls before that date's opening, so this answers TODAY throughout,
 * which is the true answer.
 */
export function nextOpening(now: Date, openingTime: string, closingTime: string, closures: Closures = NO_CLOSURES): NextOpening {
  const today = businessDate(now);
  const { opening } = businessHoursWindow(today, openingTime, closingTime);
  if (now.getTime() < opening.getTime() && !isClosedDay(today, closures)) return { at: opening, date: today, day: "TODAY" };
  const next = openingOnOrAfter(addDays(today, 1), openingTime, closingTime, closures);
  return { ...next, day: next.date === addDays(today, 1) ? "TOMORROW" : "LATER" };
}

/**
 * A day, the way a customer says it: "today", "tomorrow", "Wednesday" within the
 * week, and "Saturday 4 October" beyond it (a bare weekday name a week or more
 * out would read as the nearer one).
 */
export function dayPhrase(date: string, todayDate: string): string {
  if (date === todayDate) return "today";
  if (date === addDays(todayDate, 1)) return "tomorrow";
  const name = WEEKDAY_NAMES[weekdayOf(date)];
  for (let ahead = 2; ahead <= 6; ahead += 1) if (date === addDays(todayDate, ahead)) return name;
  const [, month, day] = date.split("-").map(Number);
  return `${name} ${day} ${MONTH_NAMES[(month ?? 1) - 1]}`;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** "tomorrow at 11:30 AM" / "Wednesday at 11:30 AM": when a customer may come back. */
export function opensAtPhrase(opening: NextOpening, now: Date): string {
  return `${dayPhrase(opening.date, businessDate(now))} at ${formatBusinessClock(opening.at)}`;
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
  /** Whether `opensAt` is later today, the next day, or further out. */
  readonly opensDay: "TODAY" | "TOMORROW" | "LATER";
  /** Ready to print: "today at 11:30 AM" / "tomorrow at 11:30 AM" / "Wednesday at 11:30 AM", in the business's own timezone. */
  readonly opensAtLabel: string;
  /** Set when TODAY is a whole closed day (weekly off day or planned closure), with the owner's public note if there is one. */
  readonly dayOff: ClosedDay | null;
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
export function asapRefusal(now: Date, { openingTime, closingTime, closures }: OpeningHours): ShopClosedRefusal | null {
  if (isOpenAt(now, openingTime, closingTime, closures)) return null;

  const opens = nextOpening(now, openingTime, closingTime, closures);
  return {
    code: "CLOSED",
    openingTime,
    closingTime,
    opensAt: opens.at.toISOString(),
    opensDay: opens.day,
    opensAtLabel: opensAtPhrase(opens, now),
    dayOff: closedDay(businessDate(now), closures),
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

/**
 * Ordering paused by hand — the Close Shop switch (ops-1).
 *
 * A power cut or a kitchen fire does not change the trading hours, so the
 * hours are left alone and this sits on top of them: while paused, nothing
 * can be ordered online, whatever the clock says.
 *
 * Deliberately NOT a variant of `ShopClosedRefusal`, and deliberately not
 * called "closed". The checkout form reads `closed` as "the hours say no, so
 * move the customer onto Choose a time" (`checkout-form.tsx`, `asapOk`), and
 * the copy it renders from it ends "Choose a time to order ahead." A paused
 * shop refuses scheduled orders too, so reusing that refusal would send the
 * customer to a choice that is refused in turn — the same dead escape hatch
 * RELIABILITY found under overnight hours. A distinct code keeps the two
 * states apart at every layer, and a form that does not know about it yet
 * falls back to the plain `error` sentence, which is safe.
 *
 * Carries nothing about why. The reason staff type when they pause ("gas
 * leak", a name) is for staff and the audit trail; it never reaches a
 * customer, so it is not in the refusal at all.
 */
export interface ShopPausedRefusal {
  readonly code: "PAUSED";
}

/** Everything the ordering gate needs to know about the shop: its hours, and whether someone has paused it. */
export interface ShopStatus extends OpeningHours {
  /** The weekly off day and planned closures, from the org row and `closed_dates`. Required: a gate that forgets them opens on a day off. */
  readonly closures: Closures;
  /** When ordering was paused, or null when it is not. From the org row; never from the client. */
  readonly orderingPausedAt: Date | null;
  /**
   * When a timed pause ends by itself ("until we next open"), or null for one
   * that holds until someone switches ordering back on. A pause whose
   * `orderingPausedUntil` has passed is over, even though `orderingPausedAt`
   * is still set in the row: reopening is by time, with no job to clear it.
   */
  readonly orderingPausedUntil: Date | null;
}

/**
 * How long a pause lasts; UNTIL_NEXT_OPENING is the default.
 *
 * - UNTIL_NEXT_OPENING: the next opening from the hours, the very next 11:30.
 * - REST_OF_TODAY: through today, back at the opening of the next open day. The
 *   difference from the one above shows before opening: at 9 am "until next
 *   opening" is 11:30 today, "rest of today" is tomorrow.
 * - UNTIL_DATE: back at the opening of the chosen date (or the next open day after it).
 * - UNTIL_RESUMED: holds until someone switches ordering back on.
 */
export type PauseMode = "UNTIL_NEXT_OPENING" | "UNTIL_RESUMED" | "REST_OF_TODAY" | "UNTIL_DATE";

export type OrderingRefusal =
  | { readonly kind: "PAUSED"; readonly paused: ShopPausedRefusal }
  | { readonly kind: "CLOSED"; readonly closed: ShopClosedRefusal };

/**
 * The whole online-ordering gate: null to proceed, or why not.
 *
 * Paused wins over everything, for ASAP and scheduled alike. The switch has no
 * end time — it holds "until someone reopens" — so no future slot can be
 * promised while it is on: accepting a 9pm order during a 7pm power cut is a
 * bet that someone will remember to reopen by then, and the customer's money
 * is the stake. It also wins over the hours, so a paused shop that is also
 * outside its hours says "paused", not "we open at 11:30" — the second is a
 * promise nobody can keep until the switch is turned back.
 *
 * Not paused, an ASAP order is refused outside the hours (`asapRefusal`); a
 * scheduled one passes here and has its requested time checked by
 * `isValidScheduledTime`, which answers a different question — whether the
 * shop will be open THEN.
 *
 * Why the pause lives here and not inside `isOpenAt`: "paused" is a fact about
 * now, not about an instant. `isOpenAt` is asked about future times by the
 * scheduler; folding the switch into it would make "is 9pm tomorrow within
 * hours" answer no because of a power cut this afternoon, and would change a
 * signature the customer site's helper is built against.
 */
export function orderingRefusal(now: Date, shop: ShopStatus, when: "ASAP" | "SCHEDULED"): OrderingRefusal | null {
  if (isPaused(shop, now)) return { kind: "PAUSED", paused: { code: "PAUSED" } };
  if (when === "SCHEDULED") return null;
  const closed = asapRefusal(now, shop);
  return closed ? { kind: "CLOSED", closed } : null;
}

/**
 * Whether the switch is on — and, on purpose, NOT when the value is missing.
 *
 * The type says `Date | null`, but a value can still arrive `undefined` at run
 * time: an org object mapped field by field that forgets the new column
 * (`getOrg` in org.ts builds its object that way), or a field lost crossing a
 * serialisation boundary. `!== null` would read that as PAUSED, and the result
 * is a total outage nobody asked for — every customer told "paused", nothing
 * erroring, found only when takings drop (RELIABILITY, ops-1 req 4).
 *
 * The two ways this can fail are not equal. Missing-reads-as-open fails at the
 * moment someone presses Pause, in front of them, and the deploy check
 * ("pause, then confirm the site refuses") catches it. Missing-reads-as-paused
 * fails silently, for everyone, with nobody having touched anything. So a
 * pause has to be a real, present timestamp.
 *
 * THE ONE RULE for "paused right now", which also lives in SQL in two places
 * that must move with it:
 *
 *   ordering_paused_at IS NOT NULL
 *     AND (ordering_paused_until IS NULL OR ordering_paused_until > now())
 *
 * — the compare-and-set that pauses and resumes (shop-status.ts), and the
 * 0039 down script's refusal to run while a shop is paused. Checking
 * `ordering_paused_at IS NOT NULL` alone is wrong everywhere: a timed pause
 * that has already reopened leaves `ordering_paused_at` set, so that test
 * would refuse to pause a shop that is open, and would block a rollback for
 * ever. Closing is exclusive, like the hours: at `orderingPausedUntil` exactly
 * the shop is taking orders again.
 */
export function isPaused(shop: ShopStatus, now: Date): boolean {
  if (!(shop.orderingPausedAt instanceof Date)) return false;
  // Bounded only by a real instant. A missing `orderingPausedUntil` next to a
  // real `orderingPausedAt` leaves the pause holding: someone did press Pause,
  // and failing toward the thing they asked for is right here, unlike above.
  if (!(shop.orderingPausedUntil instanceof Date)) return true;
  return now.getTime() < shop.orderingPausedUntil.getTime();
}

/**
 * Whether a pause has carried over into a new trading day — the
 * forgot-to-reopen case, which is the likeliest real way this switch hurts the
 * shop (ops-1 R1).
 *
 * True when the pause began before the opening of today's session: someone
 * paused yesterday evening, the power came back, and nobody reopened. The POS
 * uses it to turn the first screen of the day into a decision — keep paused,
 * or resume — instead of a banner that has been there so long nobody reads it.
 *
 * True before opening as well as after, on purpose. The first POS load of the
 * day is usually the morning set-up, before 11:30, and that is the best moment
 * to decide: before the first customer is refused, not after. A pause set this
 * morning before opening also counts; prompting again is harmless, and
 * showing the prompt once per day is the POS's job, not this function's.
 */
export function pauseCarriedOver(shop: ShopStatus, now: Date): boolean {
  if (!isPaused(shop, now) || !(shop.orderingPausedAt instanceof Date)) return false;
  const { opening } = businessHoursWindow(businessDate(now), shop.openingTime, shop.closingTime);
  return shop.orderingPausedAt.getTime() < opening.getTime();
}

/**
 * When a pause made now, in this mode, ends by itself — `ordering_paused_until`.
 *
 * UNTIL_NEXT_OPENING is the next opening instant from the trading hours, the
 * same `nextOpening` the closed-by-hours refusal uses, computed at the moment
 * of pausing on the server's clock. UNTIL_RESUMED has no end: null.
 *
 * Read the edge before you rely on the default. Paused during trading hours
 * (7 pm, a kitchen fire) it ends at tomorrow's opening, which is what anyone
 * means. Paused BEFORE opening (9 am, the fryer broken) it ends at 11:30
 * TODAY — so the default pause does nothing the hours were not already doing,
 * and orders flow at 11:30 into the kitchen that was broken. No rule on the
 * clock alone can tell that case from a 1 am pause after a late close, which
 * genuinely does mean "until 11:30 today": both are "before today's opening".
 * So this returns the literal next opening, and the answer lives in the UI: the
 * confirm must say, in words, "Orders restart today at 11:30 AM", so the
 * person pausing sees it and chooses UNTIL_RESUMED if that is not what they
 * mean.
 */
export function pausedUntilFor(mode: PauseMode, now: Date, openingTime: string, closingTime: string, closures: Closures = NO_CLOSURES, untilDate?: string): Date | null {
  switch (mode) {
    case "UNTIL_RESUMED":
      return null;
    case "UNTIL_NEXT_OPENING":
      return nextOpening(now, openingTime, closingTime, closures).at;
    case "REST_OF_TODAY":
      return openingOnOrAfter(addDays(businessDate(now), 1), openingTime, closingTime, closures).at;
    case "UNTIL_DATE": {
      if (!untilDate) throw new Error("pausedUntilFor: UNTIL_DATE needs a date");
      // Never earlier than tomorrow: "until today" is not a reopening.
      const from = untilDate > businessDate(now) ? untilDate : addDays(businessDate(now), 1);
      return openingOnOrAfter(from, openingTime, closingTime, closures).at;
    }
  }
}
