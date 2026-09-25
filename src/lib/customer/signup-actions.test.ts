/**
 * createAccountAction / resendSignupCodeAction / verifySignupCodeAction
 * (auth-v3, item A). What must hold: signup never reveals whether an email
 * already has an account, NOTHING is written to customers/loyaltyAccounts
 * until the code is actually verified (a security-review finding: writing
 * at signup time let an attacker pre-seed a stranger's future account with
 * attacker-chosen name/phone, and separately let an unconfirmed signup
 * permanently squat a real phone number — both closed by deferring the
 * write to verifySignupCodeAction, after email ownership is proven), a
 * SIGNED profileToken carries name/phone between the two steps rather than
 * plain hidden fields (a red-team finding on the FIRST fix: unsigned hidden
 * fields let anyone attach an arbitrary unclaimed phone to their own
 * genuinely-verified account — a tampered, forged, or wrong-email token
 * must be silently ignored, never trusted), a phone collision never seizes
 * another account's history, the confirmation code is verified with type
 * 'signup' and rate-limited on every attempt, and remember-me defaults to
 * the customer default (ticked) with no checkbox on this form.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeContactCookie } from "@/lib/cart/contact-cookie";

vi.mock("server-only", () => ({}));

// Matches the cookieSecret() mock below exactly, so profileTokens built here decode the same way
// createAccountAction's own signProfile() would sign them.
const SECRET = "s".repeat(40);
function signedProfile(email: string, name: string, phone: string): string {
  return encodeContactCookie({ purpose: "signup-profile", email, name, phone }, SECRET);
}

const signUp = vi.fn();
const resend = vi.fn();
const verifyOtp = vi.fn();
const getUser = vi.fn();
const signOut = vi.fn();
const resolveHome = vi.fn();
const clientIp = vi.fn<() => Promise<string | null>>(async () => "203.0.113.9");
const revalidatePath = vi.fn();
const requireOrg = vi.fn(async () => ({ id: "org-1" }));

class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
const redirect = vi.fn((to: string) => {
  throw new Redirect(to);
});

interface CustomerRow {
  id: string;
  userId: string | null;
  phone: string | null;
}

const state = {
  /** The customers row for THIS user, if a verify already created one (idempotency). */
  ownRow: null as CustomerRow | null,
  /** The customers row already sitting under the phone about to be attached, if any. */
  phoneRow: null as CustomerRow | null,
  inserted: null as CustomerRow | null,
  loyaltyInserted: false,
  /** Simulates losing the customers_org_user_unique (0057) race: the insert's .returning() resolves empty. */
  loseUserConflict: false,
  /** Simulates losing the customers_org_phone_unique race: the FIRST insert attempt (with a phone) throws. */
  losePhoneConflict: false,
};
let selectCallCount = 0;

vi.mock("@/lib/env", () => ({ isSupabaseConfigured: () => true, cookieSecret: () => ({ kind: "ok", secret: SECRET }) }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: {
      signUp: (input: unknown) => signUp(input),
      resend: (input: unknown) => resend(input),
      verifyOtp: (input: unknown) => {
        callOrder.push("verifyOtp");
        return verifyOtp(input);
      },
      getUser: () => getUser(),
      signOut: () => signOut(),
    },
  }),
}));
vi.mock("@/lib/auth/route-home", () => ({ resolveHome: () => resolveHome() }));
vi.mock("@/lib/auth/client-ip", () => ({ clientIp: () => clientIp() }));
vi.mock("@/lib/repositories/org", () => ({ requireOrg: () => requireOrg() }));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
const callOrder: string[] = [];
const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name)! } : undefined),
    set: (name: string, value: string) => {
      callOrder.push(`cookie:set:${name}`);
      cookieStore.set(name, value);
    },
    delete: (name: string) => cookieStore.delete(name),
  }),
}));
vi.mock("@/db/schema", () => ({ customers: { __table: "customers" }, loyaltyAccounts: { __table: "loyaltyAccounts" } }));
vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => {
          selectCallCount += 1;
          // verifySignupCodeAction's own-row check runs first, the phone-collision check second (only when
          // a phone was submitted) — a fixed, known order, matching completeProfileAction's old test pattern.
          const rows = selectCallCount === 1 ? (state.ownRow ? [state.ownRow] : []) : state.phoneRow ? [state.phoneRow] : [];
          return { limit: async () => rows };
        },
      }),
    }),
    insert: (table: { __table?: string }) => ({
      values: (row: Record<string, unknown>) => {
        if (table.__table === "loyaltyAccounts") state.loyaltyInserted = true;
        const doReturning = async () => {
          if (table.__table === "customers") {
            if (row.phone && state.losePhoneConflict) throw Object.assign(new Error("duplicate key value violates unique constraint \"customers_org_phone_unique\""), { code: "23505" });
            if (state.loseUserConflict) return [];
            state.inserted = { id: "cust-new", userId: row.userId as string, phone: row.phone as string | null };
            return [state.inserted];
          }
          return [{}];
        };
        return {
          returning: doReturning,
          onConflictDoNothing: (_opts?: unknown) => Object.assign(Promise.resolve([{}]), { returning: doReturning }),
        };
      },
    }),
  }),
}));

