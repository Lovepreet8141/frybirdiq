import { describe, expect, it } from "vitest";
import { AUTO_RELOAD_COOLDOWN_MS, IDLE_BEFORE_RELOAD_MS, compareVersions, parseVersionBody, shouldAutoReload } from "./version-check";

describe("compareVersions", () => {
  it("same build: nothing to say", () => expect(compareVersions("abc", "abc")).toBe("same"));
  it("a different build: newer", () => expect(compareVersions("abc", "def")).toBe("newer"));
  it.each([undefined, null, "", 5, {}])("an unreadable answer (%j) never prompts", (remote) => {
    expect(compareVersions("abc", remote)).toBe("unknown");
  });
});

describe("parseVersionBody", () => {
  it("reads the build", () => expect(parseVersionBody({ build: "abc" })).toBe("abc"));
  it.each([null, "abc", { build: 1 }, { build: "" }, {}])("refuses %j", (body) => expect(parseVersionBody(body)).toBeNull());
});

describe("shouldAutoReload", () => {
  const base = { stale: true, idleMs: IDLE_BEFORE_RELOAD_MS, busy: false, online: true, lastAutoReloadAt: null, now: 1_000_000 };

  it("stale, idle, nothing in progress, online: reload", () => expect(shouldAutoReload(base)).toBe(true));
  it("not stale: never", () => expect(shouldAutoReload({ ...base, stale: false })).toBe(false));
  it("someone touched the screen a moment ago: wait", () => expect(shouldAutoReload({ ...base, idleMs: IDLE_BEFORE_RELOAD_MS - 1 })).toBe(false));
  it("an order in progress (or a dialog open): never, however long idle", () => {
    expect(shouldAutoReload({ ...base, busy: true, idleMs: 60 * 60_000 })).toBe(false);
  });
  it("offline: a reload would land on an error page", () => expect(shouldAutoReload({ ...base, online: false })).toBe(false));
  it("does not reload twice inside the cooldown, then may", () => {
    expect(shouldAutoReload({ ...base, lastAutoReloadAt: base.now - 1000 })).toBe(false);
    expect(shouldAutoReload({ ...base, lastAutoReloadAt: base.now - AUTO_RELOAD_COOLDOWN_MS })).toBe(true);
  });
});
