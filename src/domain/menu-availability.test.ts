import { describe, expect, it } from "vitest";
import { type AvailabilityRow, type RequiredGroupCheck, resolveAvailability, resolveWithRequiredGroups } from "./menu-availability";

const NOW = new Date("2026-09-11T12:00:00Z");
const TODAY = "2026-09-11";

function state(overrides: Partial<AvailabilityRow>): AvailabilityRow {
  return {
    locationId: null,
    channel: null,
    status: "AVAILABLE",
    unavailableUntil: null,
    reason: null,
    setOnBusinessDate: null,
    ...overrides,
  };
}

describe("resolveAvailability", () => {
  it("defaults to available when there are no rows at all", () => {
    const result = resolveAvailability([], { locationId: "loc-1", channel: "ONLINE", now: NOW, today: TODAY });
    expect(result).toEqual({ status: "AVAILABLE", available: true, reason: null, until: null });
  });

  it("a wildcard row (no location, no channel) applies everywhere", () => {
    const rows = [state({ status: "TEMPORARILY_UNAVAILABLE", reason: "Fryer down" })];
    expect(resolveAvailability(rows, { locationId: "loc-1", channel: "ONLINE", now: NOW, today: TODAY }).available).toBe(false);
    expect(resolveAvailability(rows, { locationId: "loc-2", channel: "DINE_IN", now: NOW, today: TODAY }).available).toBe(false);
  });

  it("a row scoped to a different location does not match", () => {
    const rows = [state({ locationId: "loc-1", status: "TEMPORARILY_UNAVAILABLE" })];
    const result = resolveAvailability(rows, { locationId: "loc-2", channel: "ONLINE", now: NOW, today: TODAY });
    expect(result.available).toBe(true);
  });

  it("a row scoped to a different channel does not match — available at POS, unavailable on the website", () => {
    const rows = [state({ channel: "ONLINE", status: "SOLD_OUT_TODAY", setOnBusinessDate: TODAY })];
    const website = resolveAvailability(rows, { locationId: null, channel: "ONLINE", now: NOW, today: TODAY });
    const pos = resolveAvailability(rows, { locationId: null, channel: "DINE_IN", now: NOW, today: TODAY });
    expect(website.available).toBe(false);
    expect(pos.available).toBe(true);
  });

  it("a channel+location-specific row wins over a wildcard row for the same product", () => {
    const rows = [
      state({ status: "AVAILABLE" }),
      state({ locationId: "loc-1", channel: "ONLINE", status: "SOLD_OUT_TODAY", setOnBusinessDate: TODAY }),
    ];
    const result = resolveAvailability(rows, { locationId: "loc-1", channel: "ONLINE", now: NOW, today: TODAY });
    expect(result.status).toBe("SOLD_OUT_TODAY");
  });

  it("a channel-only row beats a wildcard, and a location-only row beats a channel-only one", () => {
    const rows = [
      state({ status: "AVAILABLE" }),
      state({ channel: "ONLINE", status: "TEMPORARILY_UNAVAILABLE", reason: "channel-only" }),
      state({ locationId: "loc-1", status: "TEMPORARILY_UNAVAILABLE", reason: "location-only" }),
    ];
    const result = resolveAvailability(rows, { locationId: "loc-1", channel: "ONLINE", now: NOW, today: TODAY });
    expect(result.reason).toBe("location-only");
  });

  describe("SOLD_OUT_TODAY", () => {
    it("is unavailable when set today", () => {
      const rows = [state({ status: "SOLD_OUT_TODAY", reason: "No more thighs", setOnBusinessDate: TODAY })];
      const result = resolveAvailability(rows, { locationId: null, channel: null, now: NOW, today: TODAY });
      expect(result).toEqual({ status: "SOLD_OUT_TODAY", available: false, reason: "No more thighs", until: null });
    });

    it("expires at the next business-date rollover — set yesterday reads available today", () => {
      const rows = [state({ status: "SOLD_OUT_TODAY", setOnBusinessDate: "2026-09-10" })];
      const result = resolveAvailability(rows, { locationId: null, channel: null, now: NOW, today: TODAY });
      expect(result.available).toBe(true);
    });
  });

  describe("SCHEDULED_UNAVAILABLE", () => {
    it("is unavailable before the return time", () => {
      const rows = [state({ status: "SCHEDULED_UNAVAILABLE", unavailableUntil: new Date("2026-09-11T14:30:00Z"), reason: "Back at 8pm" })];
      const result = resolveAvailability(rows, { locationId: null, channel: null, now: NOW, today: TODAY });
      expect(result).toEqual({ status: "SCHEDULED_UNAVAILABLE", available: false, reason: "Back at 8pm", until: new Date("2026-09-11T14:30:00Z") });
    });

    it("is available again once the return time has passed", () => {
      const rows = [state({ status: "SCHEDULED_UNAVAILABLE", unavailableUntil: new Date("2026-09-11T10:00:00Z") })];
      const result = resolveAvailability(rows, { locationId: null, channel: null, now: NOW, today: TODAY });
      expect(result.available).toBe(true);
    });

    it("is available at the exact return instant", () => {
      const rows = [state({ status: "SCHEDULED_UNAVAILABLE", unavailableUntil: NOW })];
      const result = resolveAvailability(rows, { locationId: null, channel: null, now: NOW, today: TODAY });
      expect(result.available).toBe(true);
    });
  });
});

const AVAILABLE: ReturnType<typeof resolveAvailability> = { status: "AVAILABLE", available: true, reason: null, until: null };

function group(overrides: Partial<RequiredGroupCheck>): RequiredGroupCheck {
  return { name: "Heat", minSelections: 1, availableCount: 1, ...overrides };
}

describe("resolveWithRequiredGroups", () => {
  it("stays available when every required group still has an option", () => {
    const result = resolveWithRequiredGroups(AVAILABLE, [group({ availableCount: 2 })]);
    expect(result).toEqual(AVAILABLE);
  });

  it("stays available when an optional group (minSelections 0) is fully exhausted", () => {
    const result = resolveWithRequiredGroups(AVAILABLE, [group({ minSelections: 0, availableCount: 0 })]);
    expect(result.available).toBe(true);
  });

  it("becomes unavailable when a required group has zero available options", () => {
    const result = resolveWithRequiredGroups(AVAILABLE, [group({ name: "Spice level", minSelections: 1, availableCount: 0 })]);
    expect(result.available).toBe(false);
    expect(result.reason).toBe("Spice level: no options available");
  });

  it("never overrides a product already unavailable for its own reason", () => {
    const alreadyOut: ReturnType<typeof resolveAvailability> = { status: "SOLD_OUT_TODAY", available: false, reason: "No more thighs", until: null };
    const result = resolveWithRequiredGroups(alreadyOut, [group({ availableCount: 0 })]);
    expect(result).toEqual(alreadyOut);
  });
});
