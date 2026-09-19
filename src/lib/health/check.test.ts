import { describe, expect, it, vi } from "vitest";
import { createHealthCheck } from "./check";

describe("createHealthCheck", () => {
  it("is ok when the probe resolves", async () => {
    const check = createHealthCheck({ probe: async () => 1 });
    expect(await check()).toEqual({ ok: true, body: { status: "ok" } });
  });

  it("is unavailable, with a fixed body, when the probe rejects — error text never escapes", async () => {
    const check = createHealthCheck({ probe: async () => { throw new Error("password authentication failed for user postgres at db.secret.host"); } });
    const r = await check();
    expect(r).toEqual({ ok: false, body: { status: "unavailable" } });
    expect(JSON.stringify(r)).not.toMatch(/password|secret|postgres/);
  });

  it("is unavailable when the probe throws synchronously (e.g. serverEnv() broken) rather than rejecting", async () => {
    const check = createHealthCheck({ probe: () => { throw new Error("DATABASE_URL is required"); } });
    expect(await check()).toEqual({ ok: false, body: { status: "unavailable" } });
  });

  it("is unavailable when the probe hangs past the timeout", async () => {
    vi.useFakeTimers();
    try {
      const check = createHealthCheck({ probe: () => new Promise(() => {}), timeoutMs: 1000 });
      const pending = check();
      await vi.advanceTimersByTimeAsync(1001);
      expect((await pending).ok).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("caches an answer for cacheMs, then probes again", async () => {
    let t = 0;
    const probe = vi.fn(async () => 1);
    const check = createHealthCheck({ probe, now: () => t, cacheMs: 5000 });
    await check();
    t = 4999;
    await check();
    expect(probe).toHaveBeenCalledTimes(1);
    t = 5000;
    await check();
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("shares one probe among concurrent callers", async () => {
    let release!: () => void;
    const probe = vi.fn(() => new Promise<void>((res) => { release = res; }));
    const check = createHealthCheck({ probe });
    const all = Promise.all([check(), check(), check()]);
    release();
    await all;
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("does not cache forever: a recovered database reads ok after the window", async () => {
    let t = 0;
    let up = false;
    const check = createHealthCheck({ probe: async () => { if (!up) throw new Error("x"); }, now: () => t, cacheMs: 1000 });
    expect((await check()).ok).toBe(false);
    up = true;
    t = 1000;
    expect((await check()).ok).toBe(true);
  });
});
