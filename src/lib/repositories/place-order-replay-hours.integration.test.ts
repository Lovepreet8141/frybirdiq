/**
 * placeOrder ordering: a same-key retry of an order that already exists is
 * answered with that order even after the shop has closed (or a scheduled time
 * has slipped inside the lead window), while a genuinely NEW order is still
 * refused. Before the fix the hours refusals ran before the idempotency lookup,
 * so the retry saw "the kitchen is closed ... nothing has been ordered" for an
 * order that existed.
 *
 * The cart cookie and the Supabase env check are mocked (the cart is priced by
 * the real priceCart from a fixed cart); the clock is faked for Date only so DB
 * I/O timers keep working.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { idempotencyKeys, orders, organizations } from "@/db/schema";
import { createTestOrg, createTestProduct, createTestTaxRate, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { ORG_SLUG } from "./org";

let productSlug = "";

vi.mock("@/lib/env", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/env")>()), isSupabaseConfigured: () => true }));
vi.mock("@/lib/customer", () => ({ getCustomer: async () => null }));
vi.mock("@/lib/cart", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cart")>();
  return { ...actual, getPricedCart: () => actual.priceCart({ lines: [{ slug: productSlug, quantity: 1, modifiers: [], redeemStamp: false }] } as never) };
});

import { placeOrder } from "./orders";

// 22:59:00 IST and 23:00:02 IST on the same day; hours are 11:30-23:00.
const JUST_BEFORE_CLOSE = new Date("2026-06-10T17:29:00.000Z");
const JUST_AFTER_CLOSE = new Date("2026-06-10T17:30:02.000Z");
// 12:00 IST, and 12:20 IST (a 12:30 slot is then only 10 minutes away).
const NOON = new Date("2026-06-10T06:30:00.000Z");
const NOON_PLUS_20 = new Date("2026-06-10T06:50:00.000Z");
const SLOT_1230 = new Date("2026-06-10T07:00:00.000Z");

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
afterEach(() => {
  vi.useRealTimers();
});

const at = (date: Date) => vi.useFakeTimers({ toFake: ["Date"], now: date });
const orderCount = async () => (await db().select({ id: orders.id }).from(orders).where(eq(orders.orgId, org.orgId))).length;
const keyRows = async () => (await db().select({ id: idempotencyKeys.id }).from(idempotencyKeys).where(eq(idempotencyKeys.orgId, org.orgId))).length;

describe("placeOrder: replay before the hours gate", () => {
  it("ASAP: a same-key retry after closing returns the order that was placed, not the closed refusal", async () => {
    const key = randomUUID();
    const before = await orderCount();

    at(JUST_BEFORE_CLOSE);
    const first = await placeOrder({ ...base, idempotencyKey: key });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");

    at(JUST_AFTER_CLOSE);
    const retry = await placeOrder({ ...base, idempotencyKey: key });
    expect(retry).toEqual(first);
    expect(await orderCount()).toBe(before + 1);
  });

  it("ASAP: a NEW key after closing is still refused as closed and writes nothing", async () => {
    const orders0 = await orderCount();
    const keys0 = await keyRows();
    at(JUST_AFTER_CLOSE);
    const result = await placeOrder({ ...base, idempotencyKey: randomUUID() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("The kitchen is closed");
    expect("closed" in result && result.closed).toBeTruthy();
    expect(await orderCount()).toBe(orders0);
    expect(await keyRows()).toBe(keys0);
  });

  it("ASAP: the same key with a different phone after closing is not treated as a replay", async () => {
    const key = randomUUID();
    at(JUST_BEFORE_CLOSE);
    const first = await placeOrder({ ...base, idempotencyKey: key });
    expect(first.ok).toBe(true);
    at(JUST_AFTER_CLOSE);
    const other = await placeOrder({ ...base, phone: "9876543211", idempotencyKey: key });
    expect(other.ok).toBe(false);
    if (other.ok) throw new Error("unreachable");
    expect(other.error).toContain("The kitchen is closed");
  });

  it("SCHEDULED: a same-key retry once the slot is inside the lead window returns the placed order; a new key is refused", async () => {
    const key = randomUUID();
    const scheduled = { ...base, when: "SCHEDULED" as const, scheduledFor: SLOT_1230.toISOString() };
    const before = await orderCount();

    at(NOON);
    const first = await placeOrder({ ...scheduled, idempotencyKey: key });
    expect(first.ok).toBe(true);

    at(NOON_PLUS_20);
    const retry = await placeOrder({ ...scheduled, idempotencyKey: key });
    expect(retry).toEqual(first);
    expect(await orderCount()).toBe(before + 1);

    const fresh = await placeOrder({ ...scheduled, idempotencyKey: randomUUID() });
    expect(fresh.ok).toBe(false);
    if (fresh.ok) throw new Error("unreachable");
    expect(fresh.error).toBe("That time isn't available anymore. Pick another.");
    expect(await orderCount()).toBe(before + 1);
  });
});
