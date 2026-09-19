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
import { closedDates, customers, idempotencyKeys, inventoryMovements, loyaltyStampEvents, loyaltyTransactions, orders, organizations, payments, promotions } from "@/db/schema";
import { createTestOrg, createTestProduct, createTestTaxRate, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { ORG_SLUG } from "./org";

let productSlug = "";
let promoCode: string | null = null;
const intents = { count: 0 };
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
  return {
    ...actual,
    getPricedCart: () => actual.priceCart({ lines: [{ slug: productSlug, quantity: 1, modifiers: [], redeemStamp: false }], ...(promoCode ? { promoCode } : {}) } as never),
  };
});
// Online payment with a counting fake provider: an intent is something a refusal must not leave behind.
vi.mock("@/lib/payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments")>();
  return {
    ...actual,
    availableMethods: (toggles?: { cash?: boolean; online?: boolean }) => [
      ...actual.availableMethods(toggles).filter((method) => method.choice !== "ONLINE"),
      { method: "UPI", provider: actual.RAZORPAY_PROVIDER, choice: "ONLINE", label: "Pay online", detail: "" },
    ],
    getProvider: (name: string) =>
      name === actual.RAZORPAY_PROVIDER
        ? { createIntent: async () => ({ providerOrderId: `order_test_${(intents.count += 1)}` }) }
        : actual.getProvider(name),
  };
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

import { addClosedDate, removeClosedDate } from "./closed-dates";
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
  intents.count = 0;
  promoCode = null;
  await clearPause();
  await clearClosures();
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

async function createPromo(code: string, usageLimit: number, usageCount = 0): Promise<void> {
  await db().insert(promotions).values({ orgId: org.orgId, code, name: `Test ${code}`, discountBps: 1000, usageLimit, usageCount, isActive: true });
}
async function sideEffectRows(): Promise<{ payments: number; points: number; stamps: number; stock: number }> {
  const count = async (rows: Promise<unknown[]>) => (await rows).length;
  return {
    payments: await count(db().select({ id: payments.id }).from(payments).where(eq(payments.orgId, org.orgId))),
    points: await count(db().select({ id: loyaltyTransactions.id }).from(loyaltyTransactions).where(eq(loyaltyTransactions.orgId, org.orgId))),
    stamps: await count(db().select({ id: loyaltyStampEvents.id }).from(loyaltyStampEvents).where(eq(loyaltyStampEvents.orgId, org.orgId))),
    stock: await count(db().select({ id: inventoryMovements.id }).from(inventoryMovements).where(eq(inventoryMovements.orgId, org.orgId))),
  };
}
const promoUses = async (code: string) => (await db().select({ n: promotions.usageCount }).from(promotions).where(eq(promotions.code, code)))[0]?.n ?? -1;

