/**
 * The GST summary and orders export read the same paid-order set as every
 * revenue figure (`analytics.ts`'s `hasPaidPayment`) — defects D2 and D3.
 *
 * D2: a partial refund moves the payment to PARTIALLY_REFUNDED, and an inner
 * join on CAPTURED dropped the order's GST from the summary and exported it
 * as unpaid. D3: two CAPTURED rows joined twice and doubled the order's
 * taxable value and tax. An order counts once when any payment is CAPTURED
 * or PARTIALLY_REFUNDED and the order is not CANCELLED, FAILED or REFUNDED.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { orderItems, orders, payments } from "@/db/schema";
import { endOfBusinessDay, startOfBusinessDay, type DateRange } from "@/lib/dates";
import { paise } from "@/lib/money";
import { gstSummaryByRate, listOrdersForExport } from "./exports";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

const DAY = "2026-09-10";
const range: DateRange = { from: startOfBusinessDay(DAY), to: endOfBusinessDay(DAY), label: DAY };
// 12:00 IST on DAY.
const NOON = new Date("2026-09-10T06:30:00.000Z");

type PaymentStatus = "CAPTURED" | "PARTIALLY_REFUNDED" | "REFUNDED" | "FAILED";
interface SeedPayment {
  readonly status: PaymentStatus;
  readonly method: "CASH" | "UPI";
}

let sequence = 0;

/** One order with one 5% line: tax is 5% of `taxable`. Payments are inserted in the order given. */
async function order(
  org: TestOrg,
  opts: { number: string; status: "COMPLETED" | "CANCELLED"; taxable: bigint; payments: readonly SeedPayment[] },
): Promise<void> {
  sequence += 1;
  const tax = (opts.taxable * 5n) / 100n;
  const grand = paise(opts.taxable + tax);
  const [row] = await db()
    .insert(orders)
    .values({
      orgId: org.orgId,
      locationId: org.locationId,
      orderNumber: `${opts.number}-${sequence}`,
      businessDate: DAY,
      status: opts.status,
      channel: "TAKEAWAY",
      fulfilment: "TAKEAWAY",
      taxableTotal: paise(opts.taxable),
      taxTotal: paise(tax),
      grandTotal: grand,
      createdAt: NOON,
    })
    .returning({ id: orders.id });
  if (!row) throw new Error("fixture: order insert returned no row");

  await db().insert(orderItems).values({
    orgId: org.orgId,
    orderId: row.id,
    productName: opts.number,
    unitPrice: grand,
    lineSubtotal: grand,
    taxRateBps: 500,
    lineTaxable: paise(opts.taxable),
    lineTax: paise(tax),
    lineTotal: grand,
  });

  for (const payment of opts.payments) {
    await db()
      .insert(payments)
      .values({
        orgId: org.orgId,
        orderId: row.id,
        status: payment.status,
        method: payment.method,
        provider: payment.method === "CASH" ? "cash" : "razorpay",
        amount: grand,
        capturedAt: payment.status === "FAILED" ? null : NOON,
      });
  }
}

async function seed(org: TestOrg): Promise<void> {
  await order(org, { number: "plain", status: "COMPLETED", taxable: 10_000n, payments: [{ status: "CAPTURED", method: "CASH" }] });
  // Paid by UPI and partly refunded; a later failed cash attempt must not win.
  await order(org, {
    number: "partial",
    status: "COMPLETED",
    taxable: 20_000n,
    payments: [
      { status: "PARTIALLY_REFUNDED", method: "UPI" },
      { status: "FAILED", method: "CASH" },
    ],
  });
  await order(org, {
    number: "double",
    status: "COMPLETED",
    taxable: 40_000n,
    payments: [
      { status: "CAPTURED", method: "CASH" },
      { status: "CAPTURED", method: "CASH" },
    ],
  });
  // A double capture with one side refunded: still paid once.
  await order(org, {
    number: "mixed",
    status: "COMPLETED",
    taxable: 3_000n,
    payments: [
      { status: "REFUNDED", method: "CASH" },
      { status: "CAPTURED", method: "CASH" },
    ],
  });
  // Only payment fully refunded: not paid, no GST collected.
  await order(org, { number: "refunded", status: "COMPLETED", taxable: 80_000n, payments: [{ status: "REFUNDED", method: "CASH" }] });
  // Captured but the order was cancelled: excluded, as in `paidOrders`.
  await order(org, { number: "cancelled", status: "CANCELLED", taxable: 160_000n, payments: [{ status: "CAPTURED", method: "CASH" }] });
}

describe("exports — partial refunds and double captures (D2, D3)", () => {
  let org: TestOrg;
  let other: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg();
    other = await createTestOrg();
    await seed(org);
    // A second org with the same shapes on the same day: nothing of it may leak in.
    await seed(other);
  });

  afterAll(async () => {
    await deleteTestOrg(org.orgId);
    await deleteTestOrg(other.orgId);
  });

  it("GST summary counts a partially refunded and a double-captured order exactly once", async () => {
    // plain 10_000 + partial 20_000 + double 40_000 + mixed 3_000.
    expect(await gstSummaryByRate(org.orgId, range)).toEqual([
      { rateBps: 500, taxable: 73_000n, cgst: 1_825n, sgst: 1_825n, igst: 0n, total: 3_650n, orderCount: 4 },
    ]);
  });

  it("orders export marks paid by the same set and reports the paid payment's method", async () => {
    const rows = await listOrdersForExport(org.orgId, range);
    const byNumber = new Map(rows.map((row) => [row.orderNumber.split("-")[0], row]));
    expect(rows).toHaveLength(6);
    expect(
      Object.fromEntries([...byNumber].map(([number, row]) => [number, { isPaid: row.isPaid, paymentMethod: row.paymentMethod }])),
    ).toEqual({
      plain: { isPaid: true, paymentMethod: "CASH" },
      partial: { isPaid: true, paymentMethod: "UPI" },
      double: { isPaid: true, paymentMethod: "CASH" },
      mixed: { isPaid: true, paymentMethod: "CASH" },
      refunded: { isPaid: false, paymentMethod: "CASH" },
      cancelled: { isPaid: true, paymentMethod: "CASH" },
    });
  });
});
