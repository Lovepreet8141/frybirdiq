/**
 * Instants for time-controlled fixtures — pure, no database.
 *
 * IQ-1 parity tests (hive/reviews/iq-1/DESIGN.md, acceptance test) hinge on
 * rows that sit exactly on an IST business-day edge: 23:59:59.999, 00:00,
 * 00:10. Writing those as UTC literals by hand is how D4 happened, so a test
 * names the IST wall clock and this turns it into the instant. Business
 * dates still come only from `src/lib/dates`.
 */
import { businessDate, startOfBusinessDay } from "@/lib/dates";

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{3}))?)?$/;
const MONTH = /^(\d{4})-(\d{2})(?:-01)?$/;

/**
 * The instant at an IST wall-clock time on an IST business date.
 * `istInstant("2026-08-31", "23:59:59.999")` is 2026-08-31T18:29:59.999Z.
 */
export function istInstant(date: string, time = "12:00"): Date {
  if (!DATE.test(date)) throw new Error(`clock: "${date}" is not a YYYY-MM-DD date`);
  const t = TIME.exec(time);
  if (t === null) throw new Error(`clock: "${time}" is not HH:MM[:SS[.mmm]]`);
  const [hours, minutes, seconds, millis] = [t[1], t[2], t[3] ?? "0", t[4] ?? "0"].map(Number) as [number, number, number, number];
  if (hours > 23 || minutes > 59 || seconds > 59) throw new Error(`clock: "${time}" is not a time of day`);

  const at = new Date(startOfBusinessDay(date).getTime() + ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis);
  // Round trip rejects 2026-02-30 and the like, which Date.UTC would roll over.
  if (Number.isNaN(at.getTime()) || businessDate(at) !== date) throw new Error(`clock: "${date}" is not a real date`);
  return at;
}

/** The first day of a month, as `targets.month` stores it, from "2026-09", "2026-09-01" or an instant (its IST month). */
export function monthStart(month: string | Date): string {
  if (month instanceof Date) return `${businessDate(month).slice(0, 7)}-01`;
  const m = MONTH.exec(month);
  if (m === null || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error(`clock: "${month}" is not a month`);
  return `${m[1]}-${m[2]}-01`;
}
