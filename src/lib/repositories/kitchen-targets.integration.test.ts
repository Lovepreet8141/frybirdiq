/**
 * Prep targets against a real database (roadmap 4.1): max over lines, no
 * invented default, and never another organization's product.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orderItems, orders, products } from "@/db/schema";
import { fromRupees } from "@/lib/money";
import { createTestOrg, createTestProduct, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { getPrepTargets } from "./kitchen-targets";

let org: TestOrg;
let other: TestOrg;

beforeAll(async () => {
  org = await createTestOrg();
  other = await createTestOrg();
});
afterAll(async () => {
  await deleteTestOrg(org.orgId);
  await deleteTestOrg(other.orgId);
});

async function order(owner: TestOrg, lines: readonly (string | null)[]): Promise<string> {
  const [row] = await db()
    .insert(orders)
    .values({ orgId: owner.orgId, locationId: owner.locationId, orderNumber: `K-${randomUUID().slice(0, 6)}`, businessDate: "2026-09-21", status: "ACCEPTED", channel: "ONLINE", fulfilment: "TAKEAWAY", grandTotal: fromRupees("100") })
    .returning({ id: orders.id });
  for (const productId of lines) {
    await db().insert(orderItems).values({ orgId: owner.orgId, orderId: row!.id, productId, productName: "Snap", quantity: 1, unitPrice: fromRupees("100"), lineSubtotal: fromRupees("100"), lineTotal: fromRupees("100") });
  }
  return row!.id;
}

const withPrep = async (owner: TestOrg, minutes: number | null) => {
  const product = await createTestProduct(owner.orgId);
  await db().update(products).set({ prepMinutes: minutes }).where(eq(products.id, product.id));
  return product.id;
};

describe("getPrepTargets", () => {
  it("is the max prep_minutes over the order's lines", async () => {
    const [a, b] = [await withPrep(org, 6), await withPrep(org, 12)];
    const id = await order(org, [a!, b!]);
    expect((await getPrepTargets(org.orgId, [id])).get(id)).toBe(12);
  });

  it("has no target when no line has one — no default is invented", async () => {
    const unset = await withPrep(org, null);
    const id = await order(org, [unset, null]);
    expect((await getPrepTargets(org.orgId, [id])).get(id) ?? null).toBeNull();
  });

  it("ignores lines with no target but uses the ones that do", async () => {
    const [unset, set] = [await withPrep(org, null), await withPrep(org, 9)];
    const id = await order(org, [unset, set]);
    expect((await getPrepTargets(org.orgId, [id])).get(id)).toBe(9);
  });

  it("never reads another organization's product or order", async () => {
    const theirs = await withPrep(other, 99);
    const theirOrder = await order(other, [theirs]);
    // asked as the wrong org: the order's lines are not ours
    expect((await getPrepTargets(org.orgId, [theirOrder])).size).toBe(0);
    // a line in our order pointing at their product must not pick up their value
    const mine = await order(org, [theirs]);
    expect((await getPrepTargets(org.orgId, [mine])).get(mine) ?? null).toBeNull();
  });

  it("returns an empty map for no orders", async () => {
    expect((await getPrepTargets(org.orgId, [])).size).toBe(0);
  });
});
