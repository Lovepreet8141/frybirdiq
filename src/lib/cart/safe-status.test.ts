import { afterEach, describe, expect, it, vi } from "vitest";
import { orderingBanner, orderingControls } from "./ordering-banner";
import { STATUS_READ_TIMEOUT_MS, readStatusSafely } from "./safe-status";
import type { ShopOrderingState } from "./shop-hours";

const paused: ShopOrderingState = { state: "paused", mode: "UNTIL_RESUMED", pausedAt: new Date(), reopensAt: null, reopensAtLabel: null, withinHours: true };

describe("readStatusSafely", () => {
  it("passes a good read through", async () => {
    expect(await readStatusSafely(async () => paused, () => {})).toBe(paused);
  });

  it("a throwing read yields null instead of throwing, and logs it", async () => {
    const log = vi.fn();
    const result = await readStatusSafely(async () => {
      throw new Error("canceling statement due to statement timeout");
    }, log);
    expect(result).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toContain("statement timeout");
  });

  it("logs no error object, only name and message", async () => {
    const log = vi.fn();
    await readStatusSafely(async () => {
      throw Object.assign(new Error("boom"), { connectionString: "postgres://user:secret@host/db" });
    }, log);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });

  it("copes with a non-Error throw", async () => {
    expect(await readStatusSafely(() => Promise.reject("nope"), () => {})).toBeNull();
  });

  it("and the pages keep rendering: no banner, controls fail open", async () => {
    const status = await readStatusSafely(() => Promise.reject(new Error("x")), () => {});
    expect(status === null ? null : orderingBanner(status)).toBeNull();
    expect(orderingControls(status)).toMatchObject({ canOrder: true, asapAllowed: true, preorderAllowed: true, disabledReason: null });
  });
});

describe("readStatusSafely: a read that hangs", () => {
  afterEach(() => vi.useRealTimers());

  it("gives up after the timeout: null, logged, and the page renders without a banner", async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const hung = new Promise<ShopOrderingState | null>(() => undefined); // never settles: a database that hangs
    const pending = readStatusSafely(() => hung, log);
    await vi.advanceTimersByTimeAsync(STATUS_READ_TIMEOUT_MS - 1);
    expect(log).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toContain("timed out");
  });

  it("a read that answers in time is returned and leaves no timer behind", async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const result = await readStatusSafely(async () => paused, log);
    expect(result).toBe(paused);
    expect(vi.getTimerCount()).toBe(0);
    expect(log).not.toHaveBeenCalled();
  });

  it("the timeout is 2.5 s: long enough for a slow query, short enough that a page is not held", () => {
    expect(STATUS_READ_TIMEOUT_MS).toBe(2500);
  });
});
