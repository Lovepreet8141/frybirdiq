/**
 * The Close Shop switch against a real database (ops-1 S3).
 *
 * placeOrder is driven end to end with the same harness as
 * place-order-replay-hours: the cart cookie and the Supabase env check are
 * mocked (the cart is priced by the real priceCart), and only Date is faked,
 * so the clock can be set to the millisecond around a pause's end while DB
 * I/O timers keep working. Hours are 11:30-23:00 IST; instants are UTC
 * literals with the IST time in a comment.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, idempotencyKeys, memberships, orders, organizations } from "@/db/schema";
import { createTestOrg, createTestProduct, createTestStaffMembership, createTestTaxRate, deleteTestOrg, warmPool, type TestOrg } from "./__test-support__/fixtures";
import { ORG_SLUG } from "./org";

let productSlug = "";

vi.mock("@/lib/env", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/env")>()), isSupabaseConfigured: () => true }));
vi.mock("@/lib/customer", () => ({ getCustomer: async () => null }));
vi.mock("@/lib/cart", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cart")>();
  return { ...actual, getPricedCart: () => actual.priceCart({ lines: [{ slug: productSlug, quantity: 1, modifiers: [], redeemStamp: false }] } as never) };
});

import { placeOrder } from "./orders";
import { getOrderingStatus, getOrderingStatusForStaff, pauseOrdering, previewPause, resumeOrdering } from "./shop-status";

// 2026-06-10 18:00 IST — well inside the hours.
const EVENING = new Date("2026-06-10T12:30:00.000Z");
// 2026-06-10 19:00 IST — the moment a timed pause is taken.
const PAUSED_AT = new Date("2026-06-10T13:30:00.000Z");
// 2026-06-10 19:30 IST — while that pause is in force.
const EVENING_AFTER_PAUSE = new Date("2026-06-10T14:00:00.000Z");
// 2026-06-11 11:30 IST — the next opening, where "until we next open" ends.
const NEXT_OPENING = new Date("2026-06-11T06:00:00.000Z");
// 2026-06-11 18:00 IST — well past the next opening.
const NEXT_EVENING = new Date("2026-06-11T12:30:00.000Z");
// A 20:30 IST slot the same evening, for pre-orders.
const SLOT_2030 = new Date("2026-06-10T15:00:00.000Z");

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
afterEach(async () => {
  vi.useRealTimers();
  await setPause(null, null);
});

const at = (date: Date) => vi.useFakeTimers({ toFake: ["Date"], now: date });
const orderCount = async () => (await db().select({ id: orders.id }).from(orders).where(eq(orders.orgId, org.orgId))).length;
const keyRows = async () => (await db().select({ id: idempotencyKeys.id }).from(idempotencyKeys).where(eq(idempotencyKeys.orgId, org.orgId))).length;

/** Sets the pause straight on the row, so these gate tests depend on nothing but the columns and placeOrder. */
async function setPause(pausedAt: Date | null, pausedUntil: Date | null) {
  await db()
    .update(organizations)
    .set({
      orderingPausedAt: pausedAt,
      orderingPausedBy: pausedAt ? randomUUID() : null,
      orderingPausedReason: pausedAt ? "fryer down" : null,
      orderingPausedUntil: pausedUntil,
    })
    .where(eq(organizations.id, org.orgId));
}

/** A refusal that is the switch: `paused` set, and never `closed` — the form would send the customer to Choose a time. */
function expectPausedRefusal(result: Awaited<ReturnType<typeof placeOrder>>) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  expect(result).toMatchObject({ paused: { code: "PAUSED" } });
  expect("closed" in result && result.closed !== undefined).toBe(false);
  expect(result.error).not.toMatch(/choose a time/i);
  expect(result.error).not.toContain("fryer down"); // staff's reason never reaches a customer
  // The whole result, not just the sentence: toMatchObject above allows extra keys (SECURITY-TENANCY).
  expect(JSON.stringify(result)).not.toContain("fryer down");
}

