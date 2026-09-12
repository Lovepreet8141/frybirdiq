import "server-only";

/**
 * Inventory master data — suppliers, ingredients, and the price record that
 * is the only way an ingredient's cost changes.
 *
 * docs/INVENTORY-ARCHITECTURE.md §4, write paths 1–3. Every write runs in
 * one transaction and leaves an `audit_logs` row with before/after. Stock
 * itself (movements, purchases, waste, consumption) is not in this file —
 * those are later slices with their own review.
 */

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, ingredientPrices, ingredients, inventoryItems, recipeVersionItems, suppliers } from "@/db/schema";
import type { Unit } from "@/db/schema/inventory";
import { type MilliPaise, rateToPaise, usableCostPerBaseUnit } from "@/lib/iq/costing";
import { type BaseUnit, conversionFor, isBaseUnit, toBaseUnits } from "@/lib/iq/units";
import { type Bps, type Paise, paise } from "@/lib/money";

/* ------------------------------------------------------------------ */
/* Suppliers                                                           */
/* ------------------------------------------------------------------ */

export interface SupplierRow {
  readonly id: string;
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly gstin: string | null;
  readonly address: string | null;
  readonly isActive: boolean;
  readonly ingredientCount: number;
}

export interface SupplierInput {
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly gstin: string | null;
  readonly address: string | null;
  readonly isActive: boolean;
}

export async function listSuppliers(orgId: string): Promise<readonly SupplierRow[]> {
  const rows = await db()
    .select({
      id: suppliers.id,
      name: suppliers.name,
      phone: suppliers.phone,
      email: suppliers.email,
      gstin: suppliers.gstin,
      address: suppliers.address,
      isActive: suppliers.isActive,
      ingredientCount: sql<number>`(select count(*)::int from ${ingredients} i where i.supplier_id = ${suppliers.id})`,
    })
    .from(suppliers)
    .where(eq(suppliers.orgId, orgId))
    .orderBy(asc(suppliers.name));
  return rows;
}

export async function createSupplier(orgId: string, actorUserId: string, input: SupplierInput): Promise<{ id: string }> {
  return db().transaction(async (tx) => {
    const [row] = await tx.insert(suppliers).values({ orgId, ...input }).returning({ id: suppliers.id });
    if (!row) throw new Error("supplier: insert returned no row");
    await tx.insert(auditLogs).values({ orgId, actorUserId, action: "supplier_created", entity: "suppliers", entityId: row.id, after: { ...input } });
    return row;
  });
}

export async function updateSupplier(orgId: string, actorUserId: string, id: string, input: SupplierInput): Promise<boolean> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(suppliers).where(and(eq(suppliers.orgId, orgId), eq(suppliers.id, id))).limit(1);
    if (!before) return false;
    await tx.update(suppliers).set({ ...input, updatedAt: new Date() }).where(eq(suppliers.id, id));
    await tx.insert(auditLogs).values({
      orgId,
      actorUserId,
      action: "supplier_updated",
      entity: "suppliers",
      entityId: id,
      before: { name: before.name, phone: before.phone, email: before.email, gstin: before.gstin, address: before.address, isActive: before.isActive },
      after: { ...input },
    });
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Ingredients                                                         */
/* ------------------------------------------------------------------ */

export interface IngredientRow {
  readonly id: string;
  readonly name: string;
  readonly sku: string | null;
  readonly baseUnit: BaseUnit;
  /** Usable cost of one base unit, rounded to paise for display. Zero until a price is recorded. */
  readonly costPerBaseUnit: Paise;
  readonly yieldBps: number;
  readonly wasteBps: number;
  readonly isPackaging: boolean;
  readonly isActive: boolean;
  readonly supplierId: string | null;
  readonly supplierName: string | null;
  readonly lastPricedAt: Date | null;
  /** Across all locations, in base units. A cache of movements; zero until stock exists. */
  readonly onHand: number;
}

export interface IngredientInput {
  readonly name: string;
  readonly sku: string | null;
  readonly baseUnit: BaseUnit;
  readonly yieldBps: Bps;
  readonly wasteBps: Bps;
  readonly supplierId: string | null;
  readonly isPackaging: boolean;
  readonly isActive: boolean;
}

