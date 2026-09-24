import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

/**
 * remember-me.ts's pure logic: the signed cookie itself, and the maxAge
 * rewrite that works around @supabase/ssr's cookieOptions.maxAge being
 * silently ignored (see the module's own doc comment for the exact library
 * behavior this exists to route around).
 */

const mocks = vi.hoisted(() => ({ cookieSecret: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ cookieSecret: mocks.cookieSecret }));

import {
  REMEMBER_MAX_AGE,
  decodeRememberChoice,
  encodeRememberChoice,
  rememberCookieOptions,
  withRememberMaxAge,
} from "./remember-me";

const secret = "s".repeat(40);

describe("decodeRememberChoice", () => {
  beforeEach(() => mocks.cookieSecret.mockReset());

  it("returns undefined for an absent cookie — the caller applies its own default", () => {
    mocks.cookieSecret.mockReturnValue({ kind: "ok", secret });
    expect(decodeRememberChoice(undefined)).toBeUndefined();
  });

  it("decodes a validly signed true", () => {
    mocks.cookieSecret.mockReturnValue({ kind: "ok", secret });
    const raw = encodeRememberChoice(true);
    expect(raw).not.toBeNull();
    expect(decodeRememberChoice(raw!)).toBe(true);
  });

  it("decodes a validly signed false", () => {
    mocks.cookieSecret.mockReturnValue({ kind: "ok", secret });
    const raw = encodeRememberChoice(false);
    expect(decodeRememberChoice(raw!)).toBe(false);
  });

  it("fails closed to false (never undefined) when the cookie is present but wrongly signed", () => {
    mocks.cookieSecret.mockReturnValue({ kind: "ok", secret });
    const raw = encodeRememberChoice(true);
    mocks.cookieSecret.mockReturnValue({ kind: "ok", secret: "different secret padded".padEnd(40, "x") });
    expect(decodeRememberChoice(raw!)).toBe(false);
  });

  it("fails closed to false when the cookie is present but COOKIE_SECRET is unset", () => {
    mocks.cookieSecret.mockReturnValue({ kind: "ok", secret });
    const raw = encodeRememberChoice(true);
    mocks.cookieSecret.mockReturnValue({ kind: "none" });
    expect(decodeRememberChoice(raw!)).toBe(false);
  });

  it("fails closed to false on a malformed value, not a throw", () => {
    mocks.cookieSecret.mockReturnValue({ kind: "ok", secret });
    expect(decodeRememberChoice("not-a-real-cookie")).toBe(false);
  });
});

describe("encodeRememberChoice", () => {
  it("returns null (never an unsigned cookie) when COOKIE_SECRET is unset", () => {
    mocks.cookieSecret.mockReturnValue({ kind: "none" });
    expect(encodeRememberChoice(true)).toBeNull();
  });

  it("returns null when COOKIE_SECRET is invalid", () => {
    mocks.cookieSecret.mockReturnValue({ kind: "invalid" });
    expect(encodeRememberChoice(true)).toBeNull();
  });
});

describe("withRememberMaxAge", () => {
  it("leaves a removal (maxAge: 0) completely untouched, remembered or not — a sign-out must still sign out", () => {
    expect(withRememberMaxAge({ maxAge: 0 }, true)).toEqual({ maxAge: 0 });
    expect(withRememberMaxAge({ maxAge: 0 }, false)).toEqual({ maxAge: 0 });
  });

  it("rewrites a real session write to the 30-day window when remembered", () => {
    // 400 days: the exact value @supabase/ssr's own DEFAULT_COOKIE_OPTIONS uses for every real write.
    const libraryDefault = 400 * 24 * 60 * 60;
    expect(withRememberMaxAge({ maxAge: libraryDefault }, true).maxAge).toBe(REMEMBER_MAX_AGE);
  });

  it("rewrites a real session write to a true session cookie (no maxAge at all) when not remembered", () => {
    const libraryDefault = 400 * 24 * 60 * 60;
    expect(withRememberMaxAge({ maxAge: libraryDefault }, false).maxAge).toBeUndefined();
  });

  it("preserves every other option on the write (path, sameSite, etc.), only touching maxAge", () => {
    const options = { maxAge: 400 * 24 * 60 * 60, path: "/", sameSite: "lax" as const, httpOnly: false };
    expect(withRememberMaxAge(options, true)).toEqual({ ...options, maxAge: REMEMBER_MAX_AGE });
  });
});

describe("rememberCookieOptions", () => {
  it("is httpOnly and 30 days when remembered", () => {
    const options = rememberCookieOptions(true);
    expect(options.httpOnly).toBe(true);
    expect(options.maxAge).toBe(REMEMBER_MAX_AGE);
  });

  it("has no maxAge at all (a true session cookie) when not remembered", () => {
    expect(rememberCookieOptions(false).maxAge).toBeUndefined();
  });
});
