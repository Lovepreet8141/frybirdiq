/**
 * The paid-order set every owner revenue figure reads — defects D2 and D3.
 *
 * D2: a partial refund moves the payment from CAPTURED to PARTIALLY_REFUNDED,
 * and an inner join on CAPTURED dropped the whole order from revenue, order
 * count, AOV, P&L and "not selling". D3: an order with two CAPTURED payment
 * rows came back twice from the join, doubling its revenue. An order is in
 * the set once when any payment is CAPTURED or PARTIALLY_REFUNDED.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { orderItems, orders, payments } from "@/db/schema";
import { endOfBusinessDay, startOfBusinessDay, type DateRange } from "@/lib/dates";
import { paise } from "@/lib/money";
import { getDashboard, notSelling, paidOrders, periodTotals } from "./analytics";
import { getProfitAndLoss } from "./expenses";
import { productLastSales } from "./overview";
import { createTestOrg, createTestProduct, deleteTestOrg, type TestOrg, type TestProduct } from "./__test-support__/fixtures";

const DAY = "2026-09-10";
const range: DateRange = { from: startOfBusinessDay(DAY), to: endOfBusinessDay(DAY), label: DAY };
// 12:00 IST on DAY.
const NOON = new Date("2026-09-10T06:30:00.000Z");

type PaymentStatus = "CAPTURED" | "PARTIALLY_REFUNDED" | "REFUNDED";

interface Seeded {
  readonly plain: string;
  readonly partial: string;
  readonly double: string;
  readonly refunded: string;
  readonly partialOnly: TestProduct;
}

let sequence = 0;

async function order(
  org: TestOrg,
  opts: { status: "COMPLETED" | "READY" | "REFUNDED"; taxable: bigint; payments: readonly PaymentStatus[]; product?: TestProduct },
): Promise<string> {
  sequence += 1;
  const [row] = await db()
    .insert(orders)
    .values({
      orgId: org.orgId,
      locationId: org.locationId,
      orderNumber: `T${sequence}`,
      businessDate: DAY,
      status: opts.status,
      channel: "TAKEAWAY",
      fulfilment: "TAKEAWAY",
      taxableTotal: paise(opts.taxable),
      grandTotal: paise((opts.taxable * 105n) / 100n),
      createdAt: NOON,
    })
    .returning({ id: orders.id });
  if (!row) throw new Error("fixture: order insert returned no row");

  const grand = paise((opts.taxable * 105n) / 100n);
  for (const status of opts.payments) {
    await db()
      .insert(payments)
      .values({ orgId: org.orgId, orderId: row.id, status, method: "CASH", provider: "cash", amount: grand, capturedAt: NOON });
  }
  if (opts.product) {
    await db().insert(orderItems).values({
      orgId: org.orgId,
      orderId: row.id,
      productId: opts.product.id,
      productName: "Partial only",
      unitPrice: grand,
      lineSubtotal: grand,
      lineTaxable: paise(opts.taxable),
      lineTotal: grand,
    });
  }
  return row.id;
}

async function seed(org: TestOrg): Promise<Seeded> {
  const partialOnly = await createTestProduct(org.orgId, { name: `Partial only ${org.slug}` });
  return {
    plain: await order(org, { status: "COMPLETED", taxable: 10_000n, payments: ["CAPTURED"] }),
    partial: await order(org, { status: "COMPLETED", taxable: 20_000n, payments: ["PARTIALLY_REFUNDED"], product: partialOnly }),
    double: await order(org, { status: "COMPLETED", taxable: 40_000n, payments: ["CAPTURED", "CAPTURED"] }),
    refunded: await order(org, { status: "REFUNDED", taxable: 80_000n, payments: ["REFUNDED"] }),
    partialOnly,
  };
}

describe("paid-order set — partial refunds and double captures (D2, D3)", () => {
  let org: TestOrg;
  let other: TestOrg;
  let seeded: Seeded;

  beforeAll(async () => {
    org = await createTestOrg();
    other = await createTestOrg();
    seeded = await seed(org);
    // A second org with the same shapes on the same day: nothing of it may leak in.
    await seed(other);
  });

  afterAll(async () => {
    await deleteTestOrg(org.orgId);
    await deleteTestOrg(other.orgId);
  });

  it("counts a partially refunded order and a double-captured order exactly once", async () => {
    const rows = await paidOrders(org.orgId, range);
    expect(rows.map((r) => r.id).sort()).toEqual([seeded.plain, seeded.partial, seeded.double].sort());
  });

  it("period revenue and order count include each paid order once", async () => {
    expect(await periodTotals(org.orgId, range)).toEqual({ revenue: 70_000n, orders: 3 });
  });

  it("P&L revenue reads the same set", async () => {
    const pnl = await getProfitAndLoss(org.orgId, range);
    expect(pnl.revenue).toBe(70_000n);
    expect(pnl.orderCount).toBe(3);
  });

  it("dashboard revenue, orders and AOV count each paid order once", async () => {
    const dashboard = await getDashboard(org.orgId, range);
    expect(dashboard.revenue.value).toBe(70_000n);
    expect(dashboard.orders.value).toBe(3);
    expect(dashboard.averageOrder.value).toBe(23_333n);
  });

  it("a product sold only on a partially refunded order is selling", async () => {
    const gaps = await notSelling(org.orgId, range, 50);
    expect(gaps.map((g) => g.slug)).not.toContain(seeded.partialOnly.slug);
    const last = await productLastSales(org.orgId, new Date("2026-09-11T06:30:00.000Z"));
    expect(last.find((p) => p.slug === seeded.partialOnly.slug)?.lastSoldAt).not.toBeNull();
  });

  it("an unfinished order with a partially refunded payment is not open pipeline", async () => {
    // Last test in the file: this order would otherwise join the sets above.
    await order(org, { status: "READY", taxable: 5_000n, payments: ["PARTIALLY_REFUNDED"] });
    const dashboard = await getDashboard(org.orgId, range);
    expect(dashboard.openOrders).toBe(0);
  });
});
