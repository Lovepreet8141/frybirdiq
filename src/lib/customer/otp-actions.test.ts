/**
 * requestOtpAction / verifyOtpAction — the customer email-OTP login flow
 * (email-otp card). What must hold: never reveal whether an email has an
 * account, never let the browser claim a status Supabase didn't verify, a
 * six-digit code is never brute-forceable (rate limited on every attempt,
 * not just on request), and a resend is refused inside 60 seconds
 * server-side, not just by a disabled client button.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resetOtpRateLimitsForTests } from "@/lib/auth/otp-rate-limit";

const signInWithOtp = vi.fn();
const verifyOtp = vi.fn();
const resolveHome = vi.fn();
const clientIp = vi.fn<() => Promise<string | null>>(async () => "203.0.113.9");
const revalidatePath = vi.fn();

class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
const redirect = vi.fn((to: string) => {
  throw new Redirect(to);
});

vi.mock("@/lib/env", () => ({
  isSupabaseConfigured: () => true,
  serverEnv: () => ({ SITE_URL: "https://frybirdiq.tech" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { signInWithOtp: (input: unknown) => signInWithOtp(input), verifyOtp: (input: unknown) => verifyOtp(input) } }),
}));
vi.mock("@/lib/auth/route-home", () => ({ resolveHome: () => resolveHome() }));
vi.mock("@/lib/auth/client-ip", () => ({ clientIp: () => clientIp() }));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

const { requestOtpAction, verifyOtpAction } = await import("./actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function runVerify(fields: Record<string, string>) {
  try {
    return { state: await verifyOtpAction({ status: "idle" }, form(fields)), redirectedTo: null as string | null };
  } catch (error) {
    if (error instanceof Redirect) return { state: null, redirectedTo: error.to };
    throw error;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  clientIp.mockResolvedValue("203.0.113.9");
  resetOtpRateLimitsForTests();
});

describe("requestOtpAction", () => {
  it("refuses an invalid email without calling Supabase", async () => {
    const result = await requestOtpAction({ status: "idle" }, form({ email: "not-an-email" }));
    expect(result.status).toBe("error");
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("calls signInWithOtp with shouldCreateUser false and a runtime-read redirect URL — never inlined at build time", async () => {
    signInWithOtp.mockResolvedValue({ data: {}, error: null });
    await requestOtpAction({ status: "idle" }, form({ email: "asha@example.test" }));
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "asha@example.test",
      options: { shouldCreateUser: false, emailRedirectTo: "https://frybirdiq.tech/auth/confirm" },
    });
  });

  it("answers the same 'sent' state whether Supabase actually sent an email or refused an unknown address — no existence oracle", async () => {
    signInWithOtp.mockResolvedValueOnce({ data: {}, error: null });
    const sent = await requestOtpAction({ status: "idle" }, form({ email: "known@example.test" }));

    signInWithOtp.mockResolvedValueOnce({ data: {}, error: { message: "Signups not allowed for otp", status: 400 } });
    const unknown = await requestOtpAction({ status: "idle" }, form({ email: "unknown@example.test" }));

    expect(sent.status).toBe("sent");
    expect(unknown.status).toBe("sent");
  });

  describe("rate limiting (fake clock, for deterministic windows)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("refuses a resend inside 60 seconds, server-side, without calling Supabase a second time", async () => {
      signInWithOtp.mockResolvedValue({ data: {}, error: null });
      const first = await requestOtpAction({ status: "idle" }, form({ email: "asha@example.test" }));
      expect(first.status).toBe("sent");
      expect(signInWithOtp).toHaveBeenCalledTimes(1);

      vi.setSystemTime(59_000); // 59s later — still inside the 60s gap
      const second = await requestOtpAction({ status: "idle" }, form({ email: "asha@example.test" }));
      expect(second.status).toBe("error");
      expect(signInWithOtp).toHaveBeenCalledTimes(1); // still just the one call

      vi.setSystemTime(60_001); // just past 60s
      const third = await requestOtpAction({ status: "idle" }, form({ email: "asha@example.test" }));
      expect(third.status).toBe("sent");
      expect(signInWithOtp).toHaveBeenCalledTimes(2);
    });

    it("caps one email at 5 requests per 15 minutes even once each is spaced past the 60-second gap", async () => {
      signInWithOtp.mockResolvedValue({ data: {}, error: null });
      let sent = 0;
      for (let i = 0; i < 5; i += 1) {
        vi.setSystemTime(i * 61_000); // just past the 60s gap each time, well inside the 15-minute window
        const result = await requestOtpAction({ status: "idle" }, form({ email: "capped@example.test" }));
        if (result.status === "sent") sent += 1;
      }
      expect(sent).toBe(5);
      expect(signInWithOtp).toHaveBeenCalledTimes(5);

      vi.setSystemTime(5 * 61_000); // still past the gap, still inside the 15-minute window — the 6th is the cap
      const sixth = await requestOtpAction({ status: "idle" }, form({ email: "capped@example.test" }));
      expect(sixth.status).toBe("error");
      expect(signInWithOtp).toHaveBeenCalledTimes(5);
    });

    it("applies a per-IP cap independent of the email — one IP requesting codes for 21 different emails is refused on the 21st", async () => {
      signInWithOtp.mockResolvedValue({ data: {}, error: null });
      clientIp.mockResolvedValue("198.51.100.1");
      // A different email each time, so there is no per-email 60-second gap to space around — spaced 1s apart,
      // well inside the 15-minute IP window.
      let sent = 0;
      for (let i = 0; i < 20; i += 1) {
        vi.setSystemTime(i * 1_000);
        const result = await requestOtpAction({ status: "idle" }, form({ email: `ip-cap-${i}@example.test` }));
        if (result.status === "sent") sent += 1;
      }
      expect(sent).toBe(20);

      vi.setSystemTime(20_000);
      const blocked = await requestOtpAction({ status: "idle" }, form({ email: "ip-cap-final@example.test" }));
      expect(blocked.status).toBe("error");
      expect(signInWithOtp).toHaveBeenCalledTimes(20);
    });
  });
});

describe("verifyOtpAction", () => {
  it("refuses a malformed code without calling Supabase", async () => {
    const result = await runVerify({ email: "asha@example.test", token: "12" });
    expect(result.state).toMatchObject({ status: "error" });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("calls verifyOtp with type 'email' and forwards exactly the email and token", async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    resolveHome.mockResolvedValue({ kind: "customer", path: null });
    await runVerify({ email: "asha@example.test", token: "123456" });
    expect(verifyOtp).toHaveBeenCalledWith({ email: "asha@example.test", token: "123456", type: "email" });
  });

  it("a wrong or expired code gets one generic message, never Supabase's own wording", async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: { message: "Token has expired or is invalid", status: 403 } });
    const { state } = await runVerify({ email: "asha@example.test", token: "000000" });
    expect(state).toMatchObject({ status: "error" });
    expect(state && "message" in state ? state.message : "").not.toMatch(/expired or is invalid/i);
  });

  it("redirects a customer to /account on success", async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    resolveHome.mockResolvedValue({ kind: "customer", path: null });
    const { redirectedTo } = await runVerify({ email: "asha@example.test", token: "123456" });
    expect(redirectedTo).toBe("/account");
  });

  it("redirects staff to /app/orders on success, same as password sign-in", async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    resolveHome.mockResolvedValue({ kind: "staff", path: null });
    const { redirectedTo } = await runVerify({ email: "manager@example.test", token: "123456" });
    expect(redirectedTo).toBe("/app/orders");
  });

  it("tells a confirmed account with no customer row, rather than redirecting into a page it cannot see", async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    resolveHome.mockResolvedValue({ kind: "neither", path: null });
    const { state } = await runVerify({ email: "orphan@example.test", token: "123456" });
    expect(state).toMatchObject({ status: "error" });
  });

  it("rate limits verify attempts per email, cutting attempts off before Supabase is asked 15 times — a code cannot be brute-forced", async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: { message: "wrong", status: 403 } });
    for (let i = 0; i < 15; i += 1) {
      await runVerify({ email: "brute@example.test", token: String(100000 + i).padStart(6, "0") });
    }
    expect(verifyOtp.mock.calls.length).toBeLessThan(15);
  });

  it("a wrong-code attempt never counts against the resend gap — guessing wrong must not block requesting a fresh code", async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: { message: "wrong", status: 403 } });
    await runVerify({ email: "asha@example.test", token: "000000" });

    signInWithOtp.mockResolvedValue({ data: {}, error: null });
    const resend = await requestOtpAction({ status: "idle" }, form({ email: "asha@example.test" }));
    expect(resend.status).toBe("sent");
  });
});
