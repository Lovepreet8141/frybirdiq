/**
 * Day off and planned closures against a real database (ops-3): the weekly
 * days, the closed-dates list, the pre-orders they land on, the switch's new
 * durations, and the constraints that hold it all even against a hand edit.
 * Hours are 11:30-23:00 IST. 2026-09-21 is a Monday, 2026-09-22 a Tuesday.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, closedDates, orders, organizations } from "@/db/schema";
import { fromRupees } from "@/lib/money";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { addClosedDate, findPreOrdersOnClosedDays, getClosuresOverview, readClosedDates, removeClosedDate, setWeeklyClosedDays } from "./closed-dates";
import { getOrderingStatus, getOrderingStatusForStaff, getShopStatus, pauseOrdering, previewPause } from "./shop-status";

const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);
const MONDAY_NOON = ist("2026-09-21", "12:00");
const TUESDAY_NOON = ist("2026-09-22", "12:00");

let org: TestOrg;
let other: TestOrg;
const actor = randomUUID();

beforeAll(async () => {
  org = await createTestOrg();
  other = await createTestOrg();
  await db().update(organizations).set({ openingTime: "11:30", closingTime: "23:00" }).where(eq(organizations.id, org.orgId));
});
afterAll(async () => {
  await deleteTestOrg(org.orgId);
  await deleteTestOrg(other.orgId);
});

async function reset(): Promise<void> {
  await db().delete(closedDates).where(eq(closedDates.orgId, org.orgId));
  await db().update(organizations).set({ weeklyClosedDays: [], orderingPausedAt: null, orderingPausedBy: null, orderingPausedReason: null, orderingPausedUntil: null }).where(eq(organizations.id, org.orgId));
  await db().delete(orders).where(eq(orders.orgId, org.orgId));
  await db().delete(auditLogs).where(eq(auditLogs.orgId, org.orgId));
}

async function preOrder(owner: TestOrg, scheduledFor: Date, status: "PAID" | "ACCEPTED" | "PENDING_PAYMENT" | "COMPLETED" | "CANCELLED" | "DRAFT" = "ACCEPTED", name = "Asha"): Promise<string> {
  const [row] = await db()
    .insert(orders)
    .values({
      orgId: owner.orgId,
      locationId: owner.locationId,
      orderNumber: `PRE-${randomUUID().slice(0, 6)}`,
      businessDate: "2026-09-21",
      status,
      channel: "ONLINE",
      fulfilment: "TAKEAWAY",
      customerName: name,
      scheduledFor,
      grandTotal: fromRupees("200"),
    })
    .returning({ id: orders.id });
  return row!.id;
}

const auditActions = async (action: string) => (await db().select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.orgId, org.orgId), eq(auditLogs.action, action)))).length;

describe("closed dates", () => {
  it("adds a date, reads it back, audits it, and scopes it to its own org", async () => {
    await reset();
    const result = await addClosedDate({ orgId: org.orgId, actorUserId: actor, startDate: "2026-10-20", endDate: "2026-10-22", note: "Closed for Diwali", now: MONDAY_NOON });
    expect(result).toEqual({ ok: true, preOrders: [] });

    const rows = await readClosedDates(org.orgId, MONDAY_NOON);
    expect(rows).toMatchObject([{ startDate: "2026-10-20", endDate: "2026-10-22", note: "Closed for Diwali" }]);
    expect(await readClosedDates(other.orgId, MONDAY_NOON)).toEqual([]); // org_id scoping
    const [audit] = await db().select().from(auditLogs).where(and(eq(auditLogs.orgId, org.orgId), eq(auditLogs.action, "closed_date_added")));
    expect(audit).toMatchObject({ actorUserId: actor, after: { startDate: "2026-10-20", endDate: "2026-10-22", note: "Closed for Diwali" } });
  });

  it("history does not weigh on the gate: a range that ended long ago is not read", async () => {
    await reset();
    await db().insert(closedDates).values({ orgId: org.orgId, startDate: "2026-01-01", endDate: "2026-01-03", publicNote: null });
    await db().insert(closedDates).values({ orgId: org.orgId, startDate: "2026-09-20", endDate: "2026-09-21", publicNote: null });
    const rows = await readClosedDates(org.orgId, MONDAY_NOON);
    expect(rows.map((r) => r.startDate)).toEqual(["2026-09-20"]);
  });

  it("refuses the invalid without writing", async () => {
    await reset();
    const bad = await addClosedDate({ orgId: org.orgId, actorUserId: actor, startDate: "2026-09-10", endDate: "2026-09-11", note: null, now: MONDAY_NOON });
    expect(bad).toMatchObject({ ok: false, code: "INVALID" });
    expect(await readClosedDates(org.orgId, MONDAY_NOON)).toEqual([]);
    expect(await auditActions("closed_date_added")).toBe(0);
  });

  it("removes a date, audits it, and says so when it was already gone", async () => {
    await reset();
    await addClosedDate({ orgId: org.orgId, actorUserId: actor, startDate: "2026-10-20", endDate: "2026-10-20", note: null, now: MONDAY_NOON });
    const [row] = await readClosedDates(org.orgId, MONDAY_NOON);
    expect(await removeClosedDate({ orgId: org.orgId, actorUserId: actor, id: row!.id })).toEqual({ ok: true, preOrders: [] });
    expect(await readClosedDates(org.orgId, MONDAY_NOON)).toEqual([]);
    expect(await auditActions("closed_date_removed")).toBe(1);
    expect(await removeClosedDate({ orgId: org.orgId, actorUserId: actor, id: row!.id })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("another org's closed date can never be removed by this org's id", async () => {
    await reset();
    await db().insert(closedDates).values({ orgId: other.orgId, startDate: "2026-10-20", endDate: "2026-10-20", publicNote: null });
    const [theirs] = await db().select({ id: closedDates.id }).from(closedDates).where(eq(closedDates.orgId, other.orgId));
    expect(await removeClosedDate({ orgId: org.orgId, actorUserId: actor, id: theirs!.id })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect((await db().select({ id: closedDates.id }).from(closedDates).where(eq(closedDates.orgId, other.orgId))).length).toBe(1);
  });

  it("the database itself refuses a backwards range and an over-long note", async () => {
    await expect(db().insert(closedDates).values({ orgId: org.orgId, startDate: "2026-10-22", endDate: "2026-10-20" })).rejects.toThrow();
    await expect(db().insert(closedDates).values({ orgId: org.orgId, startDate: "2026-10-20", endDate: "2026-10-20", publicNote: "x".repeat(121) })).rejects.toThrow();
    await expect(db().insert(closedDates).values({ orgId: org.orgId, startDate: "2026-10-20", endDate: "2026-10-20", publicNote: "" })).rejects.toThrow();
  });
});

describe("the weekly day off", () => {
  it("sets Tuesday, audits before and after, and is a no-op the second time", async () => {
    await reset();
    expect(await setWeeklyClosedDays({ orgId: org.orgId, actorUserId: actor, days: [2], now: MONDAY_NOON })).toEqual({ ok: true, preOrders: [] });
    expect((await getShopStatus(org.orgId, MONDAY_NOON))?.closures.weeklyClosedDays).toEqual([2]);
    const [audit] = await db().select().from(auditLogs).where(and(eq(auditLogs.orgId, org.orgId), eq(auditLogs.action, "weekly_closed_days_changed")));
    expect(audit).toMatchObject({ actorUserId: actor, before: { weeklyClosedDays: [] }, after: { weeklyClosedDays: [2] } });
    await setWeeklyClosedDays({ orgId: org.orgId, actorUserId: actor, days: [2], now: MONDAY_NOON });
    expect(await auditActions("weekly_closed_days_changed")).toBe(1);
  });

  it("refuses all seven days and junk, in code and again in the database", async () => {
    await reset();
    expect(await setWeeklyClosedDays({ orgId: org.orgId, actorUserId: actor, days: [0, 1, 2, 3, 4, 5, 6] })).toMatchObject({ ok: false, code: "INVALID" });
    expect(await setWeeklyClosedDays({ orgId: org.orgId, actorUserId: actor, days: [2, 9] })).toMatchObject({ ok: false, code: "INVALID" });
    await expect(db().update(organizations).set({ weeklyClosedDays: [0, 1, 2, 3, 4, 5, 6] }).where(eq(organizations.id, org.orgId))).rejects.toThrow();
    await expect(db().update(organizations).set({ weeklyClosedDays: [7] }).where(eq(organizations.id, org.orgId))).rejects.toThrow();
  });

  it("marking Tuesday lists the Tuesday pre-orders that already exist, and cancels nothing", async () => {
    await reset();
    const tuesdayOrder = await preOrder(org, ist("2026-09-22", "13:00"));
    const wednesdayOrder = await preOrder(org, ist("2026-09-23", "13:00"));
    const result = await setWeeklyClosedDays({ orgId: org.orgId, actorUserId: actor, days: [2], now: MONDAY_NOON });
    expect(result.ok && result.preOrders.map((p) => p.orderId)).toEqual([tuesdayOrder]);
    const statuses = await db().select({ id: orders.id, status: orders.status }).from(orders).where(eq(orders.orgId, org.orgId));
    expect(statuses.find((o) => o.id === tuesdayOrder)?.status).toBe("ACCEPTED");
    expect(statuses.find((o) => o.id === wednesdayOrder)?.status).toBe("ACCEPTED");
  });
});

describe("pre-orders on a closed day", () => {
  it("lists which ones, with number, name, time and the note, in time order", async () => {
    await reset();
    const late = await preOrder(org, ist("2026-10-20", "20:00"), "PAID", "Ravi");
    const early = await preOrder(org, ist("2026-10-20", "12:30"), "PENDING_PAYMENT", "Asha");
    const result = await addClosedDate({ orgId: org.orgId, actorUserId: actor, startDate: "2026-10-20", endDate: "2026-10-20", note: "Closed for Diwali", now: MONDAY_NOON });
    if (!result.ok) throw new Error(result.error);
    expect(result.preOrders.map((p) => [p.orderId, p.customerName, p.note])).toEqual([[early, "Asha", "Closed for Diwali"], [late, "Ravi", "Closed for Diwali"]]);
  });

  it("ignores finished, cancelled and draft orders, past ones, other days and other orgs", async () => {
    await reset();
    await preOrder(org, ist("2026-10-20", "12:00"), "COMPLETED");
    await preOrder(org, ist("2026-10-20", "12:15"), "CANCELLED");
    await preOrder(org, ist("2026-10-20", "12:30"), "DRAFT");
    await preOrder(org, ist("2026-10-21", "12:30"), "ACCEPTED"); // a different day
    await preOrder(other, ist("2026-10-20", "12:30"), "ACCEPTED"); // a different org
    const listed = await preOrder(org, ist("2026-10-20", "13:00"), "PREPARING" as never);
    const dates = { weeklyClosedDays: [], closedDates: [{ startDate: "2026-10-20", endDate: "2026-10-20", note: null }] };
    expect((await findPreOrdersOnClosedDays(org.orgId, dates, MONDAY_NOON)).map((p) => p.orderId)).toEqual([listed]);
    // a pre-order whose time has already gone is no longer "coming up"
    expect(await findPreOrdersOnClosedDays(org.orgId, dates, ist("2026-10-20", "14:00"))).toEqual([]);
  });

  it("the overview keeps them visible after the page is reloaded, and the staff status counts them", async () => {
    await reset();
    await setWeeklyClosedDays({ orgId: org.orgId, actorUserId: actor, days: [2], now: MONDAY_NOON });
    const id = await preOrder(org, ist("2026-09-22", "13:00"));
    const overview = await getClosuresOverview(org.orgId, MONDAY_NOON);
    expect(overview?.preOrdersOnClosedDays.map((p) => p.orderId)).toEqual([id]);
    const status = await getOrderingStatusForStaff(org.orgId, TUESDAY_NOON);
    expect(status).toMatchObject({ state: "closedByHours", dayOff: { source: "WEEKLY" }, preOrdersOnClosedDays: 1 });
  });
});

describe("the shop status on a day off", () => {
  it("Tuesday noon: closed all day, with the public note; Wednesday noon: open", async () => {
    await reset();
    await addClosedDate({ orgId: org.orgId, actorUserId: actor, startDate: "2026-09-22", endDate: "2026-09-22", note: "Closed for Diwali", now: MONDAY_NOON });
    expect(await getOrderingStatus(org.orgId, TUESDAY_NOON)).toMatchObject({ state: "closedByHours", reopensAtLabel: "tomorrow at 11:30 AM", dayOff: { source: "DATE", note: "Closed for Diwali" } });
    expect(await getOrderingStatus(org.orgId, ist("2026-09-23", "12:00"))).toMatchObject({ state: "open" });
  });

  it("the customer status never carries who or why of a pause, and the day-off note is only what the owner chose to publish", async () => {
    await reset();
    const status = await getOrderingStatus(org.orgId, MONDAY_NOON);
    expect(JSON.stringify(status)).not.toContain("pausedBy");
  });
});

describe("the switch's new durations", () => {
  it("'Closed for the rest of today' at 9 am ends tomorrow, not at 11:30 today; the audit row says which choice", async () => {
    await reset();
    const now = ist("2026-09-21", "09:00");
    const result = await pauseOrdering({ orgId: org.orgId, actorUserId: actor, reason: "Too busy", mode: "REST_OF_TODAY", now });
    expect(result.ok && result.status).toMatchObject({ state: "paused", reopensAt: ist("2026-09-22", "11:30") });
    const [audit] = await db().select().from(auditLogs).where(and(eq(auditLogs.orgId, org.orgId), eq(auditLogs.action, "ordering_paused")));
    expect(audit?.after).toMatchObject({ mode: "REST_OF_TODAY", reopensAt: ist("2026-09-22", "11:30").toISOString() });
  });

  it("'Until we next open' on Monday night skips the Tuesday off day", async () => {
    await reset();
    await setWeeklyClosedDays({ orgId: org.orgId, actorUserId: actor, days: [2], now: MONDAY_NOON });
    const now = ist("2026-09-21", "22:00");
    const result = await pauseOrdering({ orgId: org.orgId, actorUserId: actor, reason: "Too busy", mode: "UNTIL_NEXT_OPENING", now });
    expect(result.ok && result.status).toMatchObject({ state: "paused", reopensAt: ist("2026-09-23", "11:30") });
  });

  it("'Closed until a date I pick' ends at that day's opening, skipping a closed day", async () => {
    await reset();
    await addClosedDate({ orgId: org.orgId, actorUserId: actor, startDate: "2026-09-25", endDate: "2026-09-26", note: null, now: MONDAY_NOON });
    const result = await pauseOrdering({ orgId: org.orgId, actorUserId: actor, reason: "Other: family function", mode: "UNTIL_DATE", untilDate: "2026-09-25", now: MONDAY_NOON });
    expect(result.ok && result.status).toMatchObject({ state: "paused", reopensAt: ist("2026-09-27", "11:30") });
    const [audit] = await db().select().from(auditLogs).where(and(eq(auditLogs.orgId, org.orgId), eq(auditLogs.action, "ordering_paused")));
    expect(audit?.after).toMatchObject({ mode: "UNTIL_DATE", untilDate: "2026-09-25" });
  });

  it("previewPause gives each choice its own label, and the chosen date's", async () => {
    await reset();
    const preview = await previewPause(org.orgId, ist("2026-09-21", "09:00"), "2026-09-24");
    expect(preview).toMatchObject({
      nextOpeningLabel: "today at 11:30 AM",
      restOfTodayLabel: "tomorrow at 11:30 AM",
      untilDate: { date: "2026-09-24", label: "Thursday at 11:30 AM" },
    });
    expect((await previewPause(org.orgId, ist("2026-09-21", "09:00")))?.untilDate).toBeNull();
  });
});


describe("a closure and an order in flight cannot pass each other", () => {
  it("adding a closed date waits for an order transaction that holds the shop row (FOR SHARE), then lists what that order wrote", async () => {
    await reset();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    let orderId = "";
    // What persistOrder does: the org row locked FOR SHARE, the order row inserted, not yet committed.
    const inFlight = db().transaction(async (tx) => {
      await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, org.orgId)).for("share");
      const [row] = await tx
        .insert(orders)
        .values({ orgId: org.orgId, locationId: org.locationId, orderNumber: `LIVE-${randomUUID().slice(0, 6)}`, businessDate: "2026-09-21", status: "ACCEPTED", channel: "ONLINE", fulfilment: "TAKEAWAY", customerName: "Mid-flight", scheduledFor: ist("2026-10-20", "13:00"), grandTotal: fromRupees("200") })
        .returning({ id: orders.id });
      orderId = row!.id;
      locked();
      await held;
    });
    await lockTaken;

    const adding = addClosedDate({ orgId: org.orgId, actorUserId: actor, startDate: "2026-10-20", endDate: "2026-10-20", note: null, now: MONDAY_NOON });
    let settled = false;
    void adding.then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(settled).toBe(false); // the closure waits for the order rather than passing it

    release();
    await inFlight;
    const result = await adding;
    if (!result.ok) throw new Error(result.error);
    // ...and because it waited, the order it could not have seen is in the list the owner is shown.
    expect(result.preOrders.map((p) => p.orderId)).toEqual([orderId]);
  });
});
