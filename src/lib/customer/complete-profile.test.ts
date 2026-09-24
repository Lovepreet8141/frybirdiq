/**
 * completeProfileAction (auth-v2): the profile-completion step after a
 * brand-new (or old orphaned) account's first code verify. What must hold:
 * it acts only on the CALLER'S OWN session id (never anything the form
 * supplies), it's idempotent on a double-submit, and it carries over the
 * exact phone-collision-avoidance rule `createAccount` used to have — an
 * existing (guest) row for a typed phone number is never silently seized
 * by a new account.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getUser = vi.fn();
const requireOrg = vi.fn(async () => ({ id: "org-1" }));
const revalidatePath = vi.fn();

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
  /** The customers row for THIS user (if the account was already completed — makes the action idempotent). */
  ownRow: null as CustomerRow | null,
  /** The customers row already sitting under the phone number about to be submitted, if any (guest history). */
  phoneRow: null as CustomerRow | null,
  inserted: null as CustomerRow | null,
};
let selectCallCount = 0;

vi.mock("@/lib/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ auth: { getUser: () => getUser() } }) }));
vi.mock("@/lib/repositories/org", () => ({ requireOrg: () => requireOrg() }));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
vi.mock("@/db/schema", () => ({ customers: { __table: "customers" }, loyaltyAccounts: { __table: "loyaltyAccounts" } }));
vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => {
          selectCallCount += 1;
          // completeProfileAction's own-row check runs first, the phone-collision check second — a fixed,
          // known order, so the call count alone is enough to answer each with the right canned row.
          const rows = selectCallCount === 1 ? (state.ownRow ? [state.ownRow] : []) : state.phoneRow ? [state.phoneRow] : [];
          return { limit: async () => rows };
        },
      }),
    }),
    insert: (table: { __table?: string }) => ({
      values: (row: Record<string, unknown>) => ({
        returning: async () => {
          if (table.__table === "customers") {
            state.inserted = { id: "cust-new", userId: row.userId as string, phone: row.phone as string | null };
            return [state.inserted];
          }
          return [{}];
        },
        onConflictDoNothing: async () => [{}],
      }),
    }),
  }),
}));

const { completeProfileAction } = await import("./actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function run(fields: Record<string, string>) {
  try {
    return { state: await completeProfileAction({ status: "idle" }, form(fields)), redirectedTo: null as string | null };
  } catch (error) {
    if (error instanceof Redirect) return { state: null, redirectedTo: error.to };
    throw error;
  }
}

beforeEach(() => {
  selectCallCount = 0;
  state.ownRow = null;
  state.phoneRow = null;
  state.inserted = null;
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "user-1", email: "new@example.test" } } });
  requireOrg.mockClear();
  revalidatePath.mockReset();
  redirect.mockClear();
});

describe("completeProfileAction", () => {
  it("requires a live session — refuses before touching the database at all with no signed-in user", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { state: result } = await run({ name: "Asha", phone: "9000000001" });
    expect(result).toMatchObject({ status: "error" });
  });

  it("acts on the session's own user id, never anything the form supplies (there is no userId field at all)", async () => {
    await run({ name: "Asha", phone: "9000000001" });
    expect(state.inserted?.userId).toBe("user-1");
  });

  it("rejects an invalid phone before touching the database", async () => {
    const { state: result } = await run({ name: "Asha", phone: "12345" });
    expect(result).toMatchObject({ status: "error" });
    expect(state.inserted).toBeNull();
  });

  it("is idempotent — a double-submit (the account already has a row) redirects straight through, no second insert", async () => {
    state.ownRow = { id: "cust-existing", userId: "user-1", phone: "9000000001" };
    const { redirectedTo } = await run({ name: "Asha", phone: "9000000001" });
    expect(redirectedTo).toBe("/account");
    expect(state.inserted).toBeNull();
  });

  it("attaches the phone when nothing already sits under it", async () => {
    await run({ name: "Asha", phone: "9000000001" });
    expect(state.inserted?.phone).toBe("9000000001");
  });

  it("refuses when the phone already belongs to another real account (has a userId)", async () => {
    state.phoneRow = { id: "cust-other", userId: "user-2", phone: "9000000001" };
    const { state: result } = await run({ name: "Asha", phone: "9000000001" });
    expect(result).toMatchObject({ status: "error" });
    expect(state.inserted).toBeNull();
  });

  it("an existing UNCLAIMED guest row under the phone (no userId) is never seized — the new account gets no phone, not the guest's history", async () => {
    state.phoneRow = { id: "cust-guest", userId: null, phone: "9000000001" };
    const { redirectedTo } = await run({ name: "Asha", phone: "9000000001" });
    expect(redirectedTo).toBe("/account");
    expect(state.inserted?.phone).toBeNull();
  });

  it("redirects to /account on success", async () => {
    const { redirectedTo } = await run({ name: "Asha", phone: "9000000001" });
    expect(redirectedTo).toBe("/account");
  });
});