describe("a refused order leaves nothing behind", () => {
  it("no promo slot is consumed when a pause lands just before the order row (the millisecond window)", async () => {
    at(NOON);
    const code = `KEEP-${randomUUID().slice(0, 6).toUpperCase()}`;
    await createPromo(code, 5);
    promoCode = code;
    const before = await orderCount();
    const sideBefore = await sideEffectRows();
    hooks.afterEarlyCheck = pauseNow; // after the early check, before persistOrder: only the locked check can refuse

    const result = await placeOrder({ ...base, phone: "9000000002", idempotencyKey: randomUUID() });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect("paused" in result && result.paused).toEqual({ code: "PAUSED" });
    expect(await promoUses(code)).toBe(0); // the claim rolled back with the refusal
    expect(await orderCount()).toBe(before);
    // no payment row, no points, no stamps, no stock movement either
    expect(await sideEffectRows()).toEqual(sideBefore);
  });

  it("after the shop reopens, the same code is still claimable and the order is placed with exactly one use", async () => {
    at(NOON);
    const code = `AGAIN-${randomUUID().slice(0, 6).toUpperCase()}`;
    await createPromo(code, 5);
    promoCode = code;
    const key = randomUUID();
    hooks.afterEarlyCheck = pauseNow;
    expect((await placeOrder({ ...base, phone: "9000000003", idempotencyKey: key })).ok).toBe(false);

    hooks.afterEarlyCheck = null;
    await clearPause();
    const retry = await placeOrder({ ...base, phone: "9000000003", idempotencyKey: key });
    expect(retry.ok).toBe(true);
    expect(await promoUses(code)).toBe(1);
  });

  it("the last slot taken by someone else at the last moment: refused with the offer message, no order, claim released", async () => {
    at(NOON);
    const code = `LAST-${randomUUID().slice(0, 6).toUpperCase()}`;
    await createPromo(code, 1);
    promoCode = code;
    const key = randomUUID();
    const before = await orderCount();
    hooks.afterEarlyCheck = async () => {
      await db().update(promotions).set({ usageCount: 1 }).where(eq(promotions.code, code)); // another order took it
    };
    const result = await placeOrder({ ...base, phone: "9000000004", idempotencyKey: key });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("That offer just reached its usage limit. Remove the code and try again.");
    expect(await promoUses(code)).toBe(1); // not double-counted
    expect(await orderCount()).toBe(before);
    expect(await keyRows(key)).toBe(0);
  });

  it("no payment intent is created when the pause lands before the intent (online payment)", async () => {
    at(NOON);
    const before = await orderCount();
    hooks.beforePricing = pauseNow; // after the top gate, before the intent is created
    const result = await placeOrder({ ...base, payment: "ONLINE" as never, phone: "9000000005", idempotencyKey: randomUUID() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect("paused" in result && result.paused).toEqual({ code: "PAUSED" });
    expect(intents.count).toBe(0);
    expect(await orderCount()).toBe(before);
  });

  it("KNOWN RESIDUE: a pause landing after the intent was created still refuses the order (no order row) but leaves that one unpaid intent", async () => {
    at(NOON);
    const before = await orderCount();
    hooks.afterEarlyCheck = pauseNow; // after the intent, after the early check: cannot be un-made
    const result = await placeOrder({ ...base, payment: "ONLINE" as never, phone: "9000000006", idempotencyKey: randomUUID() });
    expect(result.ok).toBe(false);
    expect(await orderCount()).toBe(before);
    expect(intents.count).toBe(1); // an unpaid Razorpay order nobody holds: cannot be charged; documented, accepted
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


/* ------------------------------------------------------------------ ops-3 */

// 2026-06-10 is a Wednesday; 2026-06-09 a Tuesday.
const TUESDAY_NOON = new Date("2026-06-09T06:30:00.000Z"); // 12:00 IST
const WEDNESDAY_SLOT = new Date("2026-06-10T07:30:00.000Z"); // 13:00 IST Wednesday
const actor = randomUUID();

async function clearClosures(): Promise<void> {
  await db().delete(closedDates).where(eq(closedDates.orgId, org.orgId));
  await db().update(organizations).set({ weeklyClosedDays: [] }).where(eq(organizations.id, org.orgId));
}
async function closeWednesdayByDate(note: string | null = "Closed for Diwali"): Promise<void> {
  const result = await addClosedDate({ orgId: org.orgId, actorUserId: actor, startDate: "2026-06-10", endDate: "2026-06-10", note });
  if (!result.ok) throw new Error(result.error);
}

describe("a closed day (ops-3): the server refuses whatever the page showed", () => {
  it("ASAP on the weekly day off: refused, the day-off message, and NOTHING left behind", async () => {
    at(NOON); // Wednesday 12:00, inside the hours
    await db().update(organizations).set({ weeklyClosedDays: [3] }).where(eq(organizations.id, org.orgId));
    const code = `OFF-${randomUUID().slice(0, 6).toUpperCase()}`;
    await createPromo(code, 5);
    promoCode = code;
    const key = randomUUID();
    const before = await orderCount();
    const sideBefore = await sideEffectRows();

    const result = await placeOrder({ ...base, phone: "9000000010", idempotencyKey: key });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("We're closed today. We open again tomorrow at 11:30 AM — nothing has been ordered or charged.");
    expect("closed" in result && result.closed).toMatchObject({ code: "CLOSED", dayOff: { source: "WEEKLY" } });
    expect(await orderCount()).toBe(before);
    expect(await customerRows("9000000010")).toBe(0);
    expect(await keyRows(key)).toBe(0);
    expect(intents.count).toBe(0);
    expect(await promoUses(code)).toBe(0);
    expect(await sideEffectRows()).toEqual(sideBefore);
  });

  it("ASAP on a planned closed date: the owner's public note is in the customer's message", async () => {
    at(NOON);
    await closeWednesdayByDate("Closed for Diwali");
    const result = await placeOrder({ ...base, phone: "9000000011", idempotencyKey: randomUUID() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("We're closed today. We open again tomorrow at 11:30 AM — nothing has been ordered or charged. Closed for Diwali");
    // Refused at the gate, before any write: not even a customer record is created for it.
    expect(await customerRows("9000000011")).toBe(0);
  });

  it("a closure that lands after the top gate is caught by the early re-check, before a customer record or a payment intent exists", async () => {
    at(NOON);
    const before = await orderCount();
    hooks.beforePricing = () => closeWednesdayByDate(); // after the top gate, before pricing
    const result = await placeOrder({ ...base, phone: "9000000018", payment: "ONLINE" as never, idempotencyKey: randomUUID() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect("closed" in result && result.closed).toMatchObject({ dayOff: { source: "DATE" } });
    expect(await customerRows("9000000018")).toBe(0);
    expect(intents.count).toBe(0);
    expect(await orderCount()).toBe(before);
  });

  it("a pre-order for a closed day is refused, from the day before, when the shop is open", async () => {
    at(TUESDAY_NOON);
    await closeWednesdayByDate();
    const before = await orderCount();
    const result = await placeOrder({ ...base, phone: "9000000012", when: "SCHEDULED", scheduledFor: WEDNESDAY_SLOT.toISOString(), idempotencyKey: randomUUID() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("That time isn't available anymore. Pick another.");
    expect(await orderCount()).toBe(before);
  });

  it("the same pre-order is accepted when the day is open", async () => {
    at(TUESDAY_NOON);
    const before = await orderCount();
    const result = await placeOrder({ ...base, phone: "9000000013", when: "SCHEDULED", scheduledFor: WEDNESDAY_SLOT.toISOString(), idempotencyKey: randomUUID() });
    expect(result.ok).toBe(true);
    expect(await orderCount()).toBe(before + 1);
  });

  it("a closure that lands after the top gate is caught in the order's own locked transaction: no order, no promo use, no intent", async () => {
    at(NOON);
    const code = `LATE-${randomUUID().slice(0, 6).toUpperCase()}`;
    await createPromo(code, 5);
    promoCode = code;
    const key = randomUUID();
    const before = await orderCount();
    const sideBefore = await sideEffectRows();
    hooks.afterEarlyCheck = () => closeWednesdayByDate(); // committed after the early re-check, before persistOrder

    const result = await placeOrder({ ...base, phone: "9000000014", idempotencyKey: key });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect("closed" in result && result.closed).toMatchObject({ dayOff: { source: "DATE", note: "Closed for Diwali" } });
    expect(await orderCount()).toBe(before);
    expect(await promoUses(code)).toBe(0);
    expect(await sideEffectRows()).toEqual(sideBefore);
    expect(await keyRows(key)).toBe(0); // released, so the refusal is never replayed
  });

  it("the same key, retried after the closure is removed, is a fresh attempt and is accepted", async () => {
    at(NOON);
    const key = randomUUID();
    await closeWednesdayByDate();
    expect((await placeOrder({ ...base, phone: "9000000015", idempotencyKey: key })).ok).toBe(false);

    const [row] = await db().select({ id: closedDates.id }).from(closedDates).where(eq(closedDates.orgId, org.orgId));
    expect((await removeClosedDate({ orgId: org.orgId, actorUserId: actor, id: row!.id })).ok).toBe(true);
    const before = await orderCount();
    expect((await placeOrder({ ...base, phone: "9000000015", idempotencyKey: key })).ok).toBe(true);
    expect(await orderCount()).toBe(before + 1);
  });

  it("a closure COMMITTING while the order row is being inserted cannot be passed (the row lock)", async () => {
    at(NOON);
    const before = await orderCount();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    // What addClosedDate does, held open: the org row locked FOR UPDATE, the closed date inserted, not yet committed.
    const closing = db().transaction(async (tx) => {
      await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, org.orgId)).for("update");
      await tx.insert(closedDates).values({ orgId: org.orgId, startDate: "2026-06-10", endDate: "2026-06-10", publicNote: null });
      locked();
      await held;
    });
    await lockTaken;

    const placing = placeOrder({ ...base, phone: "9000000016", idempotencyKey: randomUUID() });
    let settled = false;
    void placing.then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(settled).toBe(false); // waiting on the lock, not already inserted

    release();
    await closing;
    const result = await placing;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect("closed" in result && result.closed).toMatchObject({ code: "CLOSED", dayOff: { source: "DATE" } });
    expect(await orderCount()).toBe(before);
  });

  it("a pre-order booked before the closure is LISTED when the closure is added, and is not cancelled or changed", async () => {
    at(TUESDAY_NOON);
    const placed = await placeOrder({ ...base, phone: "9000000017", when: "SCHEDULED", scheduledFor: WEDNESDAY_SLOT.toISOString(), idempotencyKey: randomUUID() });
    expect(placed.ok).toBe(true);
    const [order] = await db().select().from(orders).where(eq(orders.customerPhone, "9000000017"));
    expect(order).toBeDefined();

    const result = await addClosedDate({ orgId: org.orgId, actorUserId: actor, startDate: "2026-06-10", endDate: "2026-06-10", note: null });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    // Every pre-order booked for that day is listed — this one, and the one an earlier test placed for the same Wednesday.
    expect(result.preOrders.map((row) => row.orderId)).toContain(order!.id);
    expect(result.preOrders.every((row) => row.date === "2026-06-10")).toBe(true);
    expect(result.preOrders.find((row) => row.orderId === order!.id)).toMatchObject({ orderNumber: order!.orderNumber, status: order!.status });
    const [after] = await db().select().from(orders).where(eq(orders.id, order!.id));
    expect(after!.status).toBe(order!.status); // nothing cancelled
    expect(after!.scheduledFor?.toISOString()).toBe(order!.scheduledFor?.toISOString()); // nothing moved
  });
});
