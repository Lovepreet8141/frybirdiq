/**
 * How long the Close Shop switch holds (ops-1 + ops-3): the four choices, their
 * words, and the sentence that says when orders restart. One place, so the POS
 * dialog, the status pill and Admin → Restaurant cannot word them three ways.
 *
 * All but UNTIL_RESUMED reopen by themselves at an opening time worked out on
 * the server (`pausedUntilFor`); nothing here computes a time, it only words the
 * labels the server sent.
 */

import { addDays, businessDate } from "@/lib/dates";
import type { PauseMode } from "./opening-hours";

export const PAUSE_MODE_OPTIONS: readonly { readonly mode: PauseMode; readonly label: string }[] = [
  { mode: "UNTIL_NEXT_OPENING", label: "Until we next open" },
  { mode: "REST_OF_TODAY", label: "Closed for the rest of today" },
  { mode: "UNTIL_DATE", label: "Closed until a date I pick" },
  { mode: "UNTIL_RESUMED", label: "Until I switch it back on" },
];

/** "Closed until a date I pick" reaches at most this far: a longer break is a planned closure, not a switch. */
export const PAUSE_UNTIL_MAX_DAYS = 60;

/** The window a date can be picked from, as business dates: tomorrow to `PAUSE_UNTIL_MAX_DAYS` ahead. */
export function untilDateBounds(now: Date): { readonly min: string; readonly max: string } {
  const today = businessDate(now);
  return { min: addDays(today, 1), max: addDays(today, PAUSE_UNTIL_MAX_DAYS) };
}

/** Null when the date can be used. */
export function untilDateProblem(date: string | undefined | null, now: Date): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Pick the date orders should restart.";
  const [y, m, d] = date.split("-").map(Number);
  const real = new Date(Date.UTC(y!, m! - 1, d!));
  if (real.getUTCFullYear() !== y || real.getUTCMonth() !== m! - 1 || real.getUTCDate() !== d) return "Pick a real date.";
  const { min, max } = untilDateBounds(now);
  if (date < min) return "Pick a day after today. To close for the rest of today, use that choice.";
  if (date > max) return `Pick a date within ${PAUSE_UNTIL_MAX_DAYS} days. For a longer break, add a planned closure in Admin → Restaurant.`;
  return null;
}

/** What the server worked out for each choice, as finished phrases ("tomorrow at 11:30 AM"). */
export interface RestartLabels {
  readonly nextOpeningLabel: string;
  readonly restOfTodayLabel: string;
  /** The label for the date the person picked; null until one is picked. */
  readonly untilDateLabel: string | null;
}

/** "Orders restart Wednesday at 11:30 AM." — or null when the label is not known yet. */
export function restartSentence(mode: PauseMode, labels: RestartLabels): string | null {
  switch (mode) {
    case "UNTIL_RESUMED":
      return "Orders stay off until someone switches them back on.";
    case "UNTIL_NEXT_OPENING":
      return `Orders restart ${labels.nextOpeningLabel}.`;
    case "REST_OF_TODAY":
      return `Orders restart ${labels.restOfTodayLabel}.`;
    case "UNTIL_DATE":
      return labels.untilDateLabel ? `Orders restart ${labels.untilDateLabel}.` : null;
  }
}
