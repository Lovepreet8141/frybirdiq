import { describe, expect, it } from "vitest";
import type { StaffOrderingStatus } from "@/lib/repositories/shop-status";
import { CONFIRM_ARM_MS, clockFromHHMM, confirmArmed, pillAnnouncement, pillDetail, pillView, statusSignature } from "./shop-pill";

const NOW = new Date("2026-09-19T14:30:00.000Z"); // 20:00 IST
const NEXT_OPEN_TOMORROW = new Date("2026-09-20T06:00:00.000Z"); // 11:30 IST tomorrow
const NEXT_OPEN_TODAY = new Date("2026-09-19T17:00:00.000Z"); // 22:30 IST today (a timed pause ending later tonight)
const staffBits = { pausedBy: null, reason: null, ordersStillDue: 0, carriedOver: false } as const;
const open: StaffOrderingStatus = { state: "open", closesAt: "23:00", ...staffBits, ordersStillDue: 1 };
const closed: StaffOrderingStatus = { state: "closedByHours", reopensAt: NEXT_OPEN_TOMORROW, reopensAtLabel: "tomorrow at 11:30 AM", ...staffBits };
const offTimed: StaffOrderingStatus = {
  state: "paused", mode: "UNTIL_NEXT_OPENING", pausedAt: new Date("2026-09-19T14:12:00Z"), reopensAt: NEXT_OPEN_TOMORROW, reopensAtLabel: "tomorrow at 11:30 AM", withinHours: true,
  pausedBy: { userId: "u", name: "Aman" }, reason: "Equipment problem: fryer 2", ordersStillDue: 3, carriedOver: false,
};
const offManual: StaffOrderingStatus = { ...offTimed, mode: "UNTIL_RESUMED", reopensAt: null, reopensAtLabel: null };
const hours = { opens: "11:30", closes: "23:00" };
const since = () => "at 7:42 PM";

describe("pillView: each state, its words, its icon, its colour, its phone word", () => {
  it("open", () => {
    expect(pillView(open, NOW)).toEqual({ state: "open", dot: "green", icon: "check", long: "Open · until 11:00 PM", short: "Open" });
  });
  it("closed by hours", () => {
    expect(pillView(closed, NOW)).toEqual({ state: "closed", dot: "grey", icon: "clock", long: "Closed · opens tomorrow 11:30 AM", short: "Closed" });
  });
  it("closed by hours, opening later today", () => {
    expect(pillView({ ...closed, reopensAt: new Date("2026-09-20T06:00:00Z") }, new Date("2026-09-20T02:00:00Z")).long).toBe("Closed · opens 11:30 AM");
  });
  it("orders off until a time", () => {
    expect(pillView(offTimed, NOW)).toMatchObject({ state: "off", dot: "red", icon: "pause", long: "Orders OFF · until tomorrow 11:30 AM", short: "Off" });
    expect(pillView({ ...offTimed, reopensAt: NEXT_OPEN_TODAY }, NOW).long).toBe("Orders OFF · until 10:30 PM");
  });
  it("orders off until switched on", () => {
    expect(pillView(offManual, NOW).long).toBe("Orders OFF · until switched on");
  });
  it("never colour alone: every state has an icon and text, and the three dots differ", () => {
    const views = [open, closed, offManual].map((s) => pillView(s, NOW));
    expect(new Set(views.map((v) => v.dot)).size).toBe(3);
    expect(new Set(views.map((v) => v.icon)).size).toBe(3);
    for (const v of views) expect(v.long.length).toBeGreaterThan(v.short.length);
  });
});

describe("pillDetail", () => {
  it("open: status, hours, orders not finished", () => {
    expect(pillDetail(open, NOW, hours, since)).toEqual({
      statusLine: "Taking online orders until 11:00 PM.", byLine: null, reasonLine: null,
      hoursLine: "Today's hours: 11:30 AM – 11:00 PM", notFinishedLine: "Orders not finished: 1",
    });
  });
  it("off: also who, when and why", () => {
    const d = pillDetail(offTimed, NOW, hours, since);
    expect(d.statusLine).toBe("Online orders are switched off until tomorrow 11:30 AM.");
    expect(d.byLine).toBe("Switched off by Aman at 7:42 PM.");
    expect(d.reasonLine).toBe("Reason: Equipment problem: fryer 2");
    expect(d.notFinishedLine).toBe("Orders not finished: 3");
  });
  it("off, manual, nobody named", () => {
    const d = pillDetail({ ...offManual, pausedBy: null, reason: null }, NOW, hours, since);
    expect(d.statusLine).toBe("Online orders are switched off until someone switches them back on.");
    expect(d.byLine).toBe("Switched off by a staff member at 7:42 PM.");
    expect(d.reasonLine).toBeNull();
  });
  it("closed by hours says when orders start; none finished reads 'none'", () => {
    const d = pillDetail(closed, NOW, hours, since);
    expect(d.statusLine).toBe("Outside opening hours. Online orders start tomorrow 11:30 AM.");
    expect(d.notFinishedLine).toBe("Orders not finished: none");
  });
  it("the old label is gone: nothing says 'still to make'", () => {
    for (const s of [open, closed, offTimed]) expect(JSON.stringify(pillDetail(s, NOW, hours, since))).not.toMatch(/still to make/i);
  });
});

describe("clockFromHHMM", () => {
  it.each([["23:00", "11:00 PM"], ["11:30", "11:30 AM"], ["00:15", "12:15 AM"], ["12:00", "12:00 PM"]])("%s -> %s", (input, out) => expect(clockFromHHMM(input)).toBe(out));
});

describe("statusSignature", () => {
  it("changes when the state or the pause changes, not otherwise", () => {
    expect(statusSignature(open)).toBe(statusSignature({ ...open }));
    expect(statusSignature(open)).not.toBe(statusSignature(offManual));
    expect(statusSignature(offTimed)).not.toBe(statusSignature({ ...offTimed, pausedAt: new Date("2026-09-19T14:13:00Z") }));
    // who and why count too: a re-render that changes only the reason must re-sync the screen
    expect(statusSignature(offTimed)).not.toBe(statusSignature({ ...offTimed, reason: "Other" }));
    expect(statusSignature(offTimed)).not.toBe(statusSignature({ ...offTimed, pausedBy: { userId: "u", name: "Ravi" } }));
  });
});

describe("pillAnnouncement", () => {
  it("says what changed", () => {
    expect(pillAnnouncement(pillView(offManual, NOW))).toBe("Online orders are now off. Orders OFF · until switched on.");
    expect(pillAnnouncement(pillView(open, NOW))).toBe("Online orders are open. Open · until 11:00 PM.");
  });
});

describe("confirmArmed — a double-tap can never confirm", () => {
  it("not armed before the delay, armed after, never when nothing is shown", () => {
    expect(confirmArmed(1000, 1000 + CONFIRM_ARM_MS - 1)).toBe(false);
    expect(confirmArmed(1000, 1000 + CONFIRM_ARM_MS)).toBe(true);
    expect(confirmArmed(null, 999999)).toBe(false);
  });
});
