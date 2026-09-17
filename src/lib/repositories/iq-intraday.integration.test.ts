/**
 * IQ-2 S8: intraday facts in 15-minute IST buckets, on the RELIABILITY
 * fixtures. Buckets sum to the daily facts, the whole day is rebuilt so a
 * late capture moves an earlier bucket, 63-day retention from the same IST
 * date as the backfill (C7), its own lock namespace, and the ≤ 5 s budget.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { iqIntradayFacts, orders, payments } from "@/db/schema";
import { startOfBusinessDay } from "@/lib/dates";
import { paise } from "@/lib/money";
import { DayLockBusyError, factDayLockKey, intradayDayLockKey, purgeIntradayFacts, readDailyFacts, readIntradayFacts, rebuildIntradayDay, recomputeDay } from "./iq-facts";
import { type TestOrg, warmPool } from "./__test-support__/fixtures";
import { type SeededOrder, createTwoTestOrgs, istInstant, seedOrder, seedPayment, seedRefund, seedSale, type TwoOrgs } from "./__test-support__/iq-fixtures";

const DAY = "2026-09-10";
const BURGER = { unitPricePaise: 17_900n } as const; // taxable 17,048

const at = (time: string, date = DAY) => istInstant(date, time);

async function markTicket(order: SeededOrder, acceptedAt: Date | null, readyAt: Date) {
  await db().update(orders).set({ acceptedAt, readyAt }).where(and(eq(orders.id, order.id), eq(orders.orgId, order.orgId)));
}

async function holdLock(key: string): Promise<() => Promise<void>> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let held!: () => void;
  const isHeld = new Promise<void>((resolve) => (held = resolve));
  const holder = db().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    held();
    await released;
  });
  await isHeld;
  return async () => {
    release();
    await holder;
  };
}

const bucket = (rows: Awaited<ReturnType<typeof readIntradayFacts>>, time: string, metricId: string) =>
  rows.find((r) => r.bucketStart.getTime() === at(time).getTime() && r.metricId === metricId)?.value;

describe("IQ intraday facts (IQ-2 S8)", () => {
  let orgs: TwoOrgs;
  let unpaid: SeededOrder;

  beforeAll(async () => {
    orgs = await createTwoTestOrgs();
    const a = orgs.a;
    await seedSale(a, { at: at("00:00"), lines: [BURGER] });
    await seedSale(a, { at: at("00:14:59.999"), lines: [BURGER] });
    const noon = await seedSale(a, { at: at("12:07"), lines: [BURGER] });
    await seedSale(a, { at: at("12:10"), lines: [BURGER], payments: [{}, {}] }); // double capture: once
    const partial = await seedSale(a, { at: at("13:00"), lines: [BURGER] });
    await seedRefund(partial.payments[0]!, { at: at("13:30"), amountPaise: 5_000n }); // still sold
    await seedSale(a, { at: at("12:08"), status: "CANCELLED", lines: [BURGER] }); // captured, cancelled: not sold
    unpaid = await seedOrder(a, { at: at("12:09"), status: "ACCEPTED", lines: [BURGER] }); // not paid yet
    const late = await seedSale(a, { at: at("23:59:59.999"), lines: [BURGER] });

    // Tickets, by ready_at: 870 s in the 12:00 bucket; 1,800 s in 12:15; one from the day before; one never accepted.
    await markTicket(noon.order, at("12:00"), at("12:14:30"));
    await markTicket(partial.order, at("11:50"), at("12:20"));
    const yesterday = await seedSale(a, { at: at("23:50", "2026-09-09"), lines: [BURGER] });
    await markTicket(yesterday.order, at("23:52", "2026-09-09"), at("00:05"));
    await markTicket(late.order, null, at("23:59:59.999"));

    // Org B: a bigger day in the same buckets.
    for (const time of ["00:00", "12:07", "12:07"]) await seedSale(orgs.b, { at: at(time), lines: [{ unitPricePaise: 99_900n }] });

    await rebuildIntradayDay(a.orgId, DAY);
    await rebuildIntradayDay(orgs.b.orgId, DAY);
    await recomputeDay(a.orgId, DAY);
  }, 60_000);

  afterAll(async () => {
    await orgs.cleanup();
  });

  it("buckets sales by created_at IST and tickets by ready_at", async () => {
    const rows = await readIntradayFacts(orgs.a.orgId, DAY);
    expect(bucket(rows, "00:00", "orders_paid")).toBe(2n);
    expect(bucket(rows, "00:00", "revenue_net")).toBe(34_096n);
    expect(bucket(rows, "12:00", "orders_paid")).toBe(2n); // 12:07 + double capture once; cancelled and unpaid out
    expect(bucket(rows, "13:00", "orders_paid")).toBe(1n); // partially refunded, still sold
    expect(bucket(rows, "23:45", "orders_paid")).toBe(1n); // 23:59:59.999 stays on its day
    expect(bucket(rows, "12:00", "tickets_ready")).toBe(1n);
    expect(bucket(rows, "12:00", "ticket_ready_seconds_total")).toBe(870n);
    expect(bucket(rows, "12:15", "ticket_ready_seconds_total")).toBe(1_800n);
    expect(bucket(rows, "00:00", "tickets_ready")).toBe(1n); // ordered the day before, ready at 00:05
    expect(bucket(rows, "23:45", "tickets_ready")).toBeUndefined(); // never accepted
    expect(rows.every((r) => r.value !== 0n)).toBe(true);
  });

  it("sums to the daily orders_paid and revenue_net", async () => {
    const rows = await readIntradayFacts(orgs.a.orgId, DAY);
    const sum = (metricId: string) => rows.filter((r) => r.metricId === metricId).reduce((s, r) => s + r.value, 0n);
    const daily = await readDailyFacts(orgs.a.orgId, DAY, DAY);
    expect(sum("orders_paid")).toBe(daily.totals.orders_paid);
    expect(sum("revenue_net")).toBe(daily.totals.revenue_net);
    expect(sum("orders_paid")).toBe(6n);
  });

  it("rebuilds the whole day, so a late capture moves an earlier bucket, and is idempotent", async () => {
    const orgId = orgs.a.orgId;
    const count = async () => (await db().select({ n: sql<number>`count(*)::int` }).from(iqIntradayFacts).where(and(eq(iqIntradayFacts.orgId, orgId), eq(iqIntradayFacts.businessDate, DAY))))[0]?.n;
    const before = await count();
    await rebuildIntradayDay(orgId, DAY);
    expect(await count()).toBe(before);

    await seedPayment(unpaid, { at: at("15:00"), status: "CAPTURED" });
    await rebuildIntradayDay(orgId, DAY);
    expect(bucket(await readIntradayFacts(orgId, DAY), "12:00", "orders_paid")).toBe(3n);
    await db().delete(payments).where(and(eq(payments.orderId, unpaid.id), eq(payments.orgId, orgId)));
    await rebuildIntradayDay(orgId, DAY);
    expect(bucket(await readIntradayFacts(orgId, DAY), "12:00", "orders_paid")).toBe(2n);
  });

  it("keeps each org to its own rows", async () => {
    const b = await readIntradayFacts(orgs.b.orgId, DAY);
    expect(bucket(b, "12:00", "orders_paid")).toBe(2n);
    expect(bucket(b, "00:00", "revenue_net")).toBe(95_143n);
    expect(bucket(await readIntradayFacts(orgs.a.orgId, DAY), "00:00", "revenue_net")).toBe(34_096n);
  });

  it("purges before the 63-day retention for today's IST date, for this org only (C7)", async () => {
    const today = "2026-09-17"; // first kept date 2026-07-17
    for (const org of [orgs.a, orgs.b]) {
      for (const date of ["2026-07-16", "2026-07-17"]) {
        await seedSale(org, { at: at("12:00", date), lines: [BURGER] });
        await rebuildIntradayDay(org.orgId, date);
      }
    }
    const removed = await purgeIntradayFacts(orgs.a.orgId, today);
    expect(removed).toBe(2); // orders_paid + revenue_net of 16 Jul
    expect(await readIntradayFacts(orgs.a.orgId, "2026-07-16")).toEqual([]);
    expect(await readIntradayFacts(orgs.a.orgId, "2026-07-17")).toHaveLength(2);
    expect(await readIntradayFacts(orgs.b.orgId, "2026-07-16")).toHaveLength(2);
    expect(await readIntradayFacts(orgs.a.orgId, DAY)).not.toEqual([]);
  });

  it("uses its own lock namespace and the caller's budget", async () => {
    const orgId = orgs.a.orgId;
    const releaseDaily = await holdLock(factDayLockKey(orgId, DAY));
    try {
      await expect(rebuildIntradayDay(orgId, DAY, { maxLockWaits: 0 })).resolves.toMatchObject({ lockWaits: 0 });
    } finally {
      await releaseDaily();
    }
    const releaseIntraday = await holdLock(intradayDayLockKey(orgId, DAY));
    try {
      await expect(rebuildIntradayDay(orgId, DAY, { maxLockWaits: 0 })).rejects.toBeInstanceOf(DayLockBusyError);
    } finally {
      await releaseIntraday();
    }
  });

  it("rebuilds a busy day of 600 orders within the 5 s budget", async () => {
    await warmPool(4);
    const org: TestOrg = orgs.b;
    const date = "2026-09-11";
    const start = startOfBusinessDay(date).getTime();
    const rows = Array.from({ length: 600 }, (_, i) => ({
      orgId: org.orgId,
      locationId: org.locationId,
      orderNumber: `BULK-${randomUUID()}`,
      businessDate: date,
      status: "COMPLETED" as const,
      channel: "TAKEAWAY" as const,
      fulfilment: "TAKEAWAY" as const,
      taxableTotal: paise(17_048n),
      grandTotal: paise(17_900n),
      createdAt: new Date(start + i * 120_000),
      acceptedAt: new Date(start + i * 120_000 + 30_000),
      readyAt: new Date(start + i * 120_000 + 630_000),
    }));
    const inserted = await db().insert(orders).values(rows).returning({ id: orders.id, createdAt: orders.createdAt });
    await db()
      .insert(payments)
      .values(inserted.map((o) => ({ orgId: org.orgId, orderId: o.id, status: "CAPTURED" as const, method: "CASH" as const, provider: "cash", amount: paise(17_900n), capturedAt: o.createdAt })));

    const began = Date.now();
    const result = await rebuildIntradayDay(org.orgId, date, { statementTimeoutMs: 5_000 });
    expect(Date.now() - began).toBeLessThan(5_000);
    expect(result.rowsWritten).toBeGreaterThan(0);
    const sum = (await readIntradayFacts(org.orgId, date)).filter((r) => r.metricId === "orders_paid").reduce((s, r) => s + r.value, 0n);
    expect(sum).toBe(600n);
  });
});