const { createAccountAction, resendSignupCodeAction, verifySignupCodeAction } = await import("./actions");
const { resetCustomerAuthRateLimitsForTests } = await import("./auth-rate-limit");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function runVerify(fields: Record<string, string>) {
  try {
    return { state: await verifySignupCodeAction({ status: "idle" }, form(fields)), redirectedTo: null as string | null };
  } catch (error) {
    if (error instanceof Redirect) return { state: null, redirectedTo: error.to };
    throw error;
  }
}

const validSignup = { name: "Asha", phone: "9000000001", email: "asha@example.test", password: "correct-horse", confirmPassword: "correct-horse" };

beforeEach(() => {
  callOrder.length = 0;
  cookieStore.clear();
  selectCallCount = 0;
  state.ownRow = null;
  state.phoneRow = null;
  state.inserted = null;
  state.loyaltyInserted = false;
  state.loseUserConflict = false;
  state.losePhoneConflict = false;
  resetCustomerAuthRateLimitsForTests();
  signUp.mockReset().mockResolvedValue({ data: { user: { id: "user-1" }, session: null }, error: null });
  resend.mockReset().mockResolvedValue({ data: {}, error: null });
  verifyOtp.mockReset();
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "user-1", email: "asha@example.test" } } });
  signOut.mockReset().mockResolvedValue({ error: null });
  resolveHome.mockReset().mockResolvedValue({ kind: "customer", path: "/account" });
  clientIp.mockResolvedValue("203.0.113.9");
  revalidatePath.mockReset();
  requireOrg.mockClear();
  redirect.mockClear();
});

