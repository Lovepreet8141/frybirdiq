/**
 * checkSignupLimit / checkSignupVerifyLimit / checkSignInLimit — pure
 * rate-limit logic for customer password auth (auth-v3). Fail-first per the
 * card: password brute force must be cut off well short of a meaningful
 * fraction of the guess space, and a signup code must not be brute-forceable
 * either.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { checkSignInLimit, checkSignupLimit, checkSignupVerifyLimit, resetCustomerAuthRateLimitsForTests } from "./auth-rate-limit";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  resetCustomerAuthRateLimitsForTests();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("checkSignupLimit — the 60-second gap and the 5-per-15-minute cap", () => {
  it("allows the first signup/resend for an email, refuses a second 1ms later", () => {
    expect(checkSignupLimit("a@example.test", null).allowed).toBe(true);
    expect(checkSignupLimit("a@example.test", null).allowed).toBe(false);
  });

  it("allows exactly 5 spaced past the gap, refuses the 6th", () => {
    let allowedCount = 0;
    for (let i = 0; i < 6; i += 1) {
      vi.setSystemTime(i * 61_000);
      if (checkSignupLimit("a@example.test", null).allowed) allowedCount += 1;
    }
    expect(allowedCount).toBe(5);
  });

  it("caps one IP at 20 requests per 15 minutes across different emails", () => {
    let allowedCount = 0;
    for (let i = 0; i < 21; i += 1) {
      vi.setSystemTime(i * 1_000);
      if (checkSignupLimit(`u${i}@example.test`, "203.0.113.1").allowed) allowedCount += 1;
    }
    expect(allowedCount).toBe(20);
  });
});

describe("checkSignupVerifyLimit — a signup code cannot be brute forced", () => {
  it("allows up to 10 attempts per email in 15 minutes, refuses the 11th", () => {
    let allowedCount = 0;
    for (let i = 0; i < 11; i += 1) {
      if (checkSignupVerifyLimit("a@example.test", null).allowed) allowedCount += 1;
    }
    expect(allowedCount).toBe(10);
  });

  it("caps one IP at 40 verify attempts per 15 minutes", () => {
    let allowedCount = 0;
    for (let i = 0; i < 41; i += 1) {
      if (checkSignupVerifyLimit(`u${i}@example.test`, "203.0.113.1").allowed) allowedCount += 1;
    }
    expect(allowedCount).toBe(40);
  });
});

describe("checkSignInLimit — password brute force / credential stuffing (fail-first, required by the card)", () => {
  it("allows up to 8 attempts per email in 15 minutes, refuses the 9th — checked on every attempt, right or wrong", () => {
    let allowedCount = 0;
    for (let i = 0; i < 9; i += 1) {
      if (checkSignInLimit("victim@example.test", null).allowed) allowedCount += 1;
    }
    expect(allowedCount).toBe(8);
  });

  it("refuses the 9th attempt well before any meaningful fraction of an 8+ character password's guess space is tried", () => {
    for (let i = 0; i < 8; i += 1) checkSignInLimit("victim@example.test", null);
    expect(checkSignInLimit("victim@example.test", null).allowed).toBe(false);
  });

  it("caps one IP at 30 sign-in attempts per 15 minutes across different emails — an attacker cannot spread a credential-stuffing list across many addresses from one IP to dodge the per-email cap", () => {
    let allowedCount = 0;
    for (let i = 0; i < 31; i += 1) {
      if (checkSignInLimit(`u${i}@example.test`, "203.0.113.1").allowed) allowedCount += 1;
    }
    expect(allowedCount).toBe(30);
  });

  it("is case-insensitive on the email — attempts against Victim@Example.Test and victim@example.test share one cap", () => {
    for (let i = 0; i < 8; i += 1) checkSignInLimit("Victim@Example.Test", null);
    expect(checkSignInLimit("victim@example.test", null).allowed).toBe(false);
  });

  it("a new 15-minute window resets the cap", () => {
    for (let i = 0; i < 8; i += 1) checkSignInLimit("a@example.test", null);
    expect(checkSignInLimit("a@example.test", null).allowed).toBe(false);
    vi.setSystemTime(16 * 60_000);
    expect(checkSignInLimit("a@example.test", null).allowed).toBe(true);
  });

  it("has no minimum gap between attempts (unlike a code-send limit) — a real sign-in form has no resend button to space out", () => {
    expect(checkSignInLimit("a@example.test", null).allowed).toBe(true);
    expect(checkSignInLimit("a@example.test", null).allowed).toBe(true);
  });
});

describe("customer/auth-rate-limit is isolated from the other rate limiters", () => {
  it("shares no bucket with the staff/customer reset-code limiter — a different module, a different Map", async () => {
    const { checkResetVerifyLimit, resetResetRateLimitsForTests } = await import("@/lib/auth/reset-rate-limit");
    resetResetRateLimitsForTests();
    for (let i = 0; i < 10; i += 1) checkResetVerifyLimit("shared@example.test", null);
    expect(checkResetVerifyLimit("shared@example.test", null).allowed).toBe(false);
    expect(checkSignupVerifyLimit("shared@example.test", null).allowed).toBe(true);
  });
});
