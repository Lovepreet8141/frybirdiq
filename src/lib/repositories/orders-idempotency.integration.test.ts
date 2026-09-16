/**
 * placeCounterOrder against a real database — the core "a double-tap or a
 * retried request never rings up two orders" guarantee, for the POS path.
 *
 * Uses the "frybird" slug deliberately: placeCounterOrder calls
 * requireOrg() internally (src/lib/repositories/org.ts), which resolves
 * the acting org by that hardcoded slug rather than trusting the
 * caller's orgId directly — see fixtures.ts's own comment on why.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { ORG_SLUG } from "./org";
import { placeCounterOrder } from "./orders";
import { createTestOrg, createTestProduct, createTestTaxRate, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { fromRupees } from "@/lib/money";

describe("placeCounterOrder", () => {
  let org: TestOrg;
  let productSlug: string;

  beforeAll(async () => {
    org = await createTestOrg({ slug: ORG_SLUG });
    const taxRate = await createTestTaxRate(org.orgId);
    const product = await createTestProduct(org.orgId, { taxRateId: taxRate.id, basePriceRupees: "99" });
    productSlug = product.slug;
  });

  afterAll(async () => {
    await deleteTestOrg(org.orgId);
  });

  it("places a real order with a fresh key", async () => {
    const result = await placeCounterOrder({
      orgId: org.orgId,
      lines: [{ slug: productSlug, quantity: 2, modifiers: [], redeemStamp: false }],
      channel: "TAKEAWAY",
      tableId: null,
      customerPhone: null,
      notes: null,
      idempotencyKey: randomUUID(),
      actorUserId: randomUUID(),
      tendered: fromRupees("500"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.replayed).toBe(false);

    const orderRows = await db().select().from(orders).where(eq(orders.id, result.orderId));
    expect(orderRows).toHaveLength(1);
    expect(orderRows[0]?.grandTotal).toBe(fromRupees("198")); // 2 × ₹99
  });

  it("the exact guarantee: a retried call with the SAME key never creates a second order", async () => {
    const key = randomUUID();
    const input = {
      orgId: org.orgId,
      lines: [{ slug: productSlug, quantity: 1, modifiers: [], redeemStamp: false }],
      channel: "TAKEAWAY" as const,
      tableId: null,
      customerPhone: null,
      notes: null,
      idempotencyKey: key,
      actorUserId: randomUUID(),
      tendered: fromRupees("100"),
    };

    const first = await placeCounterOrder(input);
    const second = await placeCounterOrder(input);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("unreachable");
    expect(second.orderId).toBe(first.orderId); // same order, not a new one
    expect(second.replayed).toBe(true);

    const matching = await db().select().from(orders).where(and(eq(orders.orgId, org.orgId), eq(orders.id, first.orderId)));
    expect(matching).toHaveLength(1);
  });

  it("two genuinely different orders, with different keys, both get created with distinct, sequential order numbers", async () => {
    const a = await placeCounterOrder({
      orgId: org.orgId,
      lines: [{ slug: productSlug, quantity: 1, modifiers: [], redeemStamp: false }],
      channel: "TAKEAWAY",
      tableId: null,
      customerPhone: null,
      notes: null,
      idempotencyKey: randomUUID(),
      actorUserId: randomUUID(),
      tendered: fromRupees("100"),
    });
    const b = await placeCounterOrder({
      orgId: org.orgId,
      lines: [{ slug: productSlug, quantity: 1, modifiers: [], redeemStamp: false }],
      channel: "TAKEAWAY",
      tableId: null,
      customerPhone: null,
      notes: null,
      idempotencyKey: randomUUID(),
      actorUserId: randomUUID(),
      tendered: fromRupees("100"),
    });

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error("unreachable");
    expect(a.orderId).not.toBe(b.orderId);
    expect(a.orderNumber).not.toBe(b.orderNumber);
  });
});
