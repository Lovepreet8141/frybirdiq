/**
 * `paidOrdersFor`'s paid-order set — the same D2/D3 defects the analytics
 * dashboard already fixed (`analytics-sale-set.integration.test.ts`),
 * reproduced against `listCustomers` and `getCustomerProfile`.
 *
 * D2: a partial refund moves the payment from CAPTURED to
 * PARTIALLY_REFUNDED; an inner join on CAPTURED alone dropped the whole
 * order from a customer's spend and visit count. D3: an order with two
 * CAPTURED payment rows (a double capture) came back twice from that same
 * join, doubling its spend contribution. A customer's stats must count each
 * paid order exactly once, using `hasPaidPayment`'s EXISTS check — never a
 * join on `payments`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { orders, payments } from "@/db/schema";
import { paise } from "@/lib/money";
import { getCustomerProfile, listCustomers } from "./customers";
import { createTestCustomer, createTestOrg, deleteTestOrg, type TestCustomer, type TestOrg } from "./__test-support__/fixtures";

type PaymentStatus = "CAPTURED" | "PARTIALLY_REFUNDED" | "REFUNDED";

let sequence = 0;

async function orderFor(
  org: TestOrg,
  customerId: string,
  opts: { status?: "COMPLETED" | "REFUNDED"; grand: bigint; paymentStatuses: readonly PaymentStatus[] },
): Promise<string> {
  sequence += 1;
  const grand = paise(opts.grand);
  const [row] = await db()
    .insert(orders)
    .values({
      orgId: org.orgId,
      locationId: org.locationId,
      orderNumber: `CT${sequence}-${randomUUID().slice(0, 6)}`,
      businessDate: "2026-09-10",
      status: opts.status ?? "COMPLETED",
      channel: "TAKEAWAY",
      fulfilment: "TAKEAWAY",
      customerId,
      grandTotal: grand,
    })
    .returning({ id: orders.id });
  if (!row) throw new Error("fixture: order insert returned no row");

  for (const status of opts.paymentStatuses) {
    await db()
      .insert(payments)
      .values({ orgId: org.orgId, orderId: row.id, status, method: "CASH", provider: "cash", amount: grand });
  }
  return row.id;
}

describe("customer spend/visits — partial refunds and double captures (D2, D3)", () => {
  let org: TestOrg;
  let other: TestOrg;
  let customer: TestCustomer;
  let otherCustomer: TestCustomer;

  beforeAll(async () => {
    org = await createTestOrg();
    other = await createTestOrg();
    customer = await createTestCustomer(org.orgId);
    otherCustomer = await createTestCustomer(other.orgId);

    // One plain sale, one partially refunded (still a sale, D2), one double
    // capture (one sale, not two, D3), and one fully refunded order (never
    // counted, either way).
    await orderFor(org, customer.id, { grand: 10_000n, paymentStatuses: ["CAPTURED"] });
    await orderFor(org, customer.id, { grand: 20_000n, paymentStatuses: ["PARTIALLY_REFUNDED"] });
    await orderFor(org, customer.id, { grand: 40_000n, paymentStatuses: ["CAPTURED", "CAPTURED"] });
    await orderFor(org, customer.id, { grand: 80_000n, status: "REFUNDED", paymentStatuses: ["REFUNDED"] });

    // A second org, same shapes, same-looking customer — must never leak into org's totals.
    await orderFor(other, otherCustomer.id, { grand: 10_000n, paymentStatuses: ["CAPTURED"] });
    await orderFor(other, otherCustomer.id, { grand: 20_000n, paymentStatuses: ["PARTIALLY_REFUNDED"] });
    await orderFor(other, otherCustomer.id, { grand: 40_000n, paymentStatuses: ["CAPTURED", "CAPTURED"] });
  });

  afterAll(async () => {
    await deleteTestOrg(org.orgId);
    await deleteTestOrg(other.orgId);
  });

  it("listCustomers counts the partially refunded order and the double-captured order once each", async () => {
    const rows = await listCustomers(org.orgId);
    const row = rows.find((r) => r.id === customer.id);
    expect(row?.orderCount).toBe(3);
    expect(row?.totalSpend).toBe(70_000n);
  });

  it("getCustomerProfile counts the same three orders and the same spend", async () => {
    const profile = await getCustomerProfile(org.orgId, customer.id);
    expect(profile?.orderCount).toBe(3);
    expect(profile?.totalSpend).toBe(70_000n);
  });

  it("org isolation: the other org's identically-shaped orders never inflate this org's totals", async () => {
    const rows = await listCustomers(org.orgId);
    const row = rows.find((r) => r.id === customer.id);
    // If the other org's three orders (70,000 paise) leaked in, spend would read 140,000 and count 6.
    expect(row?.orderCount).toBe(3);
    expect(row?.totalSpend).toBe(70_000n);

    const otherRows = await listCustomers(other.orgId);
    const otherRow = otherRows.find((r) => r.id === otherCustomer.id);
    expect(otherRow?.orderCount).toBe(3);
    expect(otherRow?.totalSpend).toBe(70_000n);

    // Looking up the other org's customer under this org's id must find nothing.
    expect(await getCustomerProfile(org.orgId, otherCustomer.id)).toBeNull();
  });
});
