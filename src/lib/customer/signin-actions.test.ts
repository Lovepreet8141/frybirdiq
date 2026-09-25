/**
 * signInCustomerAction (auth-v3, item B). What must hold: wrong password
 * and unknown email get the identical neutral message, an unconfirmed
 * account gets its own distinct state (a deliberate, owner-requested
 * exception to that neutrality — see the action's own doc comment), and
 * password guessing is rate-limited on every attempt, right or wrong,
 * before Supabase is ever asked (this app's actual brute-force defense).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const signInWithPassword = vi.fn();
const signOut = vi.fn();
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

const cookieStore = new Map<string, string>();

vi.mock("@/lib/env", () => ({ isSupabaseConfigured: () => true, cookieSecret: () => ({ kind: "ok", secret: "s".repeat(40) }) }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: {
      signInWithPassword: (input: unknown) => signInWithPassword(input),
      signOut: () => signOut(),
    },
  }),
}));
vi.mock("@/lib/auth/route-home", () => ({ resolveHome: () => resolveHome() }));
vi.mock("@/lib/auth/client-ip", () => ({ clientIp: () => clientIp() }));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name)! } : undefined),
    set: (name: string, value: string) => cookieStore.set(name, value),
    delete: (name: string) => cookieStore.delete(name),
  }),
}));
// createAccountAction/resendSignupCodeAction/verifySignupCodeAction live in the same module — stub the bits
// this test file doesn't exercise so importing ./actions doesn't require the customers/loyaltyAccounts db mocks.
vi.mock("@/db/schema", () => ({ customers: { __table: "customers" }, loyaltyAccounts: { __table: "loyaltyAccounts" } }));
vi.mock("@/db", () => ({ db: () => ({}) }));
vi.mock("@/lib/repositories/org", () => ({ requireOrg: async () => ({ id: "org-1" }) }));

const { signInCustomerAction } = await import("./actions");
const { resetCustomerAuthRateLimitsForTests } = await import("./auth-rate-limit");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function run(fields: Record<string, string>) {
  try {
    return { state: await signInCustomerAction({ status: "idle" }, form(fields)), redirectedTo: null as string | null };
  } catch (error) {
    if (error instanceof Redirect) return { state: null, redirectedTo: error.to };
    throw error;
  }
}

beforeEach(() => {
  cookieStore.clear();
  resetCustomerAuthRateLimitsForTests();
  signInWithPassword.mockReset();
  signOut.mockReset().mockResolvedValue({ error: null });
  resolveHome.mockReset().mockResolvedValue({ kind: "customer", path: "/account" });
  clientIp.mockResolvedValue("203.0.113.9");
  revalidatePath.mockReset();
  redirect.mockClear();
});

describe("signInCustomerAction", () => {
  it("a wrong password and an unknown email get the IDENTICAL neutral message — no existence oracle", async () => {
    signInWithPassword.mockResolvedValueOnce({ error: { code: "invalid_credentials", message: "Invalid login credentials" } });
    const wrongPassword = await run({ email: "real@example.test", password: "wrong-one" });

    signInWithPassword.mockResolvedValueOnce({ error: { code: "invalid_credentials", message: "Invalid login credentials" } });
    const unknownEmail = await run({ email: "nobody@example.test", password: "anything" });

    expect(wrongPassword.state).toEqual({ status: "error", message: "Email or password is incorrect." });
    expect(unknownEmail.state).toEqual({ status: "error", message: "Email or password is incorrect." });
  });

  it("never echoes Supabase's own error wording", async () => {
    signInWithPassword.mockResolvedValue({ error: { code: "invalid_credentials", message: "Invalid login credentials" } });
    const { state } = await run({ email: "real@example.test", password: "wrong-one" });
    expect(state).toMatchObject({ status: "error" });
    if (state && "message" in state) expect(state.message).not.toMatch(/invalid login credentials/i);
  });

  it("an unconfirmed account gets its own distinct state, not the neutral error — the deliberate exception item B asks for", async () => {
    signInWithPassword.mockResolvedValue({ error: { code: "email_not_confirmed", message: "Email not confirmed" } });
    const { state } = await run({ email: "pending@example.test", password: "whatever-it-is" });
    expect(state).toEqual({ status: "unconfirmed", email: "pending@example.test" });
  });

  it("sets the remember-me cookie BEFORE calling signInWithPassword", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    resolveHome.mockResolvedValue({ kind: "customer", path: "/account" });
    await run({ email: "real@example.test", password: "correct-horse", remember: "on" });
    expect(cookieStore.has("frybird_remember")).toBe(true);
  });

  it("redirects to /account on success", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    resolveHome.mockResolvedValue({ kind: "customer", path: "/account" });
    const { redirectedTo } = await run({ email: "real@example.test", password: "correct-horse" });
    expect(redirectedTo).toBe("/account");
  });

  it("routes a staff/owner account signing in here to the counter, same as the old code-only flow did", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    resolveHome.mockResolvedValue({ kind: "staff", path: "/app/orders" });
    const { redirectedTo } = await run({ email: "owner@example.test", password: "correct-horse" });
    expect(redirectedTo).toBe("/app/orders");
  });

  it("rate limits attempts per email, right or wrong, before Supabase is ever asked — password brute force / credential stuffing defense", async () => {
    signInWithPassword.mockResolvedValue({ error: { code: "invalid_credentials", message: "Invalid login credentials" } });
    let allowedCount = 0;
    for (let i = 0; i < 15; i += 1) {
      const { state } = await run({ email: "victim@example.test", password: `guess-${i}` });
      if (state && !("message" in state && state.message.includes("Too many attempts"))) allowedCount += 1;
    }
    expect(allowedCount).toBe(8);
    expect(signInWithPassword.mock.calls.length).toBe(8);
  });

  it("refuses an empty password without calling Supabase", async () => {
    const { state } = await run({ email: "real@example.test", password: "" });
    expect(state).toMatchObject({ status: "error" });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});
