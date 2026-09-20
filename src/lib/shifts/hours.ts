/**
 * Shift hours: the pure part (roadmap 6.4).
 *
 * A factual duration and nothing else. Worked time is the shift length minus
 * the break time recorded inside it, in whole minutes, floored. Whether a
 * break is paid, overtime, rounding and wages are out of scope by owner
 * decision (pay rules will be set later, with an accountant): nothing here
 * encodes any of them. A shift belongs to the IST business day it started on
 * (`shifts.business_date`); an open shift or break counts up to `now`.
 */

import { addDays } from "@/lib/dates";

export interface ShiftSpan {
  readonly userId: string;
  readonly businessDate: string;
  readonly clockInAt: Date;
  readonly clockOutAt: Date | null;
  readonly breaks?: readonly BreakSpan[];
}

export interface BreakSpan {
  readonly startedAt: Date;
  readonly endedAt: Date | null;
}

export interface PersonHours {
  readonly totalMinutes: number;
  readonly byDate: ReadonlyMap<string, number>;
}

/** The longest a single shift may be before a correction is refused as a probable typo. */
export const MAX_SHIFT_HOURS = 24;

const minutesBetween = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));

type Bounds = { readonly clockInAt: Date; readonly clockOutAt: Date | null };

/** Break time inside the shift, in whole minutes. Only the part of a break that lies within the shift counts. */
export function breakMinutes(shift: Bounds, breaks: readonly BreakSpan[], now: Date): number {
  const shiftEnd = (shift.clockOutAt ?? now).getTime();
  const shiftStart = shift.clockInAt.getTime();
  let ms = 0;
  for (const b of breaks) {
    const start = Math.max(b.startedAt.getTime(), shiftStart);
    const end = Math.min((b.endedAt ?? now).getTime(), shiftEnd);
    if (end > start) ms += end - start;
  }
  return Math.floor(ms / 60_000);
}

/** Shift length minus break time, never below zero. */
export function workedMinutes(shift: Bounds, breaks: readonly BreakSpan[], now: Date): number {
  return Math.max(0, minutesBetween(shift.clockInAt, shift.clockOutAt ?? now) - breakMinutes(shift, breaks, now));
}

export function summariseHours(shifts: readonly ShiftSpan[], now: Date): ReadonlyMap<string, PersonHours> {
  const people = new Map<string, { total: number; byDate: Map<string, number> }>();
  for (const shift of shifts) {
    const minutes = workedMinutes(shift, shift.breaks ?? [], now);
    const person = people.get(shift.userId) ?? { total: 0, byDate: new Map<string, number>() };
    person.total += minutes;
    person.byDate.set(shift.businessDate, (person.byDate.get(shift.businessDate) ?? 0) + minutes);
    people.set(shift.userId, person);
  }
  return new Map([...people].map(([id, p]) => [id, { totalMinutes: p.total, byDate: p.byDate }]));
}

/** The Monday on or before a business date. Weeks run Monday to Sunday. */
export function weekStart(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

export function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function validateCorrection(clockInAt: Date, clockOutAt: Date | null, now: Date): { ok: true } | { ok: false; error: string } {
  if (clockInAt.getTime() > now.getTime()) return { ok: false, error: "Clock-in can't be in the future." };
  if (clockOutAt) {
    if (clockOutAt.getTime() > now.getTime()) return { ok: false, error: "Clock-out can't be in the future." };
    if (clockOutAt.getTime() <= clockInAt.getTime()) return { ok: false, error: "Clock-out must be after clock-in." };
    if (clockOutAt.getTime() - clockInAt.getTime() > MAX_SHIFT_HOURS * 3_600_000) {
      return { ok: false, error: `A shift can't be longer than ${MAX_SHIFT_HOURS} hours. Check the dates.` };
    }
  }
  return { ok: true };
}

/** A `datetime-local` value ("2026-09-16T09:30") is Ambala time, whatever the server's zone. */
export function parseIstLocal(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+05:30`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The inverse, for prefilling a `datetime-local` input. */
export function formatIstLocal(date: Date): string {
  const shifted = new Date(date.getTime() + (5 * 60 + 30) * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/** A corrected break must lie inside its shift, in order, and not in the future. */
export function validateBreakCorrection(shift: Bounds, startedAt: Date, endedAt: Date | null, now: Date): { ok: true } | { ok: false; error: string } {
  if (startedAt.getTime() < shift.clockInAt.getTime()) return { ok: false, error: "A break can't start before the shift." };
  if (startedAt.getTime() > now.getTime()) return { ok: false, error: "A break can't start in the future." };
  const end = endedAt;
  if (end) {
    if (end.getTime() <= startedAt.getTime()) return { ok: false, error: "The break must end after it starts." };
    if (end.getTime() > now.getTime()) return { ok: false, error: "A break can't end in the future." };
    if (shift.clockOutAt && end.getTime() > shift.clockOutAt.getTime()) return { ok: false, error: "A break can't end after the shift." };
  } else if (shift.clockOutAt) {
    return { ok: false, error: "A break on a finished shift needs an end time." };
  }
  return { ok: true };
}