describe("createAccountAction", () => {
  it("rejects a password under 8 characters before calling Supabase", async () => {
    const result = await createAccountAction({ status: "idle" }, form({ ...validSignup, password: "short1", confirmPassword: "short1" }));
    expect(result).toMatchObject({ status: "error" });
    expect(signUp).not.toHaveBeenCalled();
  });

  it("rejects mismatched password and confirmation before calling Supabase", async () => {
    const result = await createAccountAction({ status: "idle" }, form({ ...validSignup, confirmPassword: "something-else" }));
    expect(result).toMatchObject({ status: "error" });
    expect(signUp).not.toHaveBeenCalled();
  });

  it("rejects an invalid phone before calling Supabase", async () => {
    const result = await createAccountAction({ status: "idle" }, form({ ...validSignup, phone: "12345" }));
    expect(result).toMatchObject({ status: "error" });
    expect(signUp).not.toHaveBeenCalled();
  });

  it("calls signUp with just email and password — no emailRedirectTo, no link", async () => {
    await createAccountAction({ status: "idle" }, form(validSignup));
    expect(signUp).toHaveBeenCalledWith({ email: "asha@example.test", password: "correct-horse" });
  });

  it("security-review finding: writes NOTHING to customers/loyaltyAccounts at signup time — an unproven email must never get a durable row, attacker-controlled or otherwise", async () => {
    await createAccountAction({ status: "idle" }, form(validSignup));
    expect(state.inserted).toBeNull();
    expect(state.loyaltyInserted).toBe(false);
  });

  it("carries a signed profileToken forward in the 'sent' state, whose contents decode to exactly what was submitted — never writes them anywhere itself", async () => {
    const result = await createAccountAction({ status: "idle" }, form(validSignup));
    expect(result.status).toBe("sent");
    const token = result.status === "sent" ? result.profileToken : null;
    expect(token).not.toBeNull();
    const { decodeContactCookie } = await import("@/lib/cart/contact-cookie");
    expect(decodeContactCookie(token!, SECRET)).toEqual({ purpose: "signup-profile", email: "asha@example.test", name: "Asha", phone: "9000000001" });
  });

  it("answers the same 'sent' state whether or not the email already has an account — no existence oracle (Supabase's own signUp() silently no-ops a duplicate when Confirm email is on)", async () => {
    const fresh = await createAccountAction({ status: "idle" }, form(validSignup));

    signUp.mockResolvedValueOnce({ data: { user: { id: "user-1" }, session: null }, error: null });
    const duplicate = await createAccountAction({ status: "idle" }, form({ ...validSignup, email: "existing@example.test" }));

    expect(fresh.status).toBe("sent");
    expect(duplicate.status).toBe("sent");
  });

  it("defense in depth: a Dashboard configuration where Supabase DOES return user_already_exists for a duplicate also answers 'sent', not an error", async () => {
    signUp.mockResolvedValue({ data: { user: null, session: null }, error: { code: "user_already_exists", message: "User already registered" } });
    const result = await createAccountAction({ status: "idle" }, form(validSignup));
    expect(result.status).toBe("sent");
  });

  it("a genuinely weak password (Supabase's own policy) is surfaced with its own message", async () => {
    signUp.mockResolvedValue({ data: { user: null, session: null }, error: { code: "weak_password", message: "Password should contain at least one number" } });
    const result = await createAccountAction({ status: "idle" }, form(validSignup));
    expect(result).toEqual({ status: "error", message: "Choose a stronger password." });
  });

  it("refuses a second signup submission for the same email inside 60 seconds, server-side", async () => {
    await createAccountAction({ status: "idle" }, form(validSignup));
    const second = await createAccountAction({ status: "idle" }, form(validSignup));
    expect(second.status).toBe("error");
  });
});

describe("resendSignupCodeAction", () => {
  it("calls Supabase's resend with type 'signup', not a second signUp()", async () => {
    await resendSignupCodeAction({ status: "idle" }, form({ email: "asha@example.test" }));
    expect(resend).toHaveBeenCalledWith({ type: "signup", email: "asha@example.test" });
  });

  it("refuses a resend inside 60 seconds, server-side", async () => {
    await resendSignupCodeAction({ status: "idle" }, form({ email: "asha@example.test" }));
    const second = await resendSignupCodeAction({ status: "idle" }, form({ email: "asha@example.test" }));
    expect(second.status).toBe("error");
  });
});

