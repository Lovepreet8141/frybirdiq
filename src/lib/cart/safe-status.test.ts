import { describe, expect, it, vi } from "vitest";
import { orderingBanner, orderingControls } from "./ordering-banner";
import { readStatusSafely } from "./safe-status";
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
