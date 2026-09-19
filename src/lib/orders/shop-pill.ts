/**
 * What the status pill in the staff top bar says, worked out without a screen.
 *
 * Input is `StaffOrderingStatus`, the one read the ordering gate also uses
 * (RULE 1); nothing here reads a column or decides a state of its own. Every
 * state is text AND icon AND colour, never colour alone; at 375 px the pill
 * shows the dot plus one word (`short`).
 */

import { businessDate } from "@/lib/dates";
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

/** "11:30 AM" on the same business day as `now`, otherwise "tomorrow 11:30 AM". */
export function clockOrTomorrow(at: Date, now: Date): string {
  const clock = formatBusinessClock(at);
  return businessDate(at) === businessDate(now) ? clock : `tomorrow ${clock}`;
}

export function pillView(status: StaffOrderingStatus, now: Date): PillView {
  if (status.state === "paused") {
    const until = status.reopensAt ? `until ${clockOrTomorrow(status.reopensAt, now)}` : "until switched on";
    return { state: "off", dot: "red", icon: "pause", long: `Orders OFF · ${until}`, short: "Off" };
  }
  if (status.state === "closedByHours") {
    return { state: "closed", dot: "grey", icon: "clock", long: `Closed · opens ${clockOrTomorrow(status.reopensAt, now)}`, short: "Closed" };
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
}

export function pillDetail(
  status: StaffOrderingStatus,
  now: Date,
  hours: { readonly opens: string; readonly closes: string },
  sinceLabel: (at: Date, now: Date) => string,
): PillDetail {
  const notFinished = status.ordersStillDue;
  const notFinishedLine = notFinished === 0 ? "Orders not finished: none" : `Orders not finished: ${notFinished}`;
  const hoursLine = `Today's hours: ${clockFromHHMM(hours.opens)} – ${clockFromHHMM(hours.closes)}`;

  if (status.state === "paused") {
    const who = status.pausedBy?.name ?? "a staff member";
    return {
      statusLine: status.reopensAt ? `Online orders are switched off until ${clockOrTomorrow(status.reopensAt, now)}.` : "Online orders are switched off until someone switches them back on.",
      byLine: `Switched off by ${who} ${sinceLabel(status.pausedAt, now)}.`,
      reasonLine: status.reason ? `Reason: ${status.reason}` : null,
      hoursLine,
      notFinishedLine,
    };
  }
  if (status.state === "closedByHours") {
    return { statusLine: `Outside opening hours. Online orders start ${clockOrTomorrow(status.reopensAt, now)}.`, byLine: null, reasonLine: null, hoursLine, notFinishedLine };
  }
  return { statusLine: `Taking online orders until ${clockFromHHMM(status.closesAt)}.`, byLine: null, reasonLine: null, hoursLine, notFinishedLine };
}

/** A stable string that changes exactly when the state on screen should: used to re-sync from a fresh server render. */
export function statusSignature(status: StaffOrderingStatus): string {
  if (status.state === "paused") return `paused|${status.pausedAt.getTime()}|${status.reopensAt?.getTime() ?? "-"}|${status.ordersStillDue}`;
  if (status.state === "closedByHours") return `closed|${status.reopensAt.getTime()}|${status.ordersStillDue}`;
  return `open|${status.closesAt}|${status.ordersStillDue}`;
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
