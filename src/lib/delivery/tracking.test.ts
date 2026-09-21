import { describe, expect, it } from "vitest";
import { POSITION_RETENTION_MS, POSITION_STALE_MS, parsePosition, positionFreshness, retentionCutoff, trackerState } from "./tracking";

describe("parsePosition", () => {
  it("converts degrees to integer microdegrees and rounds the accuracy", () => {
    expect(parsePosition({ lat: 30.3782, lng: 76.7767, accuracyMetres: 12.6 })).toEqual({ ok: true, latMicro: 30378200, lngMicro: 76776700, accuracyMetres: 13 });
  });
  it("accepts a missing or null accuracy as unknown, and drops an absurd one", () => {
    expect(parsePosition({ lat: 30.3, lng: 76.7 })).toMatchObject({ ok: true, accuracyMetres: null });
    expect(parsePosition({ lat: 30.3, lng: 76.7, accuracyMetres: null })).toMatchObject({ ok: true, accuracyMetres: null });
    expect(parsePosition({ lat: 30.3, lng: 76.7, accuracyMetres: 5_000_000 })).toMatchObject({ ok: true, accuracyMetres: null });
  });
  it.each([
    [{ lat: 91, lng: 76 }],
    [{ lat: -91, lng: 76 }],
    [{ lat: 30, lng: 181 }],
    [{ lat: 30, lng: -181 }],
    [{ lat: Number.NaN, lng: 76 }],
    [{ lat: 30, lng: Number.POSITIVE_INFINITY }],
    [{ lat: "30", lng: "76" }],
    [{ lat: 30 }],
    [{ lat: 30, lng: 76, accuracyMetres: -1 }],
    [null],
    ["x"],
    [{ lat: 0, lng: 0 }],
  ])("refuses %j", (input) => {
    expect(parsePosition(input)).toEqual({ ok: false, error: "That location could not be read." });
  });
  it("keeps the boundary values", () => {
    expect(parsePosition({ lat: 90, lng: 180 })).toMatchObject({ ok: true, latMicro: 90_000_000, lngMicro: 180_000_000 });
    expect(parsePosition({ lat: -90, lng: -180 })).toMatchObject({ ok: true, latMicro: -90_000_000, lngMicro: -180_000_000 });
  });
});

describe("positionFreshness", () => {
  const now = new Date("2026-09-22T10:00:00Z");
  it("is fresh up to the stale limit and stale after it", () => {
    expect(positionFreshness(new Date(now.getTime() - POSITION_STALE_MS), now)).toEqual({ fresh: true, ageSeconds: 90 });
    expect(positionFreshness(new Date(now.getTime() - POSITION_STALE_MS - 1), now).fresh).toBe(false);
  });
  it("treats a fix from the future as brand new", () => {
    expect(positionFreshness(new Date(now.getTime() + 60_000), now)).toEqual({ fresh: true, ageSeconds: 0 });
  });
});

describe("retentionCutoff", () => {
  it("is exactly 24 hours before now", () => {
    const now = new Date("2026-09-22T10:00:00Z");
    expect(POSITION_RETENTION_MS).toBe(86_400_000);
    expect(retentionCutoff(now).toISOString()).toBe("2026-09-21T10:00:00.000Z");
  });
});

describe("trackerState", () => {
  const now = new Date("2026-09-22T10:00:00Z");
  const fix = (agoMs: number) => ({ recordedAt: new Date(now.getTime() - agoMs) });
  it("shows nothing unless the order is out for delivery, whatever fix exists", () => {
    expect(trackerState({ outForDelivery: false, latest: fix(1000), now })).toEqual({ kind: "hidden" });
  });
  it("waits when out for delivery with no fix yet", () => {
    expect(trackerState({ outForDelivery: true, latest: null, now })).toEqual({ kind: "waiting" });
  });
  it("is live for a recent fix and stale for an old one, never live-looking", () => {
    expect(trackerState({ outForDelivery: true, latest: fix(10_000), now })).toEqual({ kind: "live", ageSeconds: 10 });
    expect(trackerState({ outForDelivery: true, latest: fix(5 * 60_000), now })).toEqual({ kind: "stale", ageSeconds: 300 });
  });
});
