/**
 * Promotion AOV (roadmap 7.3): the with/without split over the sale set, the
 * IST window edge, org isolation, and "no data" for a promotion with no orders.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { orders, payments, promotions } from "@/db/schema";
import { paise } from "@/lib/money";
import { resolveRange, startOfBusinessDay } from "@/lib/dates";
import { listPromotionAov } from "./promotion-aov";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

let org: TestOrg;
let other: TestOrg;
let seq = 0;
const window = { from: startOfBusinessDay("2026-09-10"), to: startOfBusinessDay("2026-09-11") };
const inside = new Date("2026-09-10T06:00:00Z");

async function sale(o: TestOrg, opts: { net: bigint; discount?: bigint; code?: string | null; at?: Date; status?: "COMPLETED" | "CANCELLED"; pay?: "CAPTURED" | "REFUNDED" | null }) {
  seq += 1;
  const [row] = await db()
    .insert(orders)
    .values({
      orgId: o.orgId,
      locationId: o.locationId,
      orderNumber: `PA${seq}-${randomUUID().slice(0, 6)}`,
      businessDate: "2026-09-10",
      status: opts.status ?? "COMPLETED",
      channel: "TAKEAWAY",
      fulfilment: "TAKEAWAY",
      taxableTotal: paise(opts.net),
      discountTotal: paise(opts.discount ?? 0n),
      grandTotal: paise(opts.net),
      promotionCode: opts.code ?? null,
      createdAt: opts.at ?? inside,
    })
    .returning({ id: orders.id });
  if (opts.pay !== null) {
    await db().insert(payments).values({ orgId: o.orgId, orderId: row!.id, status: opts.pay ?? "CAPTURED", method: "CASH", provider: "cash", amount: paise(opts.net) });
  }
}

beforeAll(async () => {
  org = await createTestOrg();
  other = await createTestOrg();
  await db().insert(promotions).values([
    { orgId: org.orgId, name: "Fest", code: "FEST10", type: "coupon", discountBps: 1000 },
    { orgId: org.orgId, name: "Unused", code: "NOPE", type: "coupon", discountBps: 500 },
    { orgId: org.orgId, name: "Rules only", type: "happyhour" },
  ]);
  await sale(org, { net: 30_000n, discount: 3_000n, code: "fest10" }); // case-insensitive link
  await sale(org, { net: 20_000n, discount: 2_000n, code: "FEST10" });
  await sale(org, { net: 10_000n });
  await sale(org, { net: 12_000n });
  await sale(org, { net: 99_000n, code: "FEST10", status: "CANCELLED" }); // not a sale
  await sale(org, { net: 99_000n, code: "FEST10", pay: null }); // unpaid
  await sale(org, { net: 99_000n, code: "FEST10", pay: "REFUNDED" }); // refunded
  await sale(org, { net: 99_000n, code: "FEST10", at: new Date("2026-09-10T18:30:00Z") }); // 00:00 IST on the 11th: outside
  await sale(org, { net: 99_000n, code: "FEST10", at: new Date("2026-09-09T18:29:00Z") }); // 23:59 IST on the 9th: outside
  await sale(other, { net: 77_000n, code: "FEST10" });
});
afterAll(async () => {
  await deleteTestOrg(org.orgId);
  await deleteTestOrg(other.orgId);
});

describe("listPromotionAov", () => {
  it("splits the paid orders in the IST window into with and without the code", async () => {
    const fest = (await listPromotionAov(org.orgId, window)).find((r) => r.code === "FEST10")!;
    expect(fest.comparison?.with).toMatchObject({ orders: 2, revenue: 50_000n, discount: 5_000n, aov: 25_000n });
    expect(fest.comparison?.without).toMatchObject({ orders: 2, revenue: 22_000n, aov: 11_000n });
    expect(fest.comparison?.aovGap).toBe(14_000n);
    expect(fest.comparison?.smallSample).toBe(true);
  });

  it("says no data, not zero, for a promotion nobody used, and cannot measure one with no code", async () => {
    const rows = await listPromotionAov(org.orgId, window);
    const nope = rows.find((r) => r.code === "NOPE")!;
    expect(nope.comparison?.with).toMatchObject({ orders: 0, aov: null });
    expect(nope.comparison?.aovGap).toBeNull();
    expect(rows.find((r) => r.name === "Rules only")?.comparison).toBeNull();
  });

  it("never sees another org's orders", async () => {
    const fest = (await listPromotionAov(org.orgId, window)).find((r) => r.code === "FEST10")!;
    expect(fest.comparison?.with.orders).toBe(2);
    expect(await listPromotionAov(other.orgId, window)).toEqual([]);
  });

  it("reads a stated named range without error", async () => {
    expect((await listPromotionAov(org.orgId, resolveRange("30d"))).length).toBe(3);
  });
});