export async function listIngredients(orgId: string): Promise<readonly IngredientRow[]> {
  const rows = await db()
    .select({
      id: ingredients.id,
      name: ingredients.name,
      sku: ingredients.sku,
      baseUnit: ingredients.baseUnit,
      costPerBaseUnit: ingredients.costPerBaseUnit,
      yieldBps: ingredients.yieldBps,
      wasteBps: ingredients.wasteBps,
      isPackaging: ingredients.isPackaging,
      isActive: ingredients.isActive,
      supplierId: ingredients.supplierId,
      supplierName: suppliers.name,
      lastPricedAt: sql<Date | null>`(select max(p.effective_from) from ${ingredientPrices} p where p.ingredient_id = ${ingredients.id})`,
      onHand: sql<number>`coalesce((select sum(s.quantity_on_hand)::int from ${inventoryItems} s where s.ingredient_id = ${ingredients.id}), 0)`,
    })
    .from(ingredients)
    .leftJoin(suppliers, eq(suppliers.id, ingredients.supplierId))
    .where(eq(ingredients.orgId, orgId))
    .orderBy(asc(ingredients.name));

  return rows.map((row) => ({
    ...row,
    // Only G, ML and PIECE are ever written (validated at the boundary); the column type is the wider enum.
    baseUnit: row.baseUnit as BaseUnit,
    costPerBaseUnit: paise(row.costPerBaseUnit),
    lastPricedAt: row.lastPricedAt ? new Date(row.lastPricedAt) : null,
  }));
}

export interface IngredientDetail extends IngredientRow {
  readonly costPerBaseUnitMilli: MilliPaise;
  readonly prices: readonly {
    id: string;
    purchaseQuantity: number;
    purchaseUnit: Unit;
    purchaseCost: Paise;
    costPerBaseUnit: Paise;
    supplierName: string | null;
    effectiveFrom: Date;
  }[];
  /** How many recipe versions use it — a base-unit change is refused once this is non-zero. */
  readonly recipeLineCount: number;
}

export async function getIngredient(orgId: string, id: string): Promise<IngredientDetail | null> {
  const [row] = (await listIngredients(orgId)).filter((ingredient) => ingredient.id === id);
  if (!row) return null;

  const [[milli], prices, [lines]] = await Promise.all([
    db().select({ milli: ingredients.costPerBaseUnitMilli }).from(ingredients).where(eq(ingredients.id, id)).limit(1),
    db()
      .select({
        id: ingredientPrices.id,
        purchaseQuantity: ingredientPrices.purchaseQuantity,
        purchaseUnit: ingredientPrices.purchaseUnit,
        purchaseCost: ingredientPrices.purchaseCost,
        costPerBaseUnit: ingredientPrices.costPerBaseUnit,
        supplierName: suppliers.name,
        effectiveFrom: ingredientPrices.effectiveFrom,
      })
      .from(ingredientPrices)
      .leftJoin(suppliers, eq(suppliers.id, ingredientPrices.supplierId))
      .where(and(eq(ingredientPrices.orgId, orgId), eq(ingredientPrices.ingredientId, id)))
      .orderBy(desc(ingredientPrices.effectiveFrom))
      .limit(20),
    db().select({ n: sql<number>`count(*)::int` }).from(recipeVersionItems).where(eq(recipeVersionItems.ingredientId, id)),
  ]);

  return {
    ...row,
    costPerBaseUnitMilli: (milli?.milli ?? 0n) as MilliPaise,
    prices: prices.map((price) => ({ ...price, purchaseCost: paise(price.purchaseCost), costPerBaseUnit: paise(price.costPerBaseUnit) })),
    recipeLineCount: lines?.n ?? 0,
  };
}

export async function createIngredient(orgId: string, actorUserId: string, input: IngredientInput): Promise<{ id: string }> {
  return db().transaction(async (tx) => {
    const [row] = await tx.insert(ingredients).values({ orgId, ...input }).returning({ id: ingredients.id });
    if (!row) throw new Error("ingredient: insert returned no row");
    await tx.insert(auditLogs).values({ orgId, actorUserId, action: "ingredient_created", entity: "ingredients", entityId: row.id, after: { ...input } });
    return row;
  });
}

export type UpdateIngredientResult = { ok: true } | { ok: false; error: string };

