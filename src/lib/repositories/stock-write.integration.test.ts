/**
 * receiveStock / adjustStock against a real database — the Priority 6 fix.
 * Verifies the actual, end-to-end behaviour a code review alone can't:
 * a retried call with the same key writes once; two genuinely different
 * calls in a row (the exact workflow a manager uses, and the exact
 * scenario an earlier draft of this fix got wrong — see
 * src/components/inventory/stock-forms.tsx's own history) both land.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { inventoryItems, inventoryMovements } from "@/db/schema";
import { IdempotencyConflict } from "./idempotency";
import { adjustStock, receiveStock } from "./stock";
import { createTestIngredient, createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { fromRupees } from "@/lib/money";

describe("receiveStock", () => {
  let org: TestOrg;
  let ingredientId: string;

  beforeAll(async () => {
    org = await createTestOrg();
    ingredientId = (await createTestIngredient(org.orgId)).id;
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

  it("records a delivery, incrementing on-hand", async () => {
    const before = await onHand();
    const result = await receiveStock(org.orgId, randomUUID(), { ingredientId, purchaseQuantity: 10, purchaseUnit: "KG", purchaseCost: fromRupees("2800"), supplierId: null, notes: null }, randomUUID());
    expect(result.ok).toBe(true);
    expect(await onHand()).toBe(before + 10_000); // 10 kg in grams (base unit)
  });

  it("a retried call with the SAME key writes the delivery exactly once", async () => {
    const before = await onHand();
    const key = randomUUID();
    const input = { ingredientId, purchaseQuantity: 5, purchaseUnit: "KG" as const, purchaseCost: fromRupees("1400"), supplierId: null, notes: "retry test" };

    const first = await receiveStock(org.orgId, randomUUID(), input, key);
    const second = await receiveStock(org.orgId, randomUUID(), input, key);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    // Only ONE 5kg delivery actually landed, not two.
    expect(await onHand()).toBe(before + 5_000);
  });

  it("Priority 6's actual bug: two genuinely different deliveries in a row, with DIFFERENT keys, both land — this is the exact workflow the fix exists for", async () => {
    const before = await onHand();

    const first = await receiveStock(org.orgId, randomUUID(), { ingredientId, purchaseQuantity: 3, purchaseUnit: "KG", purchaseCost: fromRupees("900"), supplierId: null, notes: "delivery A" }, randomUUID());
    const second = await receiveStock(org.orgId, randomUUID(), { ingredientId, purchaseQuantity: 7, purchaseUnit: "KG", purchaseCost: fromRupees("2000"), supplierId: null, notes: "delivery B" }, randomUUID());

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    // Both landed — 3kg + 7kg, not one silently swallowed as a false "repeat".
    expect(await onHand()).toBe(before + 10_000);
  });

  it("the same key reused for genuinely different content is refused as a conflict, not silently misapplied", async () => {
    const key = randomUUID();
    await receiveStock(org.orgId, randomUUID(), { ingredientId, purchaseQuantity: 1, purchaseUnit: "KG", purchaseCost: fromRupees("280"), supplierId: null, notes: "first" }, key);

    await expect(
      receiveStock(org.orgId, randomUUID(), { ingredientId, purchaseQuantity: 99, purchaseUnit: "KG", purchaseCost: fromRupees("27720"), supplierId: null, notes: "different delivery, same key" }, key),
    ).rejects.toThrow(IdempotencyConflict);
  });

  it("writes a real PURCHASE movement with the correct raw rate", async () => {
    const key = randomUUID();
    await receiveStock(org.orgId, randomUUID(), { ingredientId, purchaseQuantity: 2, purchaseUnit: "KG", purchaseCost: fromRupees("560"), supplierId: null, notes: null }, key);

    const [movement] = await db()
      .select()
      .from(inventoryMovements)
      .where(and(eq(inventoryMovements.orgId, org.orgId), eq(inventoryMovements.ingredientId, ingredientId), eq(inventoryMovements.type, "PURCHASE")))
      .orderBy(inventoryMovements.createdAt)
      .limit(1);
    expect(movement).toBeDefined();
    // ₹560 for 2kg (2000g) = 28 paise/gram.
    expect(movement?.costPerBaseUnit).toBe(28n);
  });
});

describe("adjustStock", () => {
  let org: TestOrg;
  let ingredientId: string;

  beforeAll(async () => {
    org = await createTestOrg();
    ingredientId = (await createTestIngredient(org.orgId)).id;
    await receiveStock(org.orgId, randomUUID(), { ingredientId, purchaseQuantity: 20, purchaseUnit: "KG", purchaseCost: fromRupees("5600"), supplierId: null, notes: null }, randomUUID());
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

  it("a retried correction with the SAME key applies exactly once", async () => {
    const before = await onHand();
    const key = randomUUID();
    const input = { ingredientId, direction: "REMOVE" as const, quantity: "0.5", unit: "KG" as const, notes: "found spoiled stock" };

    await adjustStock(org.orgId, randomUUID(), input, key);
    await adjustStock(org.orgId, randomUUID(), input, key);

    expect(await onHand()).toBe(before - 500); // -500g, once, not -1000g
  });

  it("two genuinely different corrections in a row both apply", async () => {
    const before = await onHand();

    await adjustStock(org.orgId, randomUUID(), { ingredientId, direction: "ADD", quantity: "1", unit: "KG", notes: "found an uncounted case" }, randomUUID());
    await adjustStock(org.orgId, randomUUID(), { ingredientId, direction: "REMOVE", quantity: "0.3", unit: "KG", notes: "spillage" }, randomUUID());

    expect(await onHand()).toBe(before + 1000 - 300);
  });
});
