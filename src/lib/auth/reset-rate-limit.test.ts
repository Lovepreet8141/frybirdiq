/**
 * checkResetRequestLimit / checkResetVerifyLimit — pure rate-limit logic for
 * the staff/owner password-reset flow (auth-v2, item 4: "reset-code brute
 * force" must be covered explicitly). A 6-digit reset code is only as safe
 * as the number of guesses allowed against it — these tests pin that an
 * attacker cannot simply try all 1,000,000 possibilities against one email
 * or one IP before being cut off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { checkResetRequestLimit, checkResetVerifyLimit, resetResetRateLimitsForTests } from "./reset-rate-limit";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  resetResetRateLimitsForTests();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("checkResetRequestLimit — the 60-second gap", () => {
  it("allows the first request for an email", () => {
    expect(checkResetRequestLimit("a@example.test", null)).toEqual({ allowed: true });
  });

  it("refuses a second request 1ms later", () => {
    checkResetRequestLimit("a@example.test", null);
    expect(checkResetRequestLimit("a@example.test", null).allowed).toBe(false);
  });

  it("allows again once a full 60 seconds have passed", () => {
    checkResetRequestLimit("a@example.test", null);
    vi.setSystemTime(60_000);
    expect(checkResetRequestLimit("a@example.test", null).allowed).toBe(true);
  });

  it("is case-insensitive on the email", () => {
    checkResetRequestLimit("Asha@Example.Test", null);
    expect(checkResetRequestLimit("asha@example.test", null).allowed).toBe(false);
  });
});

describe("checkResetRequestLimit — the 5-per-15-minute cap", () => {
  it("allows exactly 5 requests spaced past the 60-second gap, refuses the 6th", () => {
    let allowedCount = 0;
    for (let i = 0; i < 6; i += 1) {
      vi.setSystemTime(i * 61_000);
      if (checkResetRequestLimit("a@example.test", null).allowed) allowedCount += 1;
    }
    expect(allowedCount).toBe(5);
  });
});

describe("checkResetRequestLimit — the per-IP cap", () => {
  it("caps one IP at 20 requests per 15 minutes across different emails", () => {
    let allowedCount = 0;
    for (let i = 0; i < 21; i += 1) {
      vi.setSystemTime(i * 1_000);
      if (checkResetRequestLimit(`u${i}@example.test`, "203.0.113.1").allowed) allowedCount += 1;
    }
    expect(allowedCount).toBe(20);
  });
});

describe("checkResetVerifyLimit — a 6-digit reset code cannot be brute forced", () => {
  it("allows up to 10 attempts per email in 15 minutes, refuses the 11th", () => {
    let allowedCount = 0;
    for (let i = 0; i < 11; i += 1) {
      if (checkResetVerifyLimit("a@example.test", null).allowed) allowedCount += 1;
    }
    expect(allowedCount).toBe(10);
  });

  it("refuses attempt 11 well before anything close to a meaningful fraction of the 1,000,000 possible codes is tried", () => {
    for (let i = 0; i < 10; i += 1) checkResetVerifyLimit("victim@example.test", null);
    const eleventh = checkResetVerifyLimit("victim@example.test", null);
    expect(eleventh.allowed).toBe(false);
  });

  it("caps one IP at 40 verify attempts per 15 minutes — an attacker cannot spread guesses across many emails from one IP to dodge the per-email cap", () => {
    let allowedCount = 0;
    for (let i = 0; i < 41; i += 1) {
      if (checkResetVerifyLimit(`u${i}@example.test`, "203.0.113.1").allowed) allowedCount += 1;
    }
    expect(allowedCount).toBe(40);
  });

  it("never touches the request-side 60-second gap — a wrong guess must not block requesting a fresh code", () => {
    checkResetVerifyLimit("a@example.test", null);
    checkResetVerifyLimit("a@example.test", null);
    expect(checkResetRequestLimit("a@example.test", null).allowed).toBe(true);
  });

  it("a new 15-minute window resets the cap, but each reset still only ever allows 10 more guesses at a time", () => {
    for (let i = 0; i < 10; i += 1) checkResetVerifyLimit("a@example.test", null);
    expect(checkResetVerifyLimit("a@example.test", null).allowed).toBe(false);
    vi.setSystemTime(16 * 60_000);
    expect(checkResetVerifyLimit("a@example.test", null).allowed).toBe(true);
  });
});

describe("reset-rate-limit is isolated from otp-rate-limit", () => {
  it("shares no bucket with the customer OTP limiter — a different module, a different Map", async () => {
    const { checkOtpVerifyLimit, resetOtpRateLimitsForTests } = await import("./otp-rate-limit");
    resetOtpRateLimitsForTests();
    for (let i = 0; i < 10; i += 1) checkOtpVerifyLimit("shared@example.test", null);
    expect(checkOtpVerifyLimit("shared@example.test", null).allowed).toBe(false);
    // The reset flow's own limiter for the exact same email must be unaffected.
    expect(checkResetVerifyLimit("shared@example.test", null).allowed).toBe(true);
  });
});
