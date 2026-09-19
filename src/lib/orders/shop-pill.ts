/**
 * What the status pill in the staff top bar says, worked out without a screen.
 *
 * Input is `StaffOrderingStatus`, the one read the ordering gate also uses
 * (RULE 1); nothing here reads a column or decides a state of its own. Every
 * state is text AND icon AND colour, never colour alone; at 375 px the pill
 * shows the dot plus one word (`short`).
 */

import { addDays, businessDate } from "@/lib/dates";
import { weekdayOf } from "@/lib/orders/closures";
import { formatBusinessClock } from "@/lib/orders/opening-hours";
import type { StaffOrderingStatus } from "@/lib/repositories/shop-status";

export type PillState = "open" | "closed" | "off";

export interface PillView {
  readonly state: PillState;
  readonly dot: "green" | "grey" | "red";
  readonly icon: "check" | "clock" | "pause";
  /** "Open · until 11:00 PM" */
  readonly long: string;
  /** The word left at phone width. */
  readonly short: "Open" | "Closed" | "Off";
}

/** "23:00" -> "11:00 PM". The stored hours are 24-hour "HH:MM" strings. */
export function clockFromHHMM(hhmm: string): string {
  const [h = "0", m = "00"] = hhmm.split(":");
  const hour = Number(h);
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 === 0 ? 12 : hour % 12}:${m.padStart(2, "0")} ${suffix}`;
}

const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * "11:30 AM" on the same business day as `now`, "tomorrow 11:30 AM" the next
 * day, "Wed 11:30 AM" within the week (a day off in between), and
 * "Sat 4 Oct 11:30 AM" beyond it.
 */
export function clockOrTomorrow(at: Date, now: Date): string {
  const clock = formatBusinessClock(at);
  const day = businessDate(at);
  const today = businessDate(now);
  if (day === today) return clock;
  if (day === addDays(today, 1)) return `tomorrow ${clock}`;
  const weekday = SHORT_WEEKDAYS[weekdayOf(day)];
  for (let ahead = 2; ahead <= 6; ahead += 1) if (day === addDays(today, ahead)) return `${weekday} ${clock}`;
  const [, month, dayOfMonth] = day.split("-").map(Number);
  return `${weekday} ${dayOfMonth} ${SHORT_MONTHS[(month ?? 1) - 1]} ${clock}`;
}

export function pillView(status: StaffOrderingStatus, now: Date): PillView {
  if (status.state === "paused") {
    const until = status.reopensAt ? `until ${clockOrTomorrow(status.reopensAt, now)}` : "until switched on";
    return { state: "off", dot: "red", icon: "pause", long: `Orders OFF · ${until}`, short: "Off" };
  }
  if (status.state === "closedByHours") {
    // A whole closed day reads "Closed today · opens Wed 11:30 AM"; closed by the clock stays "Closed · opens …".
    const lead = status.dayOff ? "Closed today" : "Closed";
    return { state: "closed", dot: "grey", icon: "clock", long: `${lead} · opens ${clockOrTomorrow(status.reopensAt, now)}`, short: "Closed" };
  }
  return { state: "open", dot: "green", icon: "check", long: `Open · until ${clockFromHHMM(status.closesAt)}`, short: "Open" };
}

export interface PillDetail {
  /** The one status sentence. */
  readonly statusLine: string;
  /** Only while orders are off: who, when. */
  readonly byLine: string | null;
  /** Only while orders are off: why. */
  readonly reasonLine: string | null;
  readonly hoursLine: string;
  readonly notFinishedLine: string;
  /** Pre-orders booked for a closed day, when there are any. Nothing refuses or cancels them; this makes sure staff see them. */
  readonly closedDayLine: string | null;
}

export function pillDetail(
  status: StaffOrderingStatus,
  now: Date,
  hours: { readonly opens: string; readonly closes: string },
  sinceLabel: (at: Date, now: Date) => string,
): PillDetail {
  const notFinished = status.ordersStillDue;
  const notFinishedLine = notFinished === 0 ? "Orders not finished: none" : `Orders not finished: ${notFinished}`;
  const closedDayLine = status.preOrdersOnClosedDays > 0 ? `Pre-orders booked for a closed day: ${status.preOrdersOnClosedDays}. See Admin → Restaurant.` : null;
  const hoursLine = `Today's hours: ${clockFromHHMM(hours.opens)} – ${clockFromHHMM(hours.closes)}`;

  if (status.state === "paused") {
    const who = status.pausedBy?.name ?? "a staff member";
    return {
      statusLine: status.reopensAt ? `Online orders are switched off until ${clockOrTomorrow(status.reopensAt, now)}.` : "Online orders are switched off until someone switches them back on.",
      byLine: `Switched off by ${who} ${sinceLabel(status.pausedAt, now)}.`,
      reasonLine: status.reason ? `Reason: ${status.reason}` : null,
      hoursLine,
      notFinishedLine,
      closedDayLine,
    };
  }
  if (status.state === "closedByHours") {
    const statusLine = status.dayOff
      ? `Closed all day today${status.dayOff.note ? ` (${status.dayOff.note})` : ""}. Online orders start ${clockOrTomorrow(status.reopensAt, now)}.`
      : `Outside opening hours. Online orders start ${clockOrTomorrow(status.reopensAt, now)}.`;
    return { statusLine, byLine: null, reasonLine: null, hoursLine: status.dayOff ? "Today's hours: closed all day" : hoursLine, notFinishedLine, closedDayLine };
  }
  return { statusLine: `Taking online orders until ${clockFromHHMM(status.closesAt)}.`, byLine: null, reasonLine: null, hoursLine, notFinishedLine, closedDayLine };
}

/** A stable string that changes exactly when the state on screen should: used to re-sync from a fresh server render. */
export function statusSignature(status: StaffOrderingStatus): string {
  if (status.state === "paused") {
    return `paused|${status.pausedAt.getTime()}|${status.reopensAt?.getTime() ?? "-"}|${status.ordersStillDue}|${status.pausedBy?.name ?? "-"}|${status.reason ?? "-"}|${status.preOrdersOnClosedDays}`;
  }
  if (status.state === "closedByHours") {
    return `closed|${status.reopensAt.getTime()}|${status.ordersStillDue}|${status.dayOff ? `off:${status.dayOff.note ?? ""}` : "-"}|${status.preOrdersOnClosedDays}`;
  }
  return `open|${status.closesAt}|${status.ordersStillDue}|${status.preOrdersOnClosedDays}`;
}

/** Announced (polite) when the state changes under the person. */
export function pillAnnouncement(view: PillView): string {
  return view.state === "off" ? `Online orders are now off. ${view.long}.` : view.state === "closed" ? `${view.long}.` : `Online orders are open. ${view.long}.`;
}

/**
 * A double-tap must never confirm a resume: the confirm button only arms this
 * many ms after the confirm step appears.
 */
export const CONFIRM_ARM_MS = 700;
export function confirmArmed(shownAt: number | null, now: number): boolean {
  return shownAt !== null && now - shownAt >= CONFIRM_ARM_MS;
}