describe("placeOrder with the switch OFF (owner req 3: refused regardless of a stale page)", () => {
  it("refuses an ASAP order in the middle of trading hours, and writes nothing", async () => {
    await setPause(PAUSED_AT, null);
    const orders0 = await orderCount();
    const keys0 = await keyRows();
    at(EVENING);
    expectPausedRefusal(await placeOrder({ ...base, idempotencyKey: randomUUID() }));
    expect(await orderCount()).toBe(orders0);
    expect(await keyRows()).toBe(keys0);
  });

  it("refuses a pre-order for a slot inside the hours, too", async () => {
    await setPause(PAUSED_AT, null);
    const orders0 = await orderCount();
    at(EVENING);
    expectPausedRefusal(await placeOrder({ ...base, when: "SCHEDULED", scheduledFor: SLOT_2030.toISOString(), idempotencyKey: randomUUID() }));
    expect(await orderCount()).toBe(orders0);
  });
});

describe("placeOrder with the switch ON", () => {
  it("a never-paused org, read the way placeOrder reads it, takes orders (RELIABILITY req 4)", async () => {
    at(EVENING);
    const result = await placeOrder({ ...base, idempotencyKey: randomUUID() });
    expect(result.ok).toBe(true);
  });
});

describe("placeOrder: 'until we next open' reopens by itself, by time", () => {
  it("refuses one millisecond before the next opening, and takes orders at that instant", async () => {
    await setPause(PAUSED_AT, NEXT_OPENING);

    at(new Date(NEXT_OPENING.getTime() - 1)); // 11:29:59.999 IST
    expectPausedRefusal(await placeOrder({ ...base, idempotencyKey: randomUUID() }));

    at(NEXT_OPENING); // 11:30:00.000 IST — open by the hours and no longer paused
    expect((await placeOrder({ ...base, idempotencyKey: randomUUID() })).ok).toBe(true);
  });
});

describe("placeOrder: 'until I switch it back on' stays shut", () => {
  it("still refuses the next evening, well past the next opening", async () => {
    await setPause(PAUSED_AT, null);
    at(NEXT_EVENING);
    expectPausedRefusal(await placeOrder({ ...base, idempotencyKey: randomUUID() }));
  });
});

describe("placeOrder: a pause never swallows an order that already exists (RELIABILITY req 6)", () => {
  it("a same-key retry of an order placed before the pause returns that order", async () => {
    const key = randomUUID();
    at(EVENING);
    const first = await placeOrder({ ...base, idempotencyKey: key });
    expect(first.ok).toBe(true);
    const orders1 = await orderCount();

    await setPause(PAUSED_AT, null);
    at(new Date(PAUSED_AT.getTime() + 60_000));
    const retry = await placeOrder({ ...base, idempotencyKey: key });
    expect(retry).toEqual(first);
    expect(await orderCount()).toBe(orders1);
  });
});

/* ------------------------------------------------------------ repository */

const pauseAudit = async (orgId: string) =>
  db()
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.orgId, orgId), inArray(auditLogs.action, ["ordering_paused", "ordering_resumed"])));

