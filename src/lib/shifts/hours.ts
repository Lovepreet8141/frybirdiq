/**
 * Shift hours — the pure part (roadmap 6.4).
 *
 * Basic on purpose: hours are clock-out minus clock-in. No breaks, no
 * overtime, no wages — those are owner decisions not yet made. A shift belongs
 * to the IST business day it started on (`shifts.business_date`); an open
 * shift counts up to `now`.
 */

import { addDays } from "@/lib/dates";

export interface ShiftSpan {
  readonly userId: string;
  readonly businessDate: string;
  readonly clockInAt: Date;
  readonly clockOutAt: Date | null;
}

export interface PersonHours {
  readonly totalMinutes: number;
  readonly byDate: ReadonlyMap<string, number>;
}

/** The longest a single shift may be before a correction is refused as a probable typo. */
export const MAX_SHIFT_HOURS = 24;

const minutesBetween = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));

export function summariseHours(shifts: readonly ShiftSpan[], now: Date): ReadonlyMap<string, PersonHours> {
  const people = new Map<string, { total: number; byDate: Map<string, number> }>();
  for (const shift of shifts) {
    const minutes = minutesBetween(shift.clockInAt, shift.clockOutAt ?? now);
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
