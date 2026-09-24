/**
 * checkOtpRequestLimit / checkOtpVerifyLimit — pure rate-limit logic
 * (email-otp card). Fail-first note: an earlier version measured the
 * 60-second gap against the rolling window's own `windowStart`, which only
 * moves once per 15-minute window — so after the second request in a
 * window, the gap check silently stopped enforcing anything until the
 * window rolled over. These tests pin the fix (a separate `lastSentAt` per
 * email) directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { checkOtpRequestLimit, checkOtpVerifyLimit, resetOtpRateLimitsForTests } from "./otp-rate-limit";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  resetOtpRateLimitsForTests();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("checkOtpRequestLimit — the 60-second gap", () => {
  it("allows the first request for an email", () => {
    expect(checkOtpRequestLimit("a@example.test", null)).toEqual({ allowed: true });
  });

  it("refuses a second request 1ms later, with a retryAfterSeconds close to 60", () => {
    checkOtpRequestLimit("a@example.test", null);
    const result = checkOtpRequestLimit("a@example.test", null);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(59);
  });

  it("the gap re-checks against the LAST successful request, not the window's start — the exact bug this pins", () => {
    checkOtpRequestLimit("a@example.test", null); // t=0, allowed, lastSentAt = 0
    vi.setSystemTime(61_000);
    expect(checkOtpRequestLimit("a@example.test", null).allowed).toBe(true); // t=61s, allowed, lastSentAt = 61_000

    // If the gap were still measured against the window's own start (0, unmoved by a same-window call), 1ms
    // after the second request would incorrectly read "61.001s since the window started" and pass. Measured
    // against the true last-sent time (61_000), it must correctly refuse.
    vi.setSystemTime(61_001);
    expect(checkOtpRequestLimit("a@example.test", null).allowed).toBe(false);
  });

  it("allows again once a full 60 seconds have passed since the last actual send", () => {
    checkOtpRequestLimit("a@example.test", null);
    vi.setSystemTime(60_000);
    expect(checkOtpRequestLimit("a@example.test", null).allowed).toBe(true);
  });

  it("is case-insensitive on the email", () => {
    checkOtpRequestLimit("Asha@Example.Test", null);
    expect(checkOtpRequestLimit("asha@example.test", null).allowed).toBe(false);
  });

  it("a refusal never itself starts or resets the gap clock", () => {
    checkOtpRequestLimit("a@example.test", null); // t=0, lastSentAt=0
    vi.setSystemTime(30_000);
    checkOtpRequestLimit("a@example.test", null); // refused (only 30s passed); must not touch lastSentAt
    vi.setSystemTime(60_000);
    expect(checkOtpRequestLimit("a@example.test", null).allowed).toBe(true); // exactly 60s since the real t=0 send
  });

  it("two different emails never share a bucket", () => {
    checkOtpRequestLimit("a@example.test", null);
    expect(checkOtpRequestLimit("b@example.test", null).allowed).toBe(true);
  });
});

describe("checkOtpRequestLimit — the 5-per-15-minute cap", () => {
  it("allows exactly 5 requests spaced past the 60-second gap, refuses the 6th", () => {
    let allowedCount = 0;
    for (let i = 0; i < 6; i += 1) {
      vi.setSystemTime(i * 61_000);
      if (checkOtpRequestLimit("a@example.test", null).allowed) allowedCount += 1;
    }
    expect(allowedCount).toBe(5);
  });

  it("a new window (15+ minutes later) resets the cap", () => {
    for (let i = 0; i < 5; i += 1) {
      vi.setSystemTime(i * 61_000);
      checkOtpRequestLimit("a@example.test", null);
    }
    vi.setSystemTime(16 * 60_000);
    expect(checkOtpRequestLimit("a@example.test", null).allowed).toBe(true);
  });
});

describe("checkOtpRequestLimit — the per-IP cap", () => {
  it("caps one IP at 20 requests per 15 minutes across different emails", () => {
    // A different email each time, so there is no per-email 60-second gap to space around — spaced 1s apart,
    // well inside the 15-minute IP window (spacing near the window's own edge would let it roll over mid-loop).
    let allowedCount = 0;
    for (let i = 0; i < 21; i += 1) {
      vi.setSystemTime(i * 1_000);
      if (checkOtpRequestLimit(`u${i}@example.test`, "203.0.113.1").allowed) allowedCount += 1;
    }
    expect(allowedCount).toBe(20);
  });

  it("a null IP (no proxy) skips the IP cap entirely and only the email limits apply", () => {
    expect(checkOtpRequestLimit("a@example.test", null).allowed).toBe(true);
  });

  it("two different IPs never share a bucket", () => {
    checkOtpRequestLimit("a@example.test", "203.0.113.1");
    expect(checkOtpRequestLimit("b@example.test", "203.0.113.2").allowed).toBe(true);
  });
});

describe("checkOtpVerifyLimit", () => {
  it("allows up to 10 attempts per email in 15 minutes, refuses the 11th", () => {
    let allowedCount = 0;
    for (let i = 0; i < 11; i += 1) {
      if (checkOtpVerifyLimit("a@example.test", null).allowed) allowedCount += 1;
    }
    expect(allowedCount).toBe(10);
  });

  it("caps one IP at 40 verify attempts per 15 minutes", () => {
    let allowedCount = 0;
    for (let i = 0; i < 41; i += 1) {
      if (checkOtpVerifyLimit(`u${i}@example.test`, "203.0.113.1").allowed) allowedCount += 1;
    }
    expect(allowedCount).toBe(40);
  });

  it("never touches the request-side 60-second gap — a verify attempt must not block a fresh code request", () => {
    checkOtpVerifyLimit("a@example.test", null);
    checkOtpVerifyLimit("a@example.test", null);
    expect(checkOtpRequestLimit("a@example.test", null).allowed).toBe(true);
  });
});