const pauseRow = async (orgId: string) =>
  (
    await db()
      .select({
        at: organizations.orderingPausedAt,
        by: organizations.orderingPausedBy,
        reason: organizations.orderingPausedReason,
        until: organizations.orderingPausedUntil,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
  )[0];

describe("pauseOrdering / resumeOrdering", () => {
  const cashier = randomUUID();

  beforeAll(async () => {
    await createTestStaffMembership(org.orgId, cashier, "CASHIER");
    await db().update(memberships).set({ displayName: "Aman" }).where(and(eq(memberships.orgId, org.orgId), eq(memberships.userId, cashier)));
  });
  afterEach(async () => {
    await db().delete(auditLogs).where(and(eq(auditLogs.orgId, org.orgId), inArray(auditLogs.action, ["ordering_paused", "ordering_resumed"])));
  });

  it("'until we next open' stores the next opening, audits who/when/mode/reopensAt, and staff see who paused", async () => {
    const result = await pauseOrdering({ orgId: org.orgId, actorUserId: cashier, reason: "power cut", mode: "UNTIL_NEXT_OPENING", now: PAUSED_AT });
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(await pauseRow(org.orgId)).toEqual({ at: PAUSED_AT, by: cashier, reason: "power cut", until: NEXT_OPENING });

    const audit = await pauseAudit(org.orgId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "ordering_paused",
      actorUserId: cashier,
      after: { mode: "UNTIL_NEXT_OPENING", pausedAt: PAUSED_AT.toISOString(), reopensAt: NEXT_OPENING.toISOString(), reason: "power cut" },
    });

    const staff = await getOrderingStatusForStaff(org.orgId, EVENING_AFTER_PAUSE);
    expect(staff).toMatchObject({
      state: "paused",
      mode: "UNTIL_NEXT_OPENING",
      reopensAtLabel: "tomorrow at 11:30 AM",
      pausedBy: { userId: cashier, name: "Aman" },
      reason: "power cut",
    });
  });

  it("the customer read carries the state and reopening time — never who paused or why", async () => {
    await pauseOrdering({ orgId: org.orgId, actorUserId: cashier, reason: "power cut", mode: "UNTIL_NEXT_OPENING", now: PAUSED_AT });
    const customer = await getOrderingStatus(org.orgId, EVENING_AFTER_PAUSE);
    expect(customer).toEqual({
      state: "paused",
      mode: "UNTIL_NEXT_OPENING",
      pausedAt: PAUSED_AT,
      reopensAt: NEXT_OPENING,
      reopensAtLabel: "tomorrow at 11:30 AM",
      withinHours: true,
    });
    expect(JSON.stringify(customer)).not.toContain("power cut");
    expect(JSON.stringify(customer)).not.toContain(cashier);
  });

  it("'until I switch it back on' stores no end", async () => {
    await pauseOrdering({ orgId: org.orgId, actorUserId: cashier, reason: "fryer down", mode: "UNTIL_RESUMED", now: PAUSED_AT });
    expect((await pauseRow(org.orgId))?.until).toBeNull();
    expect(await getOrderingStatus(org.orgId, NEXT_EVENING)).toMatchObject({ state: "paused", mode: "UNTIL_RESUMED", reopensAt: null, reopensAtLabel: null });
  });

  it("two tills pressing Pause together: one pause, one audit row, paused_at untouched (DATABASE A3 / RELIABILITY req 2)", async () => {
    await warmPool();
    const [a, b] = await Promise.all([
      pauseOrdering({ orgId: org.orgId, actorUserId: cashier, reason: "till one", mode: "UNTIL_RESUMED", now: PAUSED_AT }),
      pauseOrdering({ orgId: org.orgId, actorUserId: cashier, reason: "till two", mode: "UNTIL_RESUMED", now: new Date(PAUSED_AT.getTime() + 5) }),
    ]);
    expect([a, b].filter((r) => r.ok && r.changed)).toHaveLength(1);
    expect([a, b].every((r) => r.ok)).toBe(true);
    expect(await pauseAudit(org.orgId)).toHaveLength(1);
    const row = await pauseRow(org.orgId);
    const winner = a.ok && a.changed ? { at: PAUSED_AT, reason: "till one" } : { at: new Date(PAUSED_AT.getTime() + 5), reason: "till two" };
    expect(row).toMatchObject(winner);
  });

  it("pausing an already-paused shop changes nothing and returns the pause in force", async () => {
    await pauseOrdering({ orgId: org.orgId, actorUserId: cashier, reason: "first", mode: "UNTIL_RESUMED", now: PAUSED_AT });
    const again = await pauseOrdering({ orgId: org.orgId, actorUserId: randomUUID(), reason: "second", mode: "UNTIL_NEXT_OPENING", now: EVENING_AFTER_PAUSE });
    expect(again).toMatchObject({ ok: true, changed: false, status: { state: "paused", reason: "first", mode: "UNTIL_RESUMED" } });
    expect(await pauseAudit(org.orgId)).toHaveLength(1);
  });

  it("a stricter pause replaces a weaker one: a fire after 'out of chicken' stays closed past the next opening (RELIABILITY, blocking)", async () => {
    // Till A: out of chicken, until we next open (the action's default).
    await pauseOrdering({ orgId: org.orgId, actorUserId: cashier, reason: "out of chicken", mode: "UNTIL_NEXT_OPENING", now: PAUSED_AT });
    // Till B, half an hour later: kitchen fire, until someone switches it back on.
    const fire = await pauseOrdering({ orgId: org.orgId, actorUserId: cashier, reason: "kitchen fire", mode: "UNTIL_RESUMED", now: EVENING_AFTER_PAUSE });

    expect(fire).toMatchObject({ ok: true, changed: true, status: { state: "paused", mode: "UNTIL_RESUMED", reason: "kitchen fire" } });
    expect(await pauseRow(org.orgId)).toMatchObject({ at: EVENING_AFTER_PAUSE, reason: "kitchen fire", until: null });

    // Both pauses are on record, and the second says what it replaced.
    const audit = (await pauseAudit(org.orgId)).filter((row) => row.action === "ordering_paused");
    expect(audit).toHaveLength(2);
    expect(audit.find((row) => (row.after as { reason?: string }).reason === "kitchen fire")).toMatchObject({
      before: { mode: "UNTIL_NEXT_OPENING", reason: "out of chicken", pausedAt: PAUSED_AT.toISOString(), reopensAt: NEXT_OPENING.toISOString() },
      after: { mode: "UNTIL_RESUMED", reason: "kitchen fire" },
    });

    // The whole point: it does NOT reopen by itself at 11:30.
    expect(await getOrderingStatus(org.orgId, NEXT_OPENING)).toMatchObject({ state: "paused", mode: "UNTIL_RESUMED" });
  });

  it("Resume pressed on the 'out of chicken' screen cannot lift the fire pause that replaced it", async () => {
    await pauseOrdering({ orgId: org.orgId, actorUserId: cashier, reason: "out of chicken", mode: "UNTIL_NEXT_OPENING", now: PAUSED_AT });
    await pauseOrdering({ orgId: org.orgId, actorUserId: cashier, reason: "kitchen fire", mode: "UNTIL_RESUMED", now: EVENING_AFTER_PAUSE });

    const stale = await resumeOrdering({ orgId: org.orgId, actorUserId: cashier, shownPausedAt: PAUSED_AT, now: new Date(EVENING_AFTER_PAUSE.getTime() + 60_000) });
    expect(stale).toMatchObject({ ok: false, code: "PAUSE_CHANGED", status: { state: "paused", reason: "kitchen fire" } });
    expect((await pauseRow(org.orgId))?.reason).toBe("kitchen fire");
  });

  it("a weaker or equal pause never replaces the one in force", async () => {
    // Indefinite first, then timed: still indefinite.
    await pauseOrdering({ orgId: org.orgId, actorUserId: cashier, reason: "fire", mode: "UNTIL_RESUMED", now: PAUSED_AT });
    expect(await pauseOrdering({ orgId: org.orgId, actorUserId: cashier, reason: "later", mode: "UNTIL_NEXT_OPENING", now: EVENING_AFTER_PAUSE })).toMatchObject({
      changed: false,
      status: { mode: "UNTIL_RESUMED", reason: "fire" },
    });
    await setPause(null, null);
    await db().delete(auditLogs).where(and(eq(auditLogs.orgId, org.orgId), inArray(auditLogs.action, ["ordering_paused", "ordering_resumed"])));

    // Timed then timed, same next opening: the first stands.
    await pauseOrdering({ orgId: org.orgId, actorUserId: cashier, reason: "first", mode: "UNTIL_NEXT_OPENING", now: PAUSED_AT });
    expect(await pauseOrdering({ orgId: org.orgId, actorUserId: cashier, reason: "second", mode: "UNTIL_NEXT_OPENING", now: EVENING_AFTER_PAUSE })).toMatchObject({
      changed: false,
      status: { reason: "first" },
    });
    expect(await pauseAudit(org.orgId)).toHaveLength(1);
  });

  it("a timed pause that has ended does not block the next pause, though paused_at is still in the row", async () => {
    await pauseOrdering({ orgId: org.orgId, actorUserId: cashier, reason: "yesterday", mode: "UNTIL_NEXT_OPENING", now: PAUSED_AT });
    // The next evening: yesterday's pause ended at 11:30 by itself, no job ran.
    expect(await getOrderingStatus(org.orgId, NEXT_EVENING)).toMatchObject({ state: "open" });
    const today = await pauseOrdering({ orgId: org.orgId, actorUserId: cashier, reason: "today", mode: "UNTIL_RESUMED", now: NEXT_EVENING });
    expect(today).toMatchObject({ ok: true, changed: true, status: { state: "paused", reason: "today" } });
  });

  it("resume with the pausedAt the screen showed, read back through Drizzle, clears all four columns and audits it", async () => {
    await pauseOrdering({ orgId: org.orgId, actorUserId: cashier, reason: "power cut", mode: "UNTIL_NEXT_OPENING", now: PAUSED_AT });
    const shown = (await getOrderingStatusForStaff(org.orgId, EVENING_AFTER_PAUSE))!;
    if (shown.state !== "paused") throw new Error("expected paused");

    const resumed = await resumeOrdering({ orgId: org.orgId, actorUserId: cashier, shownPausedAt: shown.pausedAt, now: EVENING_AFTER_PAUSE });
    expect(resumed).toMatchObject({ ok: true, changed: true, status: { state: "open" } });
    expect(await pauseRow(org.orgId)).toEqual({ at: null, by: null, reason: null, until: null });

    const resumeRow = (await pauseAudit(org.orgId)).find((row) => row.action === "ordering_resumed");
    expect(resumeRow).toMatchObject({
      actorUserId: cashier,
      before: { pausedAt: PAUSED_AT.toISOString(), pausedBy: cashier, mode: "UNTIL_NEXT_OPENING", reopensAt: NEXT_OPENING.toISOString(), reason: "power cut" },
    });
  });

  it("resume still matches a pause written with microseconds, e.g. a manual SQL repair using now()", async () => {
    await db()
      .update(organizations)
      .set({ orderingPausedAt: sql`'2026-06-10 13:30:00.123456+00'::timestamptz`, orderingPausedBy: cashier, orderingPausedReason: "repair" })
      .where(eq(organizations.id, org.orgId));
    const shown = (await getOrderingStatusForStaff(org.orgId, EVENING_AFTER_PAUSE))!;
    if (shown.state !== "paused") throw new Error("expected paused");
    expect(shown.pausedAt.toISOString()).toBe("2026-06-10T13:30:00.123Z"); // what a screen can hold
    const resumed = await resumeOrdering({ orgId: org.orgId, actorUserId: cashier, shownPausedAt: shown.pausedAt, now: EVENING_AFTER_PAUSE });
    expect(resumed).toMatchObject({ ok: true, changed: true });
  });

  it("a Resume pressed on a stale screen does not lift a newer pause (RELIABILITY req 3)", async () => {
    await pauseOrdering({ orgId: org.orgId, actorUserId: cashier, reason: "power cut", mode: "UNTIL_RESUMED", now: PAUSED_AT });
    // The power came back; someone resumed, then a fire: a new pause.
    await resumeOrdering({ orgId: org.orgId, actorUserId: cashier, shownPausedAt: PAUSED_AT, now: EVENING_AFTER_PAUSE });
    const firePausedAt = new Date(EVENING_AFTER_PAUSE.getTime() + 60_000);
    await pauseOrdering({ orgId: org.orgId, actorUserId: cashier, reason: "fire", mode: "UNTIL_RESUMED", now: firePausedAt });

    // A second till still showing the power-cut pause presses Resume.
    const stale = await resumeOrdering({ orgId: org.orgId, actorUserId: cashier, shownPausedAt: PAUSED_AT, now: new Date(firePausedAt.getTime() + 1_000) });
    expect(stale).toMatchObject({ ok: false, code: "PAUSE_CHANGED", status: { state: "paused", reason: "fire" } });
    expect((await pauseRow(org.orgId))?.reason).toBe("fire");
  });

  it("resuming a shop that is already open reports it, writes no audit row", async () => {
    const result = await resumeOrdering({ orgId: org.orgId, actorUserId: cashier, shownPausedAt: PAUSED_AT, now: EVENING });
    expect(result).toMatchObject({ ok: true, changed: false, status: { state: "open" } });
    expect(await pauseAudit(org.orgId)).toHaveLength(0);
  });

  it("pausing one org does not touch another, and each read stays in its own org", async () => {
    const other = await createTestOrg();
    try {
      await pauseOrdering({ orgId: org.orgId, actorUserId: cashier, reason: "power cut", mode: "UNTIL_RESUMED", now: PAUSED_AT });
      expect(await pauseRow(other.orgId)).toEqual({ at: null, by: null, reason: null, until: null });
      expect(await getOrderingStatus(other.orgId, EVENING_AFTER_PAUSE)).toMatchObject({ state: "open" });
      // A resume aimed at the other org with this org's pause clears nothing here.
      await resumeOrdering({ orgId: other.orgId, actorUserId: cashier, shownPausedAt: PAUSED_AT, now: EVENING_AFTER_PAUSE });
      expect((await pauseRow(org.orgId))?.reason).toBe("power cut");
    } finally {
      await deleteTestOrg(other.orgId);
    }
  });

  it("orders still due counts orders waiting for payment, not finished ones (D4 (c))", async () => {
    at(EVENING);
    const placed = await placeOrder({ ...base, idempotencyKey: randomUUID() }); // COD online: PENDING_PAYMENT
    vi.useRealTimers();
    expect(placed.ok).toBe(true);
    const staff = await getOrderingStatusForStaff(org.orgId, EVENING);
    const pending = await db().select({ id: orders.id }).from(orders).where(and(eq(orders.orgId, org.orgId), eq(orders.status, "PENDING_PAYMENT")));
    expect(pending.length).toBeGreaterThan(0);
    expect(staff?.ordersStillDue).toBeGreaterThanOrEqual(pending.length);

    await db().update(orders).set({ status: "COMPLETED" }).where(eq(orders.orgId, org.orgId));
    expect((await getOrderingStatusForStaff(org.orgId, EVENING))?.ordersStillDue).toBe(0);
  });
});

describe("the POS switch's server facts (ops-1 S4a)", () => {
  const cashier = randomUUID();
  // 2026-06-11 10:00 IST — the next morning's set-up, before the 11:30 opening.
  const NEXT_MORNING = new Date("2026-06-11T04:30:00.000Z");
  // 2026-06-10 09:00 IST — a morning pause, before opening.
  const NINE_AM = new Date("2026-06-10T03:30:00.000Z");

  it("carriedOver is true the next morning for a pause nobody reopened, and false for a pause set today", async () => {
    await pauseOrdering({ orgId: org.orgId, actorUserId: cashier, reason: "power cut", mode: "UNTIL_RESUMED", now: PAUSED_AT });
    expect((await getOrderingStatusForStaff(org.orgId, EVENING_AFTER_PAUSE))?.carriedOver).toBe(false);
    expect((await getOrderingStatusForStaff(org.orgId, NEXT_MORNING))?.carriedOver).toBe(true);
  });

  it("previewPause at 9 am says the default ends TODAY at 11:30 — the line the confirm must show", async () => {
    expect(await previewPause(org.orgId, NINE_AM)).toMatchObject({
      nextOpeningAt: new Date("2026-06-10T06:00:00.000Z"),
      nextOpeningLabel: "today at 11:30 AM",
    });
  });

  it("previewPause mid-service says tomorrow, and counts the orders still due now", async () => {
    const preview = await previewPause(org.orgId, EVENING);
    expect(preview).toMatchObject({ nextOpeningAt: NEXT_OPENING, nextOpeningLabel: "tomorrow at 11:30 AM" });
    expect(preview?.ordersStillDue).toBe((await getOrderingStatusForStaff(org.orgId, EVENING))?.ordersStillDue);
  });

  it("previewPause for an org that does not exist is null, not a guess", async () => {
    expect(await previewPause(randomUUID(), EVENING)).toBeNull();
  });
});
