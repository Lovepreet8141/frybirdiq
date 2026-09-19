/**
 * When the shop is open, in one place.
 *
 * The rule was already written down once, inside the scheduling picker: a
 * day's opening and closing are `openingTime`/`closingTime` (both "HH:MM" on
 * `organizations`) resolved onto a business date with `timeOnBusinessDate`.
 * Only the SCHEDULED branch of `placeOrder` ever consulted it, so an ASAP
 * order at 2am was accepted with nobody in the kitchen (launch audit C1 /
 * P0-3a). Rather than write a second answer to "are we open" next to the ASAP
 * branch, the window lives here and both callers read it —
 * `isValidScheduledTime` for a requested time, `isOpenAt` for right now.
 *
 * Pure: no database, no ambient clock. `now` is always passed in, so every
 * boundary is testable and the server's own clock is the only clock that
 * decides. The hours themselves are never defined here — they arrive from the
 * org row, which is the owner's to set.
 */

import { addDays, businessDate, timeOnBusinessDate } from "@/lib/dates";

export interface BusinessHoursWindow {
  /** First instant the shop is open on that business date. Inclusive. */
  readonly opening: Date;
  /** Closing instant. Exclusive — 23:00 sharp is shut. */
  readonly closing: Date;
}

/**
 * One business date's open window.
 *
 * `timeOnBusinessDate` alone, with no overnight-wrap adjustment — the same
 * computation `getSmart86Projections` and `inventoryAvailability` already use.
 * FRYBIRD's real hours (11:30–23:00) never cross midnight, and inventing a
 * stricter rule here that nothing else in the codebase follows would make two
 * screens disagree about the same day.
 */
export function businessHoursWindow(date: string, openingTime: string, closingTime: string): BusinessHoursWindow {
  return { opening: timeOnBusinessDate(date, openingTime), closing: timeOnBusinessDate(date, closingTime) };
}

/**
 * Whether the kitchen is open at this instant.
 *
 * Open is inclusive, closing is exclusive, matching `isValidScheduledTime`
 * exactly: a customer may order at 11:30:00 and may not at 23:00:00. The two
 * paths agreeing on the boundary matters more than which side of the minute
 * the boundary falls on — otherwise ASAP and "choose a time" refuse each
 * other's edge.
 */
export function isOpenAt(now: Date, openingTime: string, closingTime: string): boolean {
  const { opening, closing } = businessHoursWindow(businessDate(now), openingTime, closingTime);
  return now.getTime() >= opening.getTime() && now.getTime() < closing.getTime();
}

export interface NextOpening {
  readonly at: Date;
  /** Whether `at` is later today or the next business day — what a customer-facing message needs to say. */
  readonly day: "TODAY" | "TOMORROW";
}

/**
 * The next instant the shop opens, for telling a customer when to come back.
 *
 * Called only when closed, so there are two cases: before today's opening
 * (come back later today) or at/after today's closing (tomorrow). Tomorrow's
 * window is computed from the same hours — this build has one set of hours for
 * every day, so a per-weekday schedule would change this function and nothing
 * else.
 */
export function nextOpening(now: Date, openingTime: string, closingTime: string): NextOpening {
  const today = businessDate(now);
  const { opening } = businessHoursWindow(today, openingTime, closingTime);
  if (now.getTime() < opening.getTime()) return { at: opening, day: "TODAY" };
  return { at: businessHoursWindow(addDays(today, 1), openingTime, closingTime).opening, day: "TOMORROW" };
}
