import { describe, expect, it } from "vitest";
import type { StaffOrderingStatus } from "@/lib/repositories/shop-status";
import { pauseOutcome, restartLine, sinceLabel, stillDueLine } from "./close-shop-copy";

// 2026-09-20 in Ambala (IST = UTC+5:30)
const at = (hhmm: string, day = "2026-09-20") => new Date(`${day}T${hhmm}:00+05:30`);
const base = { pausedBy: null, reason: null, ordersStillDue: 0, carriedOver: false } as const;

describe("restartLine — from the label the server gave when the chooser opened", () => {
  it("names the server's opening label, whatever it is (the 9 am fryer case reads 'today')", () => {
    expect(restartLine("UNTIL_NEXT_OPENING", "today at 11:30 AM")).toBe("Orders restart today at 11:30 AM.");
    expect(restartLine("UNTIL_NEXT_OPENING", "tomorrow at 11:30 AM")).toBe("Orders restart tomorrow at 11:30 AM.");
  });
  it("is null until the preview has arrived, so the confirm cannot show a guess", () => {
    expect(restartLine("UNTIL_NEXT_OPENING", null)).toBeNull();
  });
  it("manual mode never needs a time", () => {
    expect(restartLine("UNTIL_RESUMED", null)).toBe("Orders stay off until you switch them back on.");
  });
});

describe("pauseOutcome", () => {
  const paused = (mode: "UNTIL_NEXT_OPENING" | "UNTIL_RESUMED", reason: string): StaffOrderingStatus => ({
    ...base,
    state: "paused",
    mode,
    pausedAt: at("19:42"),
    reopensAt: mode === "UNTIL_RESUMED" ? null : at("11:30", "2026-09-21"),
    reopensAtLabel: mode === "UNTIL_RESUMED" ? null : "tomorrow at 11:30 AM",
    withinHours: true,
    pausedBy: { userId: "u", name: "Aman" },
    reason,
  });

  it("a pause that took closes the chooser with no message", () => {
    expect(pauseOutcome({ changed: true, status: paused("UNTIL_RESUMED", "Fryer broken") }, { mode: "UNTIL_RESUMED", reason: "Fryer broken" })).toEqual({ close: true, message: null });
  });

  it("(3) a pause that did not take says so, names the shop as still open, and keeps the chooser open", () => {
    const out = pauseOutcome({ changed: true, status: { ...base, state: "open", closesAt: "23:00" } }, { mode: "UNTIL_RESUMED", reason: "x y z" });
    expect(out.close).toBe(false);
    expect(out.message).toMatchObject({ tone: "error" });
    expect(out.message?.text).toMatch(/^That didn't take\. The shop is still open for orders\./);
  });

  it("(3) does not say 'open' when the shop is closed by hours", () => {
    const out = pauseOutcome({ changed: true, status: { ...base, state: "closedByHours", reopensAt: at("11:30"), reopensAtLabel: "today at 11:30 AM" } }, { mode: "UNTIL_RESUMED", reason: "x y z" });
    expect(out.message?.text).toMatch(/^That didn't take\. Online orders are not switched off\./);
  });

  it("(2) already paused by a DIFFERENT choice: says the choice was not applied and names the pause in force", () => {
    const out = pauseOutcome({ changed: false, status: paused("UNTIL_NEXT_OPENING", "Power cut") }, { mode: "UNTIL_RESUMED", reason: "Fryer broken" });
    expect(out.close).toBe(true);
    expect(out.message?.tone).toBe("error");
    expect(out.message?.text).toBe('Your choice was not applied. Already switched off by Aman ("Power cut"). Orders restart tomorrow at 11:30 AM.');
  });

  it("(2) a different reason alone also counts as a different choice", () => {
    const out = pauseOutcome({ changed: false, status: paused("UNTIL_RESUMED", "Power cut") }, { mode: "UNTIL_RESUMED", reason: "Fryer broken" });
    expect(out.message?.text).toMatch(/^Your choice was not applied\./);
    expect(out.message?.text).toContain("Orders stay off until someone switches them back on.");
  });

  it("(2) already paused by the SAME choice: a plain note, not 'not applied'", () => {
    const out = pauseOutcome({ changed: false, status: paused("UNTIL_RESUMED", "Fryer broken") }, { mode: "UNTIL_RESUMED", reason: " Fryer broken " });
    expect(out.message?.tone).toBe("note");
    expect(out.message?.text).not.toMatch(/not applied/);
  });
});

describe("sinceLabel", () => {
  it("names today, yesterday, then the date", () => {
    const now = at("10:00");
    expect(sinceLabel(at("07:42"), now)).toBe("today at 7:42 AM");
    expect(sinceLabel(at("19:42", "2026-09-19"), now)).toBe("yesterday at 7:42 PM");
    expect(sinceLabel(at("19:42", "2026-09-10"), now)).toBe("2026-09-10 at 7:42 PM");
  });
});

describe("stillDueLine", () => {
  it("is null for none, singular for one, plural otherwise", () => {
    expect(stillDueLine(0)).toBeNull();
    expect(stillDueLine(1)).toMatch(/^1 order is already placed/);
    expect(stillDueLine(3)).toMatch(/^3 orders are already placed/);
  });
});
