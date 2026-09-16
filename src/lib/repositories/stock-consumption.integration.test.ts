/**
 * recordConsumption / reverseConsumption against a real database —
 * specifically the Priority 4 fix (waste-vs-credit-back on a
 * cooked-then-cancelled order), which until now had only been verified by
 * reading code and by two independent specialist reviews, never by
 * actually running it.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { inventoryItems, inventoryMovements, wasteEntries } from "@/db/schema";
import { recordConsumption, reverseConsumption } from "./stock";
import { createTestIngredient, createTestOrg, createTestProduct, createTestRecipe, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

describe("recordConsumption / reverseConsumption", () => {
  let org: TestOrg;
  let productId: string;
  let ingredientId: string;
  const QUANTITY_PER_PORTION = 150; // grams

  beforeAll(async () => {
    org = await createTestOrg();
    const product = await createTestProduct(org.orgId);
    productId = product.id;
    const ingredient = await createTestIngredient(org.orgId, 40n); // 40 paise/gram
    ingredientId = ingredient.id;
    await createTestRecipe(org.orgId, productId, ingredientId, QUANTITY_PER_PORTION);
  });

  afterAll(async () => {
    await deleteTestOrg(org.orgId);
  });

  async function onHand(): Promise<number> {
    const [row] = await db()
      .select({ quantityOnHand: inventoryItems.quantityOnHand })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.orgId, org.orgId), eq(inventoryItems.ingredientId, ingredientId)));
    return row?.quantityOnHand ?? 0;
  }

  it("consumes the recipe's ingredients into a real SALE movement, decrementing on-hand", async () => {
    const orderId = randomUUID();
    const orderItemId = randomUUID();
    const before = await onHand();

    const result = await recordConsumption(org.orgId, null, { orderId, lines: [{ orderItemId, productId, quantity: 1 }] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.movementsWritten).toBe(1);

    expect(await onHand()).toBe(before - QUANTITY_PER_PORTION);

    const [sale] = await db()
      .select()
      .from(inventoryMovements)
      .where(and(eq(inventoryMovements.orgId, org.orgId), eq(inventoryMovements.orderId, orderId), eq(inventoryMovements.type, "SALE")));
    expect(sale).toBeDefined();
    expect(sale?.quantity).toBe(-QUANTITY_PER_PORTION);
    expect(sale?.totalCost).toBe(BigInt(QUANTITY_PER_PORTION * 40)); // 150g * 40 paise/g
  });

  it("is idempotent — a retried consumption call for the same order item never double-consumes", async () => {
    const orderId = randomUUID();
    const orderItemId = randomUUID();
    const before = await onHand();

    await recordConsumption(org.orgId, null, { orderId, lines: [{ orderItemId, productId, quantity: 1 }] });
    const afterFirst = await onHand();
    await recordConsumption(org.orgId, null, { orderId, lines: [{ orderItemId, productId, quantity: 1 }] });
    const afterSecond = await onHand();

    expect(afterFirst).toBe(before - QUANTITY_PER_PORTION);
    expect(afterSecond).toBe(afterFirst); // the retry wrote nothing more
  });

  it("Priority 4 — cancelling BEFORE cooking (wasCooking=false) credits the ingredients back via RETURN, restoring on-hand", async () => {
    const orderId = randomUUID();
    const orderItemId = randomUUID();
    const before = await onHand();

    await recordConsumption(org.orgId, null, { orderId, lines: [{ orderItemId, productId, quantity: 1 }] });
    expect(await onHand()).toBe(before - QUANTITY_PER_PORTION);

    const reversal = await reverseConsumption(org.orgId, null, orderId, "test: cancelled before cooking", false);
    expect(reversal.ok).toBe(true);
    if (!reversal.ok) throw new Error("unreachable");
    expect(reversal.movementsReversed).toBe(1);
    expect(reversal.movementsWasted).toBe(0);

    // On-hand genuinely restored — the ingredient goes back on the shelf.
    expect(await onHand()).toBe(before);

    const [ret] = await db()
      .select()
      .from(inventoryMovements)
      .where(and(eq(inventoryMovements.orgId, org.orgId), eq(inventoryMovements.orderId, orderId), eq(inventoryMovements.type, "RETURN")));
    expect(ret).toBeDefined();
    expect(ret?.quantity).toBe(QUANTITY_PER_PORTION);
  });

  it("Priority 4 — cancelling AFTER cooking (wasCooking=true) does NOT credit stock back, and records waste instead", async () => {
    const orderId = randomUUID();
    const orderItemId = randomUUID();
    const before = await onHand();

    await recordConsumption(org.orgId, null, { orderId, lines: [{ orderItemId, productId, quantity: 1 }] });
    const afterConsumption = await onHand();
    expect(afterConsumption).toBe(before - QUANTITY_PER_PORTION);

    const reversal = await reverseConsumption(org.orgId, null, orderId, "test: cancelled after PREPARING", true);
    expect(reversal.ok).toBe(true);
    if (!reversal.ok) throw new Error("unreachable");
    expect(reversal.movementsReversed).toBe(0);
    expect(reversal.movementsWasted).toBe(1);

    // The whole point of the fix: on-hand stays exactly where consumption
    // left it — the food was cooked, it does not un-cook itself.
    expect(await onHand()).toBe(afterConsumption);
    expect(await onHand()).not.toBe(before);

    // No RETURN movement was written for this order.
    const returns = await db()
      .select()
      .from(inventoryMovements)
      .where(and(eq(inventoryMovements.orgId, org.orgId), eq(inventoryMovements.orderId, orderId), eq(inventoryMovements.type, "RETURN")));
    expect(returns).toHaveLength(0);

    // A waste_entries row exists, linked to the SALE, with the CANCELLED_ORDER reason.
    const [waste] = await db()
      .select()
      .from(wasteEntries)
      .where(and(eq(wasteEntries.orgId, org.orgId), eq(wasteEntries.orderId, orderId)));
    expect(waste).toBeDefined();
    expect(waste?.reason).toBe("CANCELLED_ORDER");
    expect(waste?.quantity).toBe(QUANTITY_PER_PORTION);
    expect(waste?.cost).toBe(BigInt(QUANTITY_PER_PORTION * 40));

    // And no SECOND inventoryMovements row exists for this order beyond the
    // original SALE — the fix's whole point is not double-writing a
    // cost-bearing movement.
    const allMovements = await db()
      .select()
      .from(inventoryMovements)
      .where(and(eq(inventoryMovements.orgId, org.orgId), eq(inventoryMovements.orderId, orderId)));
    expect(allMovements).toHaveLength(1);
    expect(allMovements[0]?.type).toBe("SALE");
  });

  it("waste-path reversal is idempotent too — a retry never double-records the waste entry", async () => {
    const orderId = randomUUID();
    const orderItemId = randomUUID();

    await recordConsumption(org.orgId, null, { orderId, lines: [{ orderItemId, productId, quantity: 1 }] });
    const afterConsumption = await onHand();

    await reverseConsumption(org.orgId, null, orderId, "first cancel attempt", true);
    await reverseConsumption(org.orgId, null, orderId, "retried cancel attempt", true);

    expect(await onHand()).toBe(afterConsumption); // unchanged by either call

    const wasteRows = await db().select().from(wasteEntries).where(and(eq(wasteEntries.orgId, org.orgId), eq(wasteEntries.orderId, orderId)));
    expect(wasteRows).toHaveLength(1);
  });
});
