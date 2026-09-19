/**
 * "Choose a time" for an online order — an alternative to ASAP.
 *
 * Pure, so every rule here (lead time, hours, the rollover from today to
 * tomorrow) is testable without a database or a server clock. The checkout
 * form uses `scheduleDays` to build the picker for display only; `placeOrder`
 * re-validates whatever the client sends with `isValidScheduledTime` against
 * the server's own clock and the org's real hours — a client's computed slot
 * list is a suggestion, never a fact the server trusts (§ "never trust the
 * client for money or authorization" applies just as much to a time).
 */

import { addDays, businessDate } from "@/lib/dates";
import { type Closures, NO_CLOSURES, closedDay } from "@/lib/orders/closures";
import { businessHoursWindow, formatBusinessClock, sessionStartDate } from "@/lib/orders/opening-hours";

/** Shortest notice a scheduled order gets, same idea as a kitchen needing warning before an ASAP ticket lands. */
export const MIN_LEAD_MINUTES = 20;

/** Slot grid for the picker. A time need not land exactly on one to be valid server-side — this only shapes what the picker offers. */
export const SLOT_INTERVAL_MINUTES = 15;

/** How many business days ahead scheduling is offered — today and tomorrow, not an open-ended calendar. */
export const SCHEDULE_DAYS_AHEAD = 1;

export interface TimeSlot {
  readonly at: Date;
  /** "1:45 PM", in the business's own timezone — computed once here so the form and its validation never disagree on wall-clock time. */
  readonly label: string;
}

export interface ScheduleDay {
  readonly date: string;
  readonly label: string;
  readonly slots: readonly TimeSlot[];
  /** The weekly off day or a planned closure: no slots, and the picker says "closed", not "no times left". */
  readonly closed: boolean;
}

function dayLabel(date: string, today: string, tomorrow: string): string {
  if (date === today) return "Today";
  if (date === tomorrow) return "Tomorrow";
  return date;
}

/** Rounds an instant forward to the next slot boundary. */
function roundUpToSlot(at: Date): Date {
  const ms = SLOT_INTERVAL_MINUTES * 60_000;
  return new Date(Math.ceil(at.getTime() / ms) * ms);
}

/**
 * Every slot a customer may pick for one business date — from whichever is
 * later of opening time or (now + lead time), up to closing, on the slot
 * grid. Empty when the day is already closed for scheduling (e.g. asking for
 * "today" after closing minus the lead time has already passed) — the
 * rollover to tomorrow the roadmap asks for is just this array being empty.
 */
function slotsForDay(date: string, now: Date, openingTime: string, closingTime: string, closures: Closures): readonly TimeSlot[] {
  // A closed day offers nothing, whatever the hours say.
  if (closedDay(date, closures)) return [];
  const { opening, closing } = businessHoursWindow(date, openingTime, closingTime);
  const earliest = new Date(Math.max(opening.getTime(), now.getTime() + MIN_LEAD_MINUTES * 60_000));
  const first = roundUpToSlot(earliest);

  const slots: TimeSlot[] = [];
  for (let at = first; at.getTime() < closing.getTime(); at = new Date(at.getTime() + SLOT_INTERVAL_MINUTES * 60_000)) {
    slots.push({ at, label: formatBusinessClock(at) });
  }
  return slots;
}

/**
 * The days the picker offers — today and tomorrow, each with its own valid
 * slots. A day with zero slots (today, asked for right at closing) is still
 * listed so the picker can show "No times left today" rather than the day
 * silently vanishing — but the caller should skip straight to the next day
 * when today is empty, which is the actual rollover behaviour.
 */
export function scheduleDays(now: Date, openingTime: string, closingTime: string, closures: Closures = NO_CLOSURES): readonly ScheduleDay[] {
  const today = businessDate(now);
  const tomorrow = addDays(today, 1);
  const dates = Array.from({ length: SCHEDULE_DAYS_AHEAD + 1 }, (_, i) => addDays(today, i));

  return dates.map((date) => ({
    date,
    label: dayLabel(date, today, tomorrow),
    slots: slotsForDay(date, now, openingTime, closingTime, closures),
    closed: closedDay(date, closures) !== null,
  }));
}

/**
 * The server-side check. Re-derives the same window `scheduleDays` offers
 * and asks only whether `candidate` falls inside it — never trusts that the
 * client picked from a list this process actually generated.
 *
 * Deliberately not slot-grid-aligned: the real rules are the lead time, the
 * day's opening/closing hours, and the two-day horizon. Requiring exact
 * alignment to `SLOT_INTERVAL_MINUTES` would reject a legitimate time for a
 * reason that has nothing to do with whether the kitchen can honour it.
 */
export function isValidScheduledTime(candidate: Date, now: Date, openingTime: string, closingTime: string, closures: Closures = NO_CLOSURES): boolean {
  if (Number.isNaN(candidate.getTime())) return false;
  if (candidate.getTime() < now.getTime() + MIN_LEAD_MINUTES * 60_000) return false;

  // Which trading session the requested time falls in — null when the shop is
  // shut then, which refuses it. One question instead of two, and the same
  // answer `scheduleDays` keys its days by, so the picker and this check cannot
  // offer and refuse the same slot.
  const session = sessionStartDate(candidate, openingTime, closingTime, closures);
  if (session === null) return false;

  /*
   * Bounded by the session's own date, not the candidate's calendar date.
   * Those differ only when a session runs past midnight, and that difference
   * was the whole bug: under 18:00-02:00 hours the last day the picker offers
   * closes at 02:00 the following morning, so its post-midnight slots read as
   * one day past the horizon and were refused after being offered.
   *
   * Only an upper bound. "Not in the past" is already settled by the lead-time
   * check above, and a lower bound on the session date would refuse a real
   * one: at 00:00 under those hours the shop is open on the session that began
   * the previous evening, so a time half an hour away belongs to a session
   * whose date is yesterday's and is perfectly orderable.
   */
  return session <= addDays(businessDate(now), SCHEDULE_DAYS_AHEAD);
}
