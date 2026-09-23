/**
 * getRangeComparison against a real database — `analytics-start-date`'s comparison-baseline clamp.
 *
 * Found in review: `compareOptions` (src/lib/iq/overview.ts) gates which comparison OPTIONS to offer by
 * counting history from `today`, but for `range !== "today"` the actual reference day `getRangeComparison`
 * builds a baseline from is `addDays(today, -1)` — one day earlier. That off-by-one let a comparison
 * `compareOptions` marked "available" still reach one day before the Opening date. `getRangeComparison` now
 * checks the real, constructed baseline range directly (`withinLaunch`) rather than trusting that gate alone.
 *
 * `openedOn` is a plain parameter here, not read from the database — `getRangeComparison` takes it as an
 * argument (the caller already has it from `getOverviewSettings`), so these tests just pass it directly.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { orders, payments } from "@/db/schema";
import { fromRupees } from "@/lib/money";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { getRangeComparison } from "./overview";

const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);

let org: TestOrg;

beforeAll(async () => {
  org = await createTestOrg();
});
afterAll(async () => {
  await deleteTestOrg(org.orgId);
});

async function paidOrder(businessDate: string, createdAt: Date): Promise<void> {
  const [row] = await db()
    .insert(orders)
    .values({ orgId: org.orgId, locationId: org.locationId, orderNumber: `O-${randomUUID().slice(0, 8)}`, businessDate, status: "COMPLETED", channel: "TAKEAWAY", fulfilment: "TAKEAWAY", grandTotal: fromRupees("100"), taxableTotal: fromRupees("100"), createdAt })
    .returning({ id: orders.id });
  await db().insert(payments).values({ orgId: org.orgId, orderId: row!.id, status: "CAPTURED", method: "CASH", provider: "cash", amount: fromRupees("100"), capturedAt: createdAt });
}

describe("analytics-start-date: the comparison baseline is checked directly, not only via compareOptions's availability gate", () => {
  it("range=yesterday, compare=lw: a baseline one day before the Opening date is refused, not silently included (the exact bug found in review)", async () => {
    // "Yesterday" as of 2026-09-08 is 2026-09-07; "same day last week" is 2026-08-31 — one day before an opening of 2026-09-01.
    await paidOrder("2026-08-31", ist("2026-08-31", "20:00")); // the pre-launch baseline day: must never be read
    await paidOrder("2026-09-07", ist("2026-09-07", "20:00")); // "yesterday": the current window

    const result = await getRangeComparison(org.orgId, "yesterday", "lw", ist("2026-09-08", "12:00"), "2026-09-01", false);
    expect(result.current.orders).toBe(1);
    expect(result.comparison).toBeNull();
    expect(result.comparisonAverage).toBeNull();
  });

  it("the same request with includePreLaunch: true reads the pre-launch baseline on purpose", async () => {
    const result = await getRangeComparison(org.orgId, "yesterday", "lw", ist("2026-09-08", "12:00"), "2026-09-01", true);
    expect(result.comparison?.orders).toBe(1);
  });

  it("a fully post-launch Opening date still works exactly as before (no regression)", async () => {
    const result = await getRangeComparison(org.orgId, "yesterday", "lw", ist("2026-09-08", "12:00"), "2026-01-01", false);
    expect(result.comparison?.orders).toBe(1);
  });

  it("range=7d (multi-day), compare=avg4: any one of the four averaged weeks touching pre-launch refuses the whole comparison", async () => {
    // The four averaged weeks (shifted 7/14/21/28 days back from the current 7-day window) reach as far back
    // as 2026-08-05; an Opening date of 2026-08-20 falls inside that span, so at least one of the four weeks
    // (14/21/28 days back) starts before it.
    const result = await getRangeComparison(org.orgId, "7d", "avg4", ist("2026-09-08", "12:00"), "2026-08-20", false);
    expect(result.comparison).toBeNull();
  });

  it("with no Opening date set, behaves exactly as before (never clamped, never refused)", async () => {
    const result = await getRangeComparison(org.orgId, "yesterday", "lw", ist("2026-09-08", "12:00"), null, false);
    expect(result.comparison?.orders).toBe(1);
  });
});
