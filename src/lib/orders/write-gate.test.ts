import { describe, expect, it } from "vitest";
import { OrderingRefusedAtWrite, writeGate } from "./write-gate";
import { NO_CLOSURES } from "./closures";
import type { ShopStatus } from "./opening-hours";

// Hours 11:30-23:00 IST. 2026-09-19 14:30Z = 20:00 IST (open); 17:31Z = 23:01 IST (just closed).
const OPEN_NOW = new Date("2026-09-19T14:30:00.000Z");
const JUST_CLOSED = new Date("2026-09-19T17:31:00.000Z");
const hours = { openingTime: "11:30", closingTime: "23:00", closures: NO_CLOSURES };
const shop = (over: Partial<ShopStatus> = {}): ShopStatus => ({ ...hours, orderingPausedAt: null, orderingPausedUntil: null, ...over });
const paused = shop({ orderingPausedAt: new Date("2026-09-19T14:29:00.000Z"), orderingPausedUntil: null });

describe("writeGate — the gate applied at the moment of writing", () => {
  it("open, ASAP: proceed", () => expect(writeGate({ now: OPEN_NOW, shop: shop(), when: "ASAP", scheduledFor: null })).toBeNull());

  it("paused since the top-of-request read: ASAP is refused as PAUSED", () => {
    expect(writeGate({ now: OPEN_NOW, shop: paused, when: "ASAP", scheduledFor: null })).toMatchObject({ kind: "PAUSED" });
  });

  it("paused: a SCHEDULED order is refused too (the switch refuses pre-orders)", () => {
    const slot = new Date("2026-09-19T15:30:00.000Z");
    expect(writeGate({ now: OPEN_NOW, shop: paused, when: "SCHEDULED", scheduledFor: slot })).toMatchObject({ kind: "PAUSED" });
  });

  it("an expired timed pause is over: proceed", () => {
    const expired = shop({ orderingPausedAt: new Date("2026-09-19T13:00:00.000Z"), orderingPausedUntil: new Date("2026-09-19T14:00:00.000Z") });
    expect(writeGate({ now: OPEN_NOW, shop: expired, when: "ASAP", scheduledFor: null })).toBeNull();
  });

  it("closing time reached between the first read and the write: ASAP is refused as CLOSED", () => {
    expect(writeGate({ now: JUST_CLOSED, shop: shop(), when: "ASAP", scheduledFor: null })).toMatchObject({ kind: "CLOSED" });
  });

  it("hours edited to close earlier in the gap: the fresh hours win", () => {
    expect(writeGate({ now: OPEN_NOW, shop: shop({ closingTime: "19:00" }), when: "ASAP", scheduledFor: null })).toMatchObject({ kind: "CLOSED" });
  });

  it("scheduled, still valid on the fresh clock: proceed (closed-by-hours is fine for a pre-order)", () => {
    const slot = new Date("2026-09-20T06:30:00.000Z"); // 12:00 IST tomorrow
    expect(writeGate({ now: JUST_CLOSED, shop: shop(), when: "SCHEDULED", scheduledFor: slot })).toBeNull();
  });

  it("scheduled, the slot slipped inside the 20-minute lead window during the gap: refused", () => {
    const now = new Date("2026-09-19T06:50:00.000Z"); // 12:20 IST
    const slot = new Date("2026-09-19T07:00:00.000Z"); // 12:30 IST, 10 minutes away
    expect(writeGate({ now, shop: shop(), when: "SCHEDULED", scheduledFor: slot })).toEqual({ kind: "SCHEDULE_SLIPPED" });
  });

  it("scheduled with no time: refused rather than written", () => {
    expect(writeGate({ now: OPEN_NOW, shop: shop(), when: "SCHEDULED", scheduledFor: null })).toEqual({ kind: "SCHEDULE_SLIPPED" });
  });

  it("scheduled outside the fresh hours: refused", () => {
    const slot = new Date("2026-09-19T22:30:00.000Z"); // 04:00 IST, before opening
    expect(writeGate({ now: OPEN_NOW, shop: shop(), when: "SCHEDULED", scheduledFor: slot })).toEqual({ kind: "SCHEDULE_SLIPPED" });
  });
});

describe("OrderingRefusedAtWrite", () => {
  it("carries the refusal and is an Error (so withIdempotency releases its claim)", () => {
    const refusal = { kind: "SCHEDULE_SLIPPED" } as const;
    const error = new OrderingRefusedAtWrite(refusal, OPEN_NOW, shop());
    expect(error).toBeInstanceOf(Error);
    expect(error.refusal).toBe(refusal);
  });
});
