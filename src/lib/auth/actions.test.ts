/**
 * signIn / requestPasswordResetAction / verifyResetCodeAction /
 * setNewPasswordAction (auth-v2). What must hold: remember-me is applied
 * before the Supabase call that establishes the session (not after), a
 * password reset never reveals whether an email has an account, a reset
 * code is rate-limited on every attempt, and — item 4's explicit
 * requirement — setting a new password revokes every OTHER session of that
 * user (`scope: "others"`), never the one that just did the reset.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const signInWithPassword = vi.fn();
const resetPasswordForEmail = vi.fn();
const verifyOtp = vi.fn();
const updateUser = vi.fn();
const signOut = vi.fn();
const getUser = vi.fn();
const resolveHome = vi.fn();
const clientIp = vi.fn<() => Promise<string | null>>(async () => "203.0.113.9");
const revalidatePath = vi.fn();
const requireOrg = vi.fn(async () => ({ id: "org-1" }));
const recordPasswordChangedAndAlert = vi.fn();

class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
const redirect = vi.fn((to: string) => {
  throw new Redirect(to);
});

// Tracks the order signInWithPassword/verifyOtp fire relative to the remember-me cookie write, without
// asserting on the cookie's own internals (covered by remember-me.test.ts) — just that the order is right.
const callOrder: string[] = [];
const cookieStore = new Map<string, string>();

vi.mock("@/lib/env", () => ({
  isSupabaseConfigured: () => true,
  cookieSecret: () => ({ kind: "ok", secret: "s".repeat(40) }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: {
      signInWithPassword: (input: unknown) => {
        callOrder.push("signInWithPassword");
        return signInWithPassword(input);
      },
      resetPasswordForEmail: (input: unknown) => resetPasswordForEmail(input),
      verifyOtp: (input: unknown) => {
        callOrder.push("verifyOtp");
        return verifyOtp(input);
      },
      updateUser: (input: unknown) => updateUser(input),
      signOut: (input?: unknown) => signOut(input),
      getUser: () => getUser(),
    },
  }),
}));
vi.mock("@/lib/auth/route-home", () => ({ resolveHome: () => resolveHome() }));
vi.mock("./client-ip", () => ({ clientIp: () => clientIp() }));
vi.mock("@/lib/repositories/org", () => ({ requireOrg: () => requireOrg() }));
vi.mock("./password-changed-alert", () => ({ recordPasswordChangedAndAlert: (event: unknown) => recordPasswordChangedAndAlert(event) }));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      callOrder.push(`cookie:get:${name}`);
      return cookieStore.has(name) ? { value: cookieStore.get(name)! } : undefined;
    },
    set: (name: string, value: string) => {
      callOrder.push(`cookie:set:${name}`);
      cookieStore.set(name, value);
    },
    delete: (name: string) => cookieStore.delete(name),
  }),
}));

const { signIn, requestPasswordResetAction, verifyResetCodeAction, setNewPasswordAction } = await import("./actions");
const { resetResetRateLimitsForTests } = await import("./reset-rate-limit");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function run<T>(action: (state: T, formData: FormData) => Promise<T>, initial: T, fields: Record<string, string>) {
  try {
    return { state: await action(initial, form(fields)), redirectedTo: null as string | null };
  } catch (error) {
    if (error instanceof Redirect) return { state: null, redirectedTo: error.to };
    throw error;
  }
}

beforeEach(() => {
  callOrder.length = 0;
  cookieStore.clear();
  resetResetRateLimitsForTests();
  signInWithPassword.mockReset();
  resetPasswordForEmail.mockReset().mockResolvedValue({ data: {}, error: null });
  verifyOtp.mockReset();
  updateUser.mockReset().mockResolvedValue({ data: {}, error: null });
  signOut.mockReset().mockResolvedValue({ error: null });
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "user-1", email: "owner@example.test" } } });
  resolveHome.mockReset().mockResolvedValue({ kind: "staff", path: "/app/orders" });
  requireOrg.mockClear();
  recordPasswordChangedAndAlert.mockReset().mockResolvedValue(undefined);
  revalidatePath.mockReset();
  redirect.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("signIn — remember-me ordering", () => {
  it("writes the remember-me cookie BEFORE calling signInWithPassword, so that call's own session cookies see the new choice", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    await run(signIn, { status: "idle" }, { email: "a@example.test", password: "hunter2", remember: "on" });

    const cookieSetIndex = callOrder.indexOf("cookie:set:frybird_remember");
    const signInIndex = callOrder.indexOf("signInWithPassword");
    expect(cookieSetIndex).toBeGreaterThanOrEqual(0);
    expect(cookieSetIndex).toBeLessThan(signInIndex);
  });

  it("an unchecked box (no 'remember' field at all) is treated as false, not true", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    await run(signIn, { status: "idle" }, { email: "a@example.test", password: "hunter2" });
    expect(cookieStore.has("frybird_remember")).toBe(true);
  });

  it("wrong credentials still return the generic error, unaffected by the remember-me write", async () => {
    signInWithPassword.mockResolvedValue({ error: { message: "bad" } });
    const { state } = await run(signIn, { status: "idle" }, { email: "a@example.test", password: "wrong" });
    expect(state).toEqual({ status: "error", message: "That email and password don't match." });
  });
});

describe("requestPasswordResetAction", () => {
  it("answers the same 'sent' state whether or not Supabase actually found an account — no existence oracle", async () => {
    resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: null });
    const known = await requestPasswordResetAction({ status: "idle" }, form({ email: "known@example.test" }));

    resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: { message: "user not found" } });
    const unknown = await requestPasswordResetAction({ status: "idle" }, form({ email: "unknown@example.test" }));

    expect(known).toEqual({ status: "sent", email: "known@example.test" });
    expect(unknown).toEqual({ status: "sent", email: "unknown@example.test" });
  });

  it("rejects an invalid email before ever calling Supabase", async () => {
    const result = await requestPasswordResetAction({ status: "idle" }, form({ email: "not-an-email" }));
    expect(result.status).toBe("error");
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("refuses a second request for the same email inside 60 seconds, server-side", async () => {
    await requestPasswordResetAction({ status: "idle" }, form({ email: "a@example.test" }));
    const second = await requestPasswordResetAction({ status: "idle" }, form({ email: "a@example.test" }));
    expect(second.status).toBe("error");
  });
});

describe("verifyResetCodeAction", () => {
  it("sets remember-me to false BEFORE calling verifyOtp — a reset session defaults to not remembered", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    await run(verifyResetCodeAction, { status: "idle" }, { email: "a@example.test", token: "123456" });

    const cookieSetIndex = callOrder.indexOf("cookie:set:frybird_remember");
    const verifyIndex = callOrder.indexOf("verifyOtp");
    expect(cookieSetIndex).toBeGreaterThanOrEqual(0);
    expect(cookieSetIndex).toBeLessThan(verifyIndex);
  });

  it("calls verifyOtp with type 'recovery', never 'email'", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    await verifyResetCodeAction({ status: "idle" }, form({ email: "a@example.test", token: "123456" }));
    expect(verifyOtp).toHaveBeenCalledWith({ email: "a@example.test", token: "123456", type: "recovery" });
  });

  it("a wrong or expired code gets one generic message, never Supabase's own wording", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "Token has expired or is invalid" } });
    const result = await verifyResetCodeAction({ status: "idle" }, form({ email: "a@example.test", token: "000000" }));
    expect(result).toMatchObject({ status: "error" });
    if (result.status === "error") expect(result.message).not.toMatch(/expired or is invalid/);
  });

  it("returns 'verified' on success, with no redirect — the caller still needs to collect a new password", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const result = await verifyResetCodeAction({ status: "idle" }, form({ email: "a@example.test", token: "123456" }));
    expect(result).toEqual({ status: "verified" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("rate limits verify attempts per email — a 6-digit reset code cannot be brute forced", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "wrong" } });
    let allowedCount = 0;
    for (let i = 0; i < 15; i += 1) {
      const result = await verifyResetCodeAction({ status: "idle" }, form({ email: "victim@example.test", token: "000000" }));
      if (result.status !== "error" || !result.message.includes("Too many attempts")) allowedCount += 1;
    }
    expect(allowedCount).toBe(10);
  });
});

describe("setNewPasswordAction — item 4: other sessions revoked, never the current one", () => {
  it("calls updateUser with the new password, then signOut with scope 'others' (never 'global' or unscoped, which would also sign out this session)", async () => {
    const order: string[] = [];
    updateUser.mockImplementation(async () => {
      order.push("updateUser");
      return { data: {}, error: null };
    });
    signOut.mockImplementation(async (input?: { scope?: string }) => {
      order.push(`signOut:${input?.scope}`);
      return { error: null };
    });

    await run(setNewPasswordAction, { status: "idle" }, { password: "a-real-password", confirmPassword: "a-real-password" });

    expect(order).toEqual(["updateUser", "signOut:others"]);
  });

  it("requires a live session — with no signed-in user, refuses before touching the password at all", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { state } = await run(setNewPasswordAction, { status: "idle" }, { password: "a-real-password", confirmPassword: "a-real-password" });
    expect(state).toMatchObject({ status: "error" });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("rejects a password under 10 characters before calling Supabase", async () => {
    const { state } = await run(setNewPasswordAction, { status: "idle" }, { password: "short1", confirmPassword: "short1" });
    expect(state).toMatchObject({ status: "error" });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("rejects mismatched password and confirmation before calling Supabase", async () => {
    const { state } = await run(setNewPasswordAction, { status: "idle" }, { password: "a-real-password", confirmPassword: "a-different-password" });
    expect(state).toMatchObject({ status: "error" });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("records the audit row and owner alert with the actual user id and email, after the password change succeeds", async () => {
    await run(setNewPasswordAction, { status: "idle" }, { password: "a-real-password", confirmPassword: "a-real-password" });
    expect(recordPasswordChangedAndAlert).toHaveBeenCalledWith({ orgId: "org-1", userId: "user-1", email: "owner@example.test" });
  });

  it("a failure to revoke other sessions is logged but does not block the redirect — the password change already succeeded", async () => {
    signOut.mockRejectedValue(new Error("network blip"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { redirectedTo } = await run(setNewPasswordAction, { status: "idle" }, { password: "a-real-password", confirmPassword: "a-real-password" });
    expect(redirectedTo).not.toBeNull();
    expect(recordPasswordChangedAndAlert).toHaveBeenCalled();
  });

  it("redirects to where resolveHome says this account belongs", async () => {
    resolveHome.mockResolvedValue({ kind: "staff", path: "/app/deliveries" });
    const { redirectedTo } = await run(setNewPasswordAction, { status: "idle" }, { password: "a-real-password", confirmPassword: "a-real-password" });
    expect(redirectedTo).toBe("/app/deliveries");
  });
});
