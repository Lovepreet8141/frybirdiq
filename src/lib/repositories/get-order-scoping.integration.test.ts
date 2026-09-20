/**
 * The public order page's read (`getOrder`) is bound to this app's own
 * organization and reads only THIS order's modifiers.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { orderItemModifiers, orderItems, orders } from "@/db/schema";
import { fromRupees } from "@/lib/money";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { ORG_SLUG } from "./org";

vi.mock("@/lib/env", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/env")>()), isSupabaseConfigured: () => true }));

import { getOrder } from "./orders";

let mine: TestOrg;
let stranger: TestOrg;

async function orderWithItem(owner: TestOrg, modifierName: string): Promise<string> {
  const [order] = await db()
    .insert(orders)
    .values({ orgId: owner.orgId, locationId: owner.locationId, orderNumber: `G-${randomUUID().slice(0, 6)}`, businessDate: "2026-09-20", status: "PAID", channel: "ONLINE", fulfilment: "TAKEAWAY", grandTotal: fromRupees("100") })
    .returning({ id: orders.id });
  const [item] = await db()
    .insert(orderItems)
    .values({ orgId: owner.orgId, orderId: order!.id, productName: "Burger", quantity: 1, unitPrice: fromRupees("100"), lineSubtotal: fromRupees("100"), lineTotal: fromRupees("100") })
    .returning({ id: orderItems.id });
  await db().insert(orderItemModifiers).values({ orgId: owner.orgId, orderItemId: item!.id, groupName: "Size", modifierName });
  return order!.id;
}

beforeAll(async () => {
  mine = await createTestOrg({ slug: ORG_SLUG });
  stranger = await createTestOrg();
});
afterAll(async () => {
  await deleteTestOrg(mine.orgId);
  await deleteTestOrg(stranger.orgId);
});

describe("getOrder", () => {
  it("returns this shop's order with only its own modifiers", async () => {
    const a = await orderWithItem(mine, "Large");
    await orderWithItem(mine, "Extra sauce"); // another order's modifier in the same org
    const view = await getOrder(a);
    expect(view?.items.map((i) => i.modifiers)).toEqual([["Large"]]);
  });

  it("another organization's order id answers exactly like an unknown one", async () => {
    const theirs = await orderWithItem(stranger, "Secret");
    expect(await getOrder(theirs)).toBeNull();
    expect(await getOrder(randomUUID())).toBeNull();
  });
});