describe("verifySignupCodeAction", () => {
  it("calls verifyOtp with type 'signup'", async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    await runVerify({ email: "asha@example.test", token: "123456", profileToken: signedProfile("asha@example.test", "Asha", "9000000001") });
    expect(verifyOtp).toHaveBeenCalledWith({ email: "asha@example.test", token: "123456", type: "signup" });
  });

  it("sets remember-me to true (the customer default) BEFORE verifying — there is no checkbox on this form", async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    await runVerify({ email: "asha@example.test", token: "123456", profileToken: signedProfile("asha@example.test", "Asha", "9000000001") });

    const cookieSetIndex = callOrder.indexOf("cookie:set:frybird_remember");
    const verifyIndex = callOrder.indexOf("verifyOtp");
    expect(cookieSetIndex).toBeGreaterThanOrEqual(0);
    expect(cookieSetIndex).toBeLessThan(verifyIndex);
    expect(cookieStore.has("frybird_remember")).toBe(true);
  });

  it("a wrong or expired code gets one generic message, never Supabase's own wording, and writes nothing", async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: { message: "Token has expired or is invalid" } });
    const { state: result } = await runVerify({ email: "asha@example.test", token: "000000", profileToken: signedProfile("asha@example.test", "Asha", "9000000001") });
    expect(result).toMatchObject({ status: "error" });
    if (result && "message" in result) expect(result.message).not.toMatch(/expired or is invalid/i);
    expect(state.inserted).toBeNull();
  });

  it("on success: creates the customers row using THIS session's own proven user id, with the name/phone decoded from a validly signed profileToken — this is where the write finally happens", async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    await runVerify({ email: "asha@example.test", token: "123456", profileToken: signedProfile("asha@example.test", "Asha", "9000000001") });
    expect(state.inserted).toEqual({ id: "cust-new", userId: "user-1", phone: "9000000001" });
    expect(state.loyaltyInserted).toBe(true);
  });

  it("redirects to /account on success", async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    const { redirectedTo } = await runVerify({ email: "asha@example.test", token: "123456", profileToken: signedProfile("asha@example.test", "Asha", "9000000001") });
    expect(redirectedTo).toBe("/account");
  });

  it("is idempotent — a double verify (the account already has a row) never inserts a second one", async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    state.ownRow = { id: "cust-existing", userId: "user-1", phone: "9000000001" };
    const { redirectedTo } = await runVerify({ email: "asha@example.test", token: "123456", profileToken: signedProfile("asha@example.test", "Asha", "9000000001") });
    expect(redirectedTo).toBe("/account");
    expect(state.inserted).toBeNull();
  });

  it("refuses when the phone already belongs to another real account — safe to say so now, since this session has proven email ownership", async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    state.phoneRow = { id: "cust-other", userId: "user-2", phone: "9000000001" };
    const { state: result } = await runVerify({ email: "asha@example.test", token: "123456", profileToken: signedProfile("asha@example.test", "Asha", "9000000001") });
    expect(result).toMatchObject({ status: "error", message: expect.stringContaining("already has an account") });
    expect(state.inserted).toBeNull();
  });

  it("an existing UNCLAIMED guest row under the phone (no userId) is never seized — the account is created without the phone, not refused", async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    state.phoneRow = { id: "cust-guest", userId: null, phone: "9000000001" };
    const { redirectedTo } = await runVerify({ email: "asha@example.test", token: "123456", profileToken: signedProfile("asha@example.test", "Asha", "9000000001") });
    expect(redirectedTo).toBe("/account");
    expect(state.inserted?.phone).toBeNull();
  });

  it("a concurrent verify that loses the customers_org_user_unique race (0057) still redirects to /account, not an error", async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    state.loseUserConflict = true;
    const { redirectedTo } = await runVerify({ email: "asha@example.test", token: "123456", profileToken: signedProfile("asha@example.test", "Asha", "9000000001") });
    expect(redirectedTo).toBe("/account");
    expect(state.inserted).toBeNull();
  });

  it("security-review finding: a concurrent verify that loses the customers_org_phone_unique race is caught and retried without the phone, not left as a raw DB error", async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    state.losePhoneConflict = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { redirectedTo } = await runVerify({ email: "asha@example.test", token: "123456", profileToken: signedProfile("asha@example.test", "Asha", "9000000001") });
    expect(redirectedTo).toBe("/account");
    expect(state.inserted?.phone).toBeNull();
  });

  it("the recovery path from sign-in's 'send me a code' (no profileToken submitted) still creates a row, so a proven session never dead-ends into resolveHome()'s 'neither'", async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    const { redirectedTo } = await runVerify({ email: "asha@example.test", token: "123456" });
    expect(redirectedTo).toBe("/account");
    expect(state.inserted).toEqual({ id: "cust-new", userId: "user-1", phone: null });
  });

  it("defensively signs out and errors rather than leaving a real session dead-ended, if resolveHome() somehow still says 'neither' after the write", async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    resolveHome.mockResolvedValue({ kind: "neither", path: null });
    const { state: result } = await runVerify({ email: "asha@example.test", token: "123456", profileToken: signedProfile("asha@example.test", "Asha", "9000000001") });
    expect(result).toMatchObject({ status: "error" });
    expect(signOut).toHaveBeenCalled();
  });

  describe("red-team finding: a client-editable profileToken must never be trusted — tampering is silently ignored, not honored", () => {
    it("a hand-edited/forged token (garbage, or a real cookie signed with the WRONG secret) is treated as absent — the account is still created, just with no name/phone, never an error", async () => {
      verifyOtp.mockResolvedValue({ data: {}, error: null });
      const forged = encodeContactCookie({ email: "asha@example.test", name: "Attacker", phone: "9999999999" }, "wrong-secret-entirely-different-from-the-real-one!!!!");
      const { redirectedTo } = await runVerify({ email: "asha@example.test", token: "123456", profileToken: forged });
      expect(redirectedTo).toBe("/account");
      expect(state.inserted).toEqual({ id: "cust-new", userId: "user-1", phone: null });
    });

    it("THE core exploit this closes: a validly-signed token issued for a DIFFERENT email than the one just verified is never honored, even though its signature is genuine", async () => {
      verifyOtp.mockResolvedValue({ data: {}, error: null });
      // An attacker who legitimately signed up as attacker@example.test holds a real, validly-signed token —
      // but edits the email/token fields to verify a code for asha@example.test instead (or, equivalently,
      // replays this exact token against a different verify submission). The token's OWN embedded email
      // no longer matches the email this code was actually verified for, so it must be ignored.
      const attackersOwnToken = signedProfile("attacker@example.test", "Attacker", "9999999999");
      const { redirectedTo } = await runVerify({ email: "asha@example.test", token: "123456", profileToken: attackersOwnToken });
      expect(redirectedTo).toBe("/account");
      expect(state.inserted).toEqual({ id: "cust-new", userId: "user-1", phone: null });
    });

    it("plain valid JSON with the right shape but no real signature is rejected, not parsed", async () => {
      verifyOtp.mockResolvedValue({ data: {}, error: null });
      const unsigned = Buffer.from(JSON.stringify({ email: "asha@example.test", name: "Attacker", phone: "9999999999" })).toString("base64url");
      const { redirectedTo } = await runVerify({ email: "asha@example.test", token: "123456", profileToken: `v1.${unsigned}.not-a-real-signature` });
      expect(redirectedTo).toBe("/account");
      expect(state.inserted).toEqual({ id: "cust-new", userId: "user-1", phone: null });
    });

    it("security-review hygiene note: a correctly-signed token of the WRONG kind (e.g. frybird_contact's own {name,phone,email} shape, same secret, no 'purpose' tag) is rejected, not accidentally accepted as a signup profile", async () => {
      verifyOtp.mockResolvedValue({ data: {}, error: null });
      // Same secret, same generic signer, same field names as a real frybird_contact cookie — the ONLY
      // difference from a genuine signup profileToken is the missing `purpose` literal.
      const contactShaped = encodeContactCookie({ email: "asha@example.test", name: "Asha", phone: "9000000001" }, SECRET);
      const { redirectedTo } = await runVerify({ email: "asha@example.test", token: "123456", profileToken: contactShaped });
      expect(redirectedTo).toBe("/account");
      expect(state.inserted).toEqual({ id: "cust-new", userId: "user-1", phone: null });
    });
  });

  it("rate limits verify attempts per email — a 6-digit signup code cannot be brute forced", async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: { message: "wrong" } });
    let allowedCount = 0;
    for (let i = 0; i < 15; i += 1) {
      const { state: result } = await runVerify({ email: "victim@example.test", token: "000000" });
      if (result && !("message" in result && result.message.includes("Too many attempts"))) allowedCount += 1;
    }
    expect(allowedCount).toBe(10);
  });
});
