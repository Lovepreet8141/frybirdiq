/**
 * placeOrder: the ordering gate is asked AGAIN at the moment of writing.
 *
 * The gate at the top of the request reads the organization once. Delivery
 * quote, pricing, the customer and promo writes come after it, so a pause (or a
 * closing time) that lands in that gap used to let one order through. These
 * tests land it in the gap on purpose — `resolvePricingContext` runs after the
 * top gate and before any write, so the hook there is exactly "after the gate,
 * before the order" — and prove:
 *   - the order is refused and nothing is written;
 *   - the refusal is not stored as the idempotency key's answer (the same key,
 *     retried after the shop reopens, is a fresh attempt that succeeds);
 *   - a pause that is COMMITTING while the order is being inserted cannot be
 *     passed by it (the row lock), which the early re-check alone cannot catch.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, idempotencyKeys, orders, organizations } from "@/db/schema";
import { createTestOrg, createTestProduct, createTestTaxRate, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { ORG_SLUG } from "./org";

let productSlug = "";
const hooks: { beforePricing: (() => Promise<void>) | null; afterEarlyCheck: (() => Promise<void>) | null; calls: number; customerCalls: number } = {
  beforePricing: null,
  afterEarlyCheck: null,
  calls: 0,
  customerCalls: 0,
};

vi.mock("@/lib/env", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/env")>()), isSupabaseConfigured: () => true }));
// `getCustomer` is the first thing writeOrder does after its early re-check and before the order row is inserted.
// The cart pricing (`priceCart`) calls it first, before any gate, so the hook fires on the SECOND call.
vi.mock("@/lib/customer", () => ({
  getCustomer: async () => {
    hooks.customerCalls += 1;
    if (hooks.customerCalls === 2) await hooks.afterEarlyCheck?.();
    return null;
  },
}));
vi.mock("@/lib/cart", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cart")>();
  return { ...actual, getPricedCart: () => actual.priceCart({ lines: [{ slug: productSlug, quantity: 1, modifiers: [], redeemStamp: false }] } as never) };
});
// Runs after the top-of-request gate and before any write: the gap the re-check exists for.
// `priceCart` (the cart pricing that runs FIRST, before the gate) calls it too, so the hook fires on the second call:
// placeOrder's own pricing, which comes after the top gate. (A hook on the first call would land before the gate
// and test nothing.)
vi.mock("./org", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./org")>();
  return {
    ...actual,
    resolvePricingContext: async () => {
      hooks.calls += 1;
      if (hooks.calls === 2) await hooks.beforePricing?.();
      return actual.resolvePricingContext();
    },
  };
});

import { placeCounterOrder, placeOrder } from "./orders";
import { fromRupees } from "@/lib/money";

const NOON = new Date("2026-06-10T06:30:00.000Z"); // 12:00 IST, hours 11:30-23:00
const JUST_BEFORE_CLOSE = new Date("2026-06-10T17:29:00.000Z"); // 22:59 IST
const JUST_AFTER_CLOSE = new Date("2026-06-10T17:30:02.000Z"); // 23:00:02 IST
const SLOT_1230 = new Date("2026-06-10T07:00:00.000Z");
const NOON_PLUS_20 = new Date("2026-06-10T06:50:00.000Z");

const base = { name: "Test Customer", email: "test@example.com", phone: "9876543210", fulfilment: "TAKEAWAY" as const, payment: "COD" as const };

let org: TestOrg;

beforeAll(async () => {
  org = await createTestOrg({ slug: ORG_SLUG });
  await db().update(organizations).set({ openingTime: "11:30", closingTime: "23:00", cashEnabled: true }).where(eq(organizations.id, org.orgId));
  const taxRate = await createTestTaxRate(org.orgId);
  productSlug = (await createTestProduct(org.orgId, { taxRateId: taxRate.id, basePriceRupees: "99" })).slug;
});
afterAll(async () => {
  await deleteTestOrg(org.orgId);
});
beforeEach(async () => {
  hooks.calls = 0;
  hooks.customerCalls = 0;
  await clearPause();
});
afterEach(() => {
  vi.useRealTimers();
  hooks.beforePricing = null;
  hooks.afterEarlyCheck = null;
});

const at = (date: Date) => vi.useFakeTimers({ toFake: ["Date"], now: date });
const orderCount = async () => (await db().select({ id: orders.id }).from(orders).where(eq(orders.orgId, org.orgId))).length;
const customerRows = async (phone: string) => (await db().select({ id: customers.id }).from(customers).where(eq(customers.phone, phone))).length;
const keyRows = async (key: string) => (await db().select({ id: idempotencyKeys.id }).from(idempotencyKeys).where(eq(idempotencyKeys.key, key))).length;

async function pauseNow(): Promise<void> {
  await db()
    .update(organizations)
    .set({ orderingPausedAt: new Date(), orderingPausedBy: randomUUID(), orderingPausedReason: "Too busy", orderingPausedUntil: null })
    .where(eq(organizations.id, org.orgId));
}
async function clearPause(): Promise<void> {
  await db()
    .update(organizations)
    .set({ orderingPausedAt: null, orderingPausedBy: null, orderingPausedReason: null, orderingPausedUntil: null })
    .where(eq(organizations.id, org.orgId));
}

describe("a pause that lands after the top gate", () => {
  it("ASAP: refused as paused, nothing written, and the idempotency claim is released", async () => {
    at(NOON);
    const key = randomUUID();
    const before = await orderCount();
    hooks.beforePricing = pauseNow;

    const result = await placeOrder({ ...base, phone: "9000000001", idempotencyKey: key });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    // Refused BEFORE any write: no customer record is created or touched for a refused order (the early re-check).
    expect(await customerRows("9000000001")).toBe(0);
    expect(result.error).toContain("We're not taking orders right now");
    expect(result.error).toContain("Nothing has been ordered or charged");
    expect("paused" in result && result.paused).toEqual({ code: "PAUSED" });
    expect("closed" in result && result.closed).toBeFalsy(); // never sends the customer to "choose a time"
    expect(await orderCount()).toBe(before);
    expect(await keyRows(key)).toBe(0);
  });

  it("the SAME key retried after the shop reopens is a fresh attempt and is accepted (a refusal is never replayed)", async () => {
    at(NOON);
    const key = randomUUID();
    hooks.beforePricing = pauseNow;
    const refused = await placeOrder({ ...base, idempotencyKey: key });
    expect(refused.ok).toBe(false);

    hooks.beforePricing = null;
    await clearPause();
    const before = await orderCount();
    const retry = await placeOrder({ ...base, idempotencyKey: key });
    expect(retry.ok).toBe(true);
    expect(await orderCount()).toBe(before + 1);
  });

  it("SCHEDULED: refused as paused too (a pause refuses pre-orders)", async () => {
    at(NOON);
    const before = await orderCount();
    hooks.beforePricing = pauseNow;
    const result = await placeOrder({ ...base, when: "SCHEDULED", scheduledFor: SLOT_1230.toISOString(), idempotencyKey: randomUUID() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect("paused" in result && result.paused).toEqual({ code: "PAUSED" });
    expect(await orderCount()).toBe(before);
  });
});

describe("a pause that lands after the early re-check, just before the order row is inserted", () => {
  it("only the locked check in the order's own transaction can catch it, and does", async () => {
    at(NOON);
    const before = await orderCount();
    hooks.afterEarlyCheck = pauseNow; // committed before persistOrder runs
    const result = await placeOrder({ ...base, idempotencyKey: randomUUID() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect("paused" in result && result.paused).toEqual({ code: "PAUSED" });
    expect(await orderCount()).toBe(before);
  });
});

describe("the hours, reached after the top gate", () => {
  it("ASAP: closing time passes in the gap: refused as closed (with `closed`, so the form offers Choose a time)", async () => {
    at(JUST_BEFORE_CLOSE);
    const before = await orderCount();
    hooks.beforePricing = async () => {
      at(JUST_AFTER_CLOSE);
    };
    const result = await placeOrder({ ...base, idempotencyKey: randomUUID() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("The kitchen is closed");
    expect("closed" in result && result.closed).toBeTruthy();
    expect(await orderCount()).toBe(before);
  });

  it("SCHEDULED: the slot slips inside the lead window in the gap: refused with the time message", async () => {
    at(NOON);
    const before = await orderCount();
    hooks.beforePricing = async () => {
      at(NOON_PLUS_20);
    };
    const result = await placeOrder({ ...base, when: "SCHEDULED", scheduledFor: SLOT_1230.toISOString(), idempotencyKey: randomUUID() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("That time isn't available anymore. Pick another.");
    expect(await orderCount()).toBe(before);
  });
});

describe("a pause that is committing while the order is being inserted", () => {
  it("cannot be passed: the order waits on the row lock, sees the committed pause, and is refused", async () => {
    at(NOON);
    const before = await orderCount();

    // A pause transaction that has taken the org row's lock and set the pause, but not committed.
    let releasePause!: () => void;
    const held = new Promise<void>((resolve) => (releasePause = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    const pauseTx = db().transaction(async (tx) => {
      await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, org.orgId)).for("update");
      await tx
        .update(organizations)
        .set({ orderingPausedAt: new Date(), orderingPausedBy: randomUUID(), orderingPausedReason: "Other", orderingPausedUntil: null })
        .where(eq(organizations.id, org.orgId));
      locked();
      await held; // hold it uncommitted
    });
    await lockTaken;

    // The top gate and the early re-check are plain reads: they still see "not paused" and go on to the write,
    // where the locked check has to wait for the pause to commit.
    const placing = placeOrder({ ...base, idempotencyKey: randomUUID() });
    let settled = false;
    void placing.then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(settled).toBe(false); // waiting on the lock, not already inserted

    releasePause();
    await pauseTx;
    const result = await placing;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect("paused" in result && result.paused).toEqual({ code: "PAUSED" });
    expect(await orderCount()).toBe(before);
  });
});

describe("unchanged behaviour", () => {
  it("an open shop places the order as before", async () => {
    at(NOON);
    const before = await orderCount();
    const result = await placeOrder({ ...base, idempotencyKey: randomUUID() });
    expect(result.ok).toBe(true);
    expect(await orderCount()).toBe(before + 1);
  });
});

describe("the counter stays ungated (owner ruling: the till keeps working while online ordering is off)", () => {
  it("a counter order is placed while the shop is paused and outside the hours", async () => {
    await pauseNow(); // real clock: also outside 11:30-23:00 most of the day
    const before = await orderCount();
    const result = await placeCounterOrder({
      orgId: org.orgId,
      lines: [{ slug: productSlug, quantity: 1, modifiers: [], redeemStamp: false }],
      channel: "TAKEAWAY",
      tableId: null,
      customerPhone: null,
      notes: null,
      idempotencyKey: randomUUID(),
      actorUserId: randomUUID(),
      tendered: fromRupees("500"),
    });
    expect(result.ok).toBe(true);
    expect(await orderCount()).toBe(before + 1);
  });
});