export async function updateIngredient(orgId: string, actorUserId: string, id: string, input: IngredientInput): Promise<UpdateIngredientResult> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(ingredients).where(and(eq(ingredients.orgId, orgId), eq(ingredients.id, id))).limit(1);
    if (!before) return { ok: false, error: "That ingredient no longer exists." };

    // A base unit is the meaning of every stored quantity and rate for this
    // ingredient. Once a price or a recipe line exists in it, changing it
    // would silently re-read "150" as millilitres instead of grams.
    if (before.baseUnit !== input.baseUnit) {
      const [[priced], [used]] = await Promise.all([
        tx.select({ n: sql<number>`count(*)::int` }).from(ingredientPrices).where(eq(ingredientPrices.ingredientId, id)),
        tx.select({ n: sql<number>`count(*)::int` }).from(recipeVersionItems).where(eq(recipeVersionItems.ingredientId, id)),
      ]);
      if ((priced?.n ?? 0) > 0 || (used?.n ?? 0) > 0) {
        return { ok: false, error: "The base unit can't change once a price or a recipe uses this ingredient. Create a new ingredient instead." };
      }
    }

    await tx.update(ingredients).set({ ...input, updatedAt: new Date() }).where(eq(ingredients.id, id));
    await tx.insert(auditLogs).values({
      orgId,
      actorUserId,
      action: "ingredient_updated",
      entity: "ingredients",
      entityId: id,
      before: {
        name: before.name,
        sku: before.sku,
        baseUnit: before.baseUnit,
        yieldBps: before.yieldBps,
        wasteBps: before.wasteBps,
        supplierId: before.supplierId,
        isPackaging: before.isPackaging,
        isActive: before.isActive,
      },
      after: { ...input },
    });
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* Prices                                                              */
/* ------------------------------------------------------------------ */

export interface PriceInput {
  readonly ingredientId: string;
  /** As purchased: "10 kg for ₹2,800" is quantity 10, unit KG, cost 280000 paise. */
  readonly purchaseQuantity: number;
  readonly purchaseUnit: Unit;
  readonly purchaseCost: Paise;
  readonly supplierId: string | null;
}

export type RecordPriceResult = { ok: true; rate: Paise } | { ok: false; error: string };

/**
 * The one way an ingredient's cost changes. Appends to the price series and
 * moves the ingredient's rate to the new usable cost — purchase cost over
 * what actually survives yield and waste (`usableCostPerBaseUnit`).
 */
export async function recordIngredientPrice(orgId: string, actorUserId: string, input: PriceInput): Promise<RecordPriceResult> {
  return db().transaction(async (tx) => {
    const [ingredient] = await tx.select().from(ingredients).where(and(eq(ingredients.orgId, orgId), eq(ingredients.id, input.ingredientId))).limit(1);
    if (!ingredient) return { ok: false, error: "That ingredient no longer exists." };

    let purchaseQuantityBase: number;
    try {
      const conversion = conversionFor(input.purchaseUnit);
      if (conversion.baseUnit !== ingredient.baseUnit) {
        return { ok: false, error: `This ingredient is measured in ${ingredient.baseUnit.toLowerCase()}; a purchase in ${input.purchaseUnit.toLowerCase()} can't be converted to it.` };
      }
      purchaseQuantityBase = toBaseUnits(input.purchaseQuantity, input.purchaseUnit);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "That quantity can't be converted." };
    }

    let rate: MilliPaise;
    try {
      rate = usableCostPerBaseUnit({
        purchaseCost: input.purchaseCost,
        purchaseQuantityBase,
        yieldBps: ingredient.yieldBps as Bps,
        wasteBps: ingredient.wasteBps as Bps,
      });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "That price can't be costed." };
    }
    const ratePaise = rateToPaise(rate);

    if (input.supplierId) {
      const [supplier] = await tx.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.orgId, orgId), eq(suppliers.id, input.supplierId))).limit(1);
      if (!supplier) return { ok: false, error: "That supplier no longer exists." };
    }

    await tx.insert(ingredientPrices).values({
      orgId,
      ingredientId: ingredient.id,
      purchaseQuantity: input.purchaseQuantity,
      purchaseUnit: input.purchaseUnit,
      purchaseCost: input.purchaseCost,
      costPerBaseUnit: ratePaise,
      costPerBaseUnitMilli: rate,
      supplierId: input.supplierId,
    });
    await tx
      .update(ingredients)
      .set({ costPerBaseUnit: ratePaise, costPerBaseUnitMilli: rate, updatedAt: new Date() })
      .where(eq(ingredients.id, ingredient.id));
    await tx.insert(auditLogs).values({
      orgId,
      actorUserId,
      action: "ingredient_price_recorded",
      entity: "ingredients",
      entityId: ingredient.id,
      before: { costPerBaseUnitMilli: ingredient.costPerBaseUnitMilli.toString() },
      after: {
        costPerBaseUnitMilli: rate.toString(),
        purchaseQuantity: input.purchaseQuantity,
        purchaseUnit: input.purchaseUnit,
        purchaseCost: input.purchaseCost.toString(),
        supplierId: input.supplierId,
      },
    });
    return { ok: true, rate: ratePaise };
  });
}

/** Base units an ingredient may be measured in — the only three `units.ts` can convert to. */
export const BASE_UNITS: readonly BaseUnit[] = ["G", "ML", "PIECE"];

export function isKnownBaseUnit(value: string): value is BaseUnit {
  return isBaseUnit(value as Unit);
}
