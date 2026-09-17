/**
 * Period keys — which slice of business time one job run covers.
 *
 * hive/reviews/iq-0/DESIGN.md §3. A run is unique per (job, org, period key),
 * so the key must mean the same thing on a UTC server as it does in Ambala:
 * every key is computed in IST. India has no daylight saving, so a fixed
 * +05:30 offset is exact.
 *
 * - hour: "2026-09-17T05"  (the IST hour 05:00–06:00)
 * - day:  "2026-09-17"     (the IST business date)
 * - week: "2026-W38"       (ISO week, Monday start, of the IST date)
 */
export const PERIOD_KINDS = ["hour", "day", "week"] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

/** Which period a run at `now` works on: the one in progress, or the last complete one. */
export type PeriodTarget = "current" | "previous";

/** How far back a manual re-run may reach (DESIGN §3). */
export const MANUAL_RERUN_MAX_DAYS = 14;

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** A Date whose UTC fields read as the IST wall clock. Internal only. */
const istWall = (at: Date) => new Date(at.getTime() + IST_OFFSET_MS);

/** Midnight IST of the Monday of the ISO week containing an IST wall date, as a wall Date. */
function isoWeekMonday(wall: Date): Date {
  const day = wall.getUTCDay() || 7; // Monday 1 … Sunday 7
  return new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() - (day - 1)));
}

function isoWeekOf(wall: Date): { year: number; week: number } {
  const monday = isoWeekMonday(wall);
  const thursday = new Date(monday.getTime() + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1Monday = isoWeekMonday(jan4);
  return { year, week: Math.round((monday.getTime() - week1Monday.getTime()) / (7 * DAY_MS)) + 1 };
}

export function periodKeyAt(kind: PeriodKind, at: Date): string {
  const wall = istWall(at);
  const date = `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`;
  switch (kind) {
    case "hour":
      return `${date}T${pad(wall.getUTCHours())}`;
    case "day":
      return date;
    case "week": {
      const { year, week } = isoWeekOf(wall);
      return `${year}-W${pad(week)}`;
    }
  }
}

const KEY_PATTERN: { readonly [K in PeriodKind]: RegExp } = {
  hour: /^(\d{4})-(\d{2})-(\d{2})T(\d{2})$/,
  day: /^(\d{4})-(\d{2})-(\d{2})$/,
  week: /^(\d{4})-W(\d{2})$/,
};

export type PeriodBounds = { readonly start: Date; readonly end: Date };

/** Start (inclusive) and end (exclusive) of a period, or null if the key is not a real period of that kind. */
export function periodBounds(kind: PeriodKind, key: string): PeriodBounds | null {
  const match = KEY_PATTERN[kind].exec(key);
  if (match === null) return null;
  const n = match.slice(1).map(Number);

  let wallStart: number;
  let lengthMs: number;
  switch (kind) {
    case "hour":
      wallStart = Date.UTC(n[0]!, n[1]! - 1, n[2]!, n[3]!);
      lengthMs = HOUR_MS;
      break;
    case "day":
      wallStart = Date.UTC(n[0]!, n[1]! - 1, n[2]!);
      lengthMs = DAY_MS;
      break;
    case "week":
      wallStart = isoWeekMonday(new Date(Date.UTC(n[0]!, 0, 4))).getTime() + (n[1]! - 1) * 7 * DAY_MS;
      lengthMs = 7 * DAY_MS;
      break;
  }
  const start = new Date(wallStart - IST_OFFSET_MS);
  // Round trip rejects 2026-02-30, hour 24, week 54 and the like.
  if (periodKeyAt(kind, start) !== key) return null;
  return { start, end: new Date(start.getTime() + lengthMs) };
}

/** The key `steps` periods before (negative) or after (positive) `key`. */
export function shiftPeriod(kind: PeriodKind, key: string, steps: number): string {
  const bounds = periodBounds(kind, key);
  if (bounds === null) throw new Error(`not a ${kind} period key`);
  const lengthMs = bounds.end.getTime() - bounds.start.getTime();
  // Hours, days and ISO weeks are fixed length in IST, so stepping by length is exact.
  return periodKeyAt(kind, new Date(bounds.start.getTime() + steps * lengthMs));
}

/** The period a scheduled run at `now` works on. */
export function targetPeriod(kind: PeriodKind, target: PeriodTarget, now: Date): string {
  const current = periodKeyAt(kind, now);
  return target === "current" ? current : shiftPeriod(kind, current, -1);
}

/**
 * The periods one scheduled run should claim, oldest first: up to
 * `catchUpPeriods` earlier periods, then the target. Periods that already
 * succeeded come back from the claim as NOOP, so listing them is cheap.
 */
export function scheduledPeriods(kind: PeriodKind, target: PeriodTarget, catchUpPeriods: number, now: Date): string[] {
  const last = targetPeriod(kind, target, now);
  const keys: string[] = [];
  for (let step = catchUpPeriods; step >= 1; step--) keys.push(shiftPeriod(kind, last, -step));
  keys.push(last);
  return keys;
}

export type ManualPeriodCheck =
  | { readonly ok: true; readonly key: string }
  | { readonly ok: false; readonly reason: "MALFORMED" | "IN_FUTURE" | "TOO_OLD" };

/** A period asked for by hand: a real key, not after the scheduled target, starting at most 14 days back. */
export function checkManualPeriod(kind: PeriodKind, target: PeriodTarget, key: string, now: Date): ManualPeriodCheck {
  const bounds = periodBounds(kind, key);
  if (bounds === null) return { ok: false, reason: "MALFORMED" };
  const latest = periodBounds(kind, targetPeriod(kind, target, now))!;
  if (bounds.start.getTime() > latest.start.getTime()) return { ok: false, reason: "IN_FUTURE" };
  if (bounds.start.getTime() < now.getTime() - MANUAL_RERUN_MAX_DAYS * DAY_MS) return { ok: false, reason: "TOO_OLD" };
  return { ok: true, key };
}
