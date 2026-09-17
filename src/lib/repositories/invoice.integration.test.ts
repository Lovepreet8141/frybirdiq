/**
 * Invoice reads are org-scoped (payment baseline P3-1, card fin-1).
 *
 * The app connects as `postgres`, which bypasses row-level security, so an
 * unscoped read by order id returns another organization's order — its
 * customer's name, phone, address and purchase. Two orgs, each with an order,
 * a modifier and a payment: each org sees only its own, and the customer
 * receipt, bound to the site's org (`ORG_SLUG`), never renders the other's.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { orderItemModifiers, orderItems, orders, payments } from "@/db/schema";
import { paise } from "@/lib/money";
import { getCustomerReceipt } from "@/lib/receipt/customer-view";
import { getInvoice } from "./invoice";
import { ORG_SLUG } from "./org";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

/** One paid takeaway order: a 5% line with one modifier, and a captured cash payment. */
async function paidOrder(org: TestOrg, label: string): Promise<string> {
  const [order] = await db()
    .insert(orders)
    .values({
      orgId: org.orgId,
      locationId: org.locationId,
      orderNumber: `TEST-${randomUUID().slice(0, 8)}`,
      businessDate: "2026-09-10",
      status: "PAID",
      channel: "TAKEAWAY",
      fulfilment: "TAKEAWAY",
      customerName: `Customer ${label}`,
      customerPhone: "9999999999",
      taxableTotal: paise(10_000n),
      taxTotal: paise(500n),
      cgstTotal: paise(250n),
      sgstTotal: paise(250n),
      grandTotal: paise(10_500n),
    })
    .returning({ id: orders.id });
  if (!order) throw new Error("fixture: order insert returned no row");

  const [item] = await db()
    .insert(orderItems)
    .values({
      orgId: org.orgId,
      orderId: order.id,
      productName: `Burger ${label}`,
      unitPrice: paise(10_500n),
      lineSubtotal: paise(10_500n),
      taxRateBps: 500,
      lineTaxable: paise(10_000n),
      lineTax: paise(500n),
      lineTotal: paise(10_500n),
    })
    .returning({ id: orderItems.id });
  if (!item) throw new Error("fixture: order item insert returned no row");

  await db()
    .insert(orderItemModifiers)
    .values({ orgId: org.orgId, orderItemId: item.id, groupName: "Size", modifierName: `Large ${label}` });

  await db()
    .insert(payments)
    .values({ orgId: org.orgId, orderId: order.id, status: "CAPTURED", method: "CASH", provider: "cash", amount: paise(10_500n) });

  return order.id;
}

describe("invoice reads — org scoping (P3-1)", () => {
  let site: TestOrg;
  let other: TestOrg;
  let siteOrderId: string;
  let otherOrderId: string;

  beforeAll(async () => {
    // getCustomerReceipt resolves the site org by ORG_SLUG, as
    // settle-atomicity.integration.test.ts does; local database only.
    site = await createTestOrg({ slug: ORG_SLUG });
    other = await createTestOrg();
    siteOrderId = await paidOrder(site, "A");
    otherOrderId = await paidOrder(other, "B");
  });

  afterAll(async () => {
    await deleteTestOrg(site.orgId);
    await deleteTestOrg(other.orgId);
  });

  it("returns an org's own invoice with only that order's lines, modifiers and payment", async () => {
    const invoice = await getInvoice(other.orgId, otherOrderId);
    expect(invoice).not.toBeNull();
    expect(invoice?.orgId).toBe(other.orgId);
    expect(invoice?.customer.name).toBe("Customer B");
    expect(invoice?.lines.map((line) => [line.name, line.modifiers])).toEqual([["Burger B", ["Large B"]]]);
    expect(invoice?.payment).toEqual({ method: "CASH", status: "CAPTURED", reference: null });
  });

  it("returns null for another org's order id, in both directions", async () => {
    expect(await getInvoice(site.orgId, otherOrderId)).toBeNull();
    expect(await getInvoice(other.orgId, siteOrderId)).toBeNull();
  });

  it("customer receipt renders the site org's order and refuses another org's", async () => {
    const receipt = await getCustomerReceipt(siteOrderId);
    expect(receipt?.orderId).toBe(siteOrderId);
    expect(receipt?.customer.name).toBe("Customer A");

    expect(await getCustomerReceipt(otherOrderId)).toBeNull();
  });
});
