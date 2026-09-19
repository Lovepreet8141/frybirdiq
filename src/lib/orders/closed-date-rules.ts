/**
 * The rules for a planned closed date (ops-3), pure so the Admin action, the
 * repository and the tests share one copy. They are also what keeps
 * `nextOpening`'s scan bounded: a year ahead, a month at a time.
 */

import { addDays } from "@/lib/dates";

export const CLOSED_DATE_NOTE_MAX = 120;
/** Only a year ahead, at most a month at a time: what `nextOpening` relies on. */
export const CLOSED_DATE_MAX_AHEAD_DAYS = 365;
export const CLOSED_DATE_MAX_RUN_DAYS = 31;
export const CLOSED_DATE_MAX_ROWS = 60;

/** Whether a "YYYY-MM-DD" is a real calendar date. */
export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d;
}

/** Null when a new closed date is acceptable; the message otherwise. `today` is the business date now. */
export function closedDateProblem(startDate: string, endDate: string, note: string | null, today: string): string | null {
  if (!isRealDate(startDate) || !isRealDate(endDate)) return "Pick a real date.";
  if (endDate < startDate) return "The last day can't be before the first day.";
  if (endDate < today) return "That date has already passed.";
  if (startDate > addDays(today, CLOSED_DATE_MAX_AHEAD_DAYS)) return "Closed dates can be planned a year ahead, no further.";
  if (endDate > addDays(startDate, CLOSED_DATE_MAX_RUN_DAYS - 1)) return `A closure can run up to ${CLOSED_DATE_MAX_RUN_DAYS} days. Add a second one for a longer break.`;
  if (note !== null && (note.length < 1 || note.length > CLOSED_DATE_NOTE_MAX)) return `Keep the note under ${CLOSED_DATE_NOTE_MAX} characters.`;
  return null;
}
