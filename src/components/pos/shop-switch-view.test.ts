/**
 * The POS shop switch's words and rules (ops-1 S4a). IST instants as UTC
 * literals with the IST time in a comment.
 */

import { describe, expect, it } from "vitest";
import type { StaffOrderingStatus } from "@/lib/repositories/shop-status";
import { CLOSED_TITLE, OPEN_TITLE, morningPrompt, pauseConfirmLines, reasonProblem, shopSwitchView, sinceLabel } from "./shop-switch-view";

const NOW = new Date("2026-09-19T14:30:00.000Z"); // 2026-09-19 20:00 IST
const PAUSED_AT = new Date("2026-09-19T14:12:00.000Z"); // 19:42 IST today
const YESTERDAY = new Date("2026-09-18T14:12:00.000Z"); // 19:42 IST yesterday
const NEXT_OPENING = new Date("2026-09-20T06:00:00.000Z"); // 11:30 IST tomorrow

const staffBits = { pausedBy: null, reason: null, ordersStillDue: 0, carriedOver: false } as const;

const open: StaffOrderingStatus = { state: "open", closesAt: "23:00", ...staffBits };
const closedByHours: StaffOrderingStatus = { state: "closedByHours", reopensAt: NEXT_OPENING, reopensAtLabel: "tomorrow at 11:30 AM", ...staffBits };
const pausedTimed: StaffOrderingStatus = {
  state: "paused",
  mode: "UNTIL_NEXT_OPENING",
  pausedAt: PAUSED_AT,
  reopensAt: NEXT_OPENING,
  reopensAtLabel: "tomorrow at 11:30 AM",
  withinHours: true,
  pausedBy: { userId: "u1", name: "Aman" },
  reason: "fryer down",
  ordersStillDue: 3,
  carriedOver: false,
};
const pausedManual: StaffOrderingStatus = { ...pausedTimed, mode: "UNTIL_RESUMED", reopensAt: null, reopensAtLabel: null };

describe("shopSwitchView — always shows who, when and when it reopens", () => {
  it("open", () => {
    expect(shopSwitchView(open, NOW)).toEqual({ open: true, title: OPEN_TITLE, detail: "Taking online orders.", reason: null });
  });

  it("closed until we next open: who, when, and the reopening time", () => {
    expect(shopSwitchView(pausedTimed, NOW)).toEqual({
      open: false,
      title: CLOSED_TITLE,
      detail: "Closed at 7:42 PM by Aman. Reopens tomorrow at 11:30 AM.",
      reason: "fryer down",
    });
  });

  it("closed until switched back on: says it stays closed, never invents a time", () => {
    expect(shopSwitchView(pausedManual, NOW).detail).toBe("Closed at 7:42 PM by Aman. Stays closed until someone opens it.");
  });

  it("a pauser with no display name is 'a staff member', not blank", () => {
    expect(shopSwitchView({ ...pausedTimed, pausedBy: { userId: "u1", name: null } }, NOW).detail).toContain("by a staff member.");
  });

  it("outside the hours with the switch on: the switch reads OPEN and says the hours are why", () => {
    expect(shopSwitchView(closedByHours, NOW)).toMatchObject({ open: true, title: OPEN_TITLE, detail: "Outside opening hours. Orders start tomorrow at 11:30 AM." });
  });
});

describe("pauseConfirmLines — what confirming would do, said before it happens", () => {
  it("the 9 am case says 'today' in words", () => {
    expect(pauseConfirmLines("UNTIL_NEXT_OPENING", { nextOpeningLabel: "today at 11:30 AM", ordersStillDue: 0 })[0]).toBe("Orders restart today at 11:30 AM.");
  });

  it("until switched back on says so", () => {
    expect(pauseConfirmLines("UNTIL_RESUMED", { nextOpeningLabel: "today at 11:30 AM", ordersStillDue: 0 })[0]).toBe("Orders stay off until someone switches them back on.");
  });

  it("counts the orders still due and says closing does not cancel them", () => {
    expect(pauseConfirmLines("UNTIL_RESUMED", { nextOpeningLabel: "x", ordersStillDue: 3 })[1]).toBe(
      "3 orders are still due. Closing does not cancel them; call the customer if you can't make them.",
    );
    expect(pauseConfirmLines("UNTIL_RESUMED", { nextOpeningLabel: "x", ordersStillDue: 1 })[1]).toBe(
      "1 order is still due. Closing does not cancel it; call the customer if you can't make it.",
    );
    expect(pauseConfirmLines("UNTIL_RESUMED", { nextOpeningLabel: "x", ordersStillDue: 0 })[1]).toBe("No orders are waiting.");
  });
});

describe("reasonProblem — the same 3-200 rule the action enforces", () => {
  it.each([
    ["", "Say why, in a few words."],
    ["  ok ", "Say why, in a few words."],
    ["x".repeat(201), "Keep it under 200 characters."],
    ["fryer down", null],
  ])("%j -> %j", (reason, problem) => {
    expect(reasonProblem(reason)).toBe(problem);
  });
});

describe("morningPrompt — the forgot-to-reopen question, once a day", () => {
  const carried = { ...pausedManual, pausedAt: YESTERDAY, carriedOver: true };
  const setUp = new Date("2026-09-19T04:30:00.000Z"); // 10:00 IST, before opening

  it("asks at the morning set-up when a pause carried over", () => {
    expect(morningPrompt(carried, setUp, null)).toBe(
      "Online orders have been closed since yesterday at 7:42 PM, by Aman (fryer down). Keep them closed, or open for orders now?",
    );
  });

  it("mentions a timed pause's own end, so nobody reopens early by mistake", () => {
    expect(morningPrompt({ ...carried, mode: "UNTIL_NEXT_OPENING", reopensAtLabel: "today at 11:30 AM" }, setUp, null)).toContain(
      "It reopens today at 11:30 AM unless you keep it closed.",
    );
  });

  it("asks only once per business day", () => {
    expect(morningPrompt(carried, setUp, "2026-09-19")).toBeNull();
    expect(morningPrompt(carried, setUp, "2026-09-18")).not.toBeNull();
  });

  it("does not ask when nothing carried over, or the shop is open", () => {
    expect(morningPrompt(pausedManual, setUp, null)).toBeNull();
    expect(morningPrompt(open, setUp, null)).toBeNull();
  });
});

describe("sinceLabel", () => {
  it("today, yesterday, and older", () => {
    expect(sinceLabel(PAUSED_AT, NOW)).toBe("at 7:42 PM");
    expect(sinceLabel(YESTERDAY, NOW)).toBe("yesterday at 7:42 PM");
    expect(sinceLabel(new Date("2026-09-15T14:12:00.000Z"), NOW)).toBe("15 Sep at 7:42 PM"); // fixed, not ICU's "Sept"
  });

  it("uses the business day, so 00:30 IST reads 'yesterday' for 7:42 PM the evening before", () => {
    expect(sinceLabel(PAUSED_AT, new Date("2026-09-19T19:00:00.000Z"))).toBe("yesterday at 7:42 PM"); // now 2026-09-20 00:30 IST
  });
});
