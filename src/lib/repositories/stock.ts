import "server-only";

/**
 * Stock movements — receive, adjust, count. Roadmap 3.2.
 *
 * docs/INVENTORY-ARCHITECTURE.md §4, write paths 6 and 8. `inventory_items`
 * is a cache of `inventory_movements`: "a running total of movements, never
 * set directly" (the schema's own words). Every function here writes both
 * in one transaction, so the cache and the ledger can never diverge —
 * `applyMovementDelta` below does the increment as a single atomic SQL
 * statement rather than a read-then-write, for the same reason the loyalty
 * ledger (`payments.ts`) does.
 *
 * Deliberately a separate file from `inventory.ts` — that file's own header
 * comment says stock movements are "later slices with their own review."
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, ingredients, inventoryItems, inventoryMovements, memberships } from "@/db/schema";
import { movementTypeEnum, type Unit } from "@/db/schema/inventory";
import { getStoreLocationId } from "@/lib/repositories/hardware";
import { type DbTx, recordIngredientPriceInTx } from "@/lib/repositories/inventory";
import { costFromRate, type MilliPaise, purchaseRatePerBaseUnit, rateToPaise } from "@/lib/iq/costing";
import { conversionFor, toBaseUnits, toBaseUnitsDecimal, unitLabel } from "@/lib/iq/units";
import { paise, type Paise } from "@/lib/money";

/** No separate type export exists on the schema for this — derived here rather than added there, since the task is additive-only against `db/schema/inventory.ts`. */
export type MovementType = (typeof movementTypeEnum.enumValues)[number];

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export interface MovementRow {
  readonly id: string;
  readonly type: MovementType;
  /** Signed, in the ingredient's base unit. */
  readonly quantityBase: number;
  readonly costPerBaseUnit: Paise;
  readonly totalCost: Paise;
  readonly notes: string | null;
  readonly actorName: string | null;
  readonly occurredAt: Date;
}

/** The most recent movements for one ingredient, newest first. */
export async function listMovements(orgId: string, ingredientId: string, limit = 50): Promise<readonly MovementRow[]> {
  const rows = await db()
    .select({
      id: inventoryMovements.id,
      type: inventoryMovements.type,
      quantity: inventoryMovements.quantity,
      costPerBaseUnit: inventoryMovements.costPerBaseUnit,
      totalCost: inventoryMovements.totalCost,
      notes: inventoryMovements.notes,
      actorUserId: inventoryMovements.actorUserId,
      occurredAt: inventoryMovements.occurredAt,
    })
    .from(inventoryMovements)
    .where(and(eq(inventoryMovements.orgId, orgId), eq(inventoryMovements.ingredientId, ingredientId)))
    .orderBy(desc(inventoryMovements.occurredAt))
    .limit(limit);

  const actorIds = [...new Set(rows.map((row) => row.actorUserId).filter((id): id is string => id !== null))];
  const staffRows =
    actorIds.length > 0
      ? await db()
          .select({ userId: memberships.userId, displayName: memberships.displayName })
          .from(memberships)
          .where(and(eq(memberships.orgId, orgId), inArray(memberships.userId, actorIds)))
      : [];
  const nameByUser = new Map(staffRows.map((row) => [row.userId, row.displayName]));

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    quantityBase: row.quantity,
    costPerBaseUnit: paise(row.costPerBaseUnit),
    totalCost: paise(row.totalCost),
    notes: row.notes,
    // Null actor is a system-initiated event, not a missing fact — same convention as audit.ts.
    actorName: row.actorUserId ? (nameByUser.get(row.actorUserId) ?? "Former staff member") : "System",
    occurredAt: row.occurredAt,
  }));
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

export type StockWriteResult = { ok: true; onHand: number; delta: number } | { ok: false; error: string };

/**
 * `inventory_items.quantity_on_hand += delta`, as one atomic upsert rather
 * than a read then a conditional insert/update — so two movements landing
 * at the same instant can never lose one of them to a race. Mirrors the
 * loyalty-points upsert in `payments.ts` ("every movement is recorded,
 * never a bare balance update — the same principle as inventory").
 */
async function applyMovementDelta(tx: DbTx, orgId: string, ingredientId: string, locationId: string, delta: number): Promise<number> {
  const [row] = await tx
    .insert(inventoryItems)
    .values({ orgId, ingredientId, locationId, quantityOnHand: delta })
    .onConflictDoUpdate({
      target: [inventoryItems.ingredientId, inventoryItems.locationId],
      set: { quantityOnHand: sql`${inventoryItems.quantityOnHand} + ${delta}`, updatedAt: new Date() },
    })
    .returning({ quantityOnHand: inventoryItems.quantityOnHand });
  if (!row) throw new Error("stock: inventory_items upsert returned no row");
  return row.quantityOnHand;
}

async function loadIngredientForWrite(tx: DbTx, orgId: string, ingredientId: string) {
  const [ingredient] = await tx.select().from(ingredients).where(and(eq(ingredients.orgId, orgId), eq(ingredients.id, ingredientId))).limit(1);
  return ingredient ?? null;
}

function unitMismatchError(ingredientBaseUnit: Unit, requestedUnit: Unit): string {
  return `This ingredient is measured in ${unitLabel(ingredientBaseUnit)}; a quantity in ${unitLabel(requestedUnit)} can't be converted to it.`;
}

export interface ReceiveStockInput {
  readonly ingredientId: string;
  /** As delivered: "10 kg for ₹2,800" is quantity 10, unit KG. Whole units only — same convention as recording a price (§ toBaseUnits). */
  readonly purchaseQuantity: number;
  readonly purchaseUnit: Unit;
  readonly purchaseCost: Paise;
  readonly supplierId: string | null;
  readonly notes: string | null;
}

/**
 * Receiving stock. Records the supplier price the same way `recordIngredientPrice`
 * always has (§ same transaction, via `recordIngredientPriceInTx`) and adds a
 * PURCHASE movement for the quantity received — one write, so a movement can
 * never exist without the price that justified it, or vice versa.
 *
 * Valued at the *raw* purchase rate (`purchaseCost ÷ quantity`, before yield
 * and waste) rather than the ingredient's usable rate: this movement records
 * what was actually paid for what actually arrived, matching
 * docs/INVENTORY-ARCHITECTURE.md's worked reconciliation (§12a) — the usable
 * rate is a recipe-costing concern, not a receiving one.
 */
export async function receiveStock(orgId: string, actorUserId: string, input: ReceiveStockInput): Promise<StockWriteResult> {
  const locationId = await getStoreLocationId(orgId);
  if (!locationId) return { ok: false, error: "No location is set up for this organization yet." };

  return db().transaction(async (tx) => {
    const priceResult = await recordIngredientPriceInTx(tx, orgId, actorUserId, {
      ingredientId: input.ingredientId,
      purchaseQuantity: input.purchaseQuantity,
      purchaseUnit: input.purchaseUnit,
      purchaseCost: input.purchaseCost,
      supplierId: input.supplierId,
    });
    if (!priceResult.ok) return priceResult;

    // Already proven convertible by recordIngredientPriceInTx above.
    const quantityBase = toBaseUnits(input.purchaseQuantity, input.purchaseUnit);
    const rawRate = purchaseRatePerBaseUnit(input.purchaseCost, quantityBase);
    const costPerBaseUnit = rateToPaise(rawRate);

    const [movement] = await tx
      .insert(inventoryMovements)
      .values({
        orgId,
        ingredientId: input.ingredientId,
        locationId,
        type: "PURCHASE",
        quantity: quantityBase,
        costPerBaseUnit,
        totalCost: input.purchaseCost,
        actorUserId,
        notes: input.notes,
      })
      .returning({ id: inventoryMovements.id });
    if (!movement) throw new Error("stock: purchase movement insert returned no row");

    const onHand = await applyMovementDelta(tx, orgId, input.ingredientId, locationId, quantityBase);

    await tx.insert(auditLogs).values({
      orgId,
      actorUserId,
      action: "stock_received",
      entity: "inventory_movements",
      entityId: movement.id,
      after: {
        ingredientId: input.ingredientId,
        quantityBase,
        purchaseQuantity: input.purchaseQuantity,
        purchaseUnit: input.purchaseUnit,
        purchaseCost: input.purchaseCost.toString(),
        supplierId: input.supplierId,
        onHand,
      },
    });

    return { ok: true, onHand, delta: quantityBase };
  });
}

export interface AdjustStockInput {
  readonly ingredientId: string;
  readonly direction: "ADD" | "REMOVE";
  /** A positive decimal, in `unit` — a kitchen scale reading, so fractional is normal. */
  readonly quantity: string;
  readonly unit: Unit;
  /** Required — an adjustment with no reason is not auditable. */
  readonly notes: string;
}

/**
 * A manual correction: found stock nobody logged, or stock that is
 * genuinely gone with no purchase, waste or sale movement to explain it.
 * Signed by `direction`; the note is mandatory (docs/INVENTORY-ARCHITECTURE.md
 * D5 / write path 8).
 */
export async function adjustStock(orgId: string, actorUserId: string, input: AdjustStockInput): Promise<StockWriteResult> {
  const locationId = await getStoreLocationId(orgId);
  if (!locationId) return { ok: false, error: "No location is set up for this organization yet." };

  return db().transaction(async (tx) => {
    const ingredient = await loadIngredientForWrite(tx, orgId, input.ingredientId);
    if (!ingredient) return { ok: false, error: "That ingredient no longer exists." };

    let magnitude: number;
    try {
      const conversion = conversionFor(input.unit);
      if (conversion.baseUnit !== ingredient.baseUnit) {
        return { ok: false, error: unitMismatchError(ingredient.baseUnit, input.unit) };
      }
      magnitude = toBaseUnitsDecimal(input.quantity, input.unit);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "That quantity can't be converted." };
    }
    if (magnitude <= 0) return { ok: false, error: "Enter a quantity greater than zero." };

    const delta = input.direction === "REMOVE" ? -magnitude : magnitude;
    const rate = ingredient.costPerBaseUnitMilli as MilliPaise;
    const costPerBaseUnit = rateToPaise(rate);
    // costFromRate(0, …) is already zero when nothing has ever been priced.
    const totalCost = costFromRate(rate, magnitude);

    const [movement] = await tx
      .insert(inventoryMovements)
      .values({
        orgId,
        ingredientId: input.ingredientId,
        locationId,
        type: "ADJUSTMENT",
        quantity: delta,
        costPerBaseUnit,
        totalCost,
        actorUserId,
        notes: input.notes,
      })
      .returning({ id: inventoryMovements.id });
    if (!movement) throw new Error("stock: adjustment movement insert returned no row");

    const onHand = await applyMovementDelta(tx, orgId, input.ingredientId, locationId, delta);

    await tx.insert(auditLogs).values({
      orgId,
      actorUserId,
      action: "stock_adjusted",
      entity: "inventory_movements",
      entityId: movement.id,
      after: { ingredientId: input.ingredientId, delta, notes: input.notes, onHand },
    });

    return { ok: true, onHand, delta };
  });
}

export interface CountStockInput {
  readonly ingredientId: string;
  /** The physical count, non-negative decimal, in `unit`. */
  readonly countedQuantity: string;
  readonly unit: Unit;
  /** Optional context beyond the auto-generated "physical count" note. */
  readonly notes: string | null;
}

/**
 * A stock count is not its own movement type (docs/INVENTORY-ARCHITECTURE.md
 * D5: v1 uses a plain ADJUSTMENT with a required note) — this computes the
 * delta between the count and the cached on-hand and writes exactly that.
 * The roadmap's own example: counting 9.4 kg when 10 kg is on hand writes a
 * −0.6 kg adjustment. A count that matches on-hand exactly writes nothing —
 * there is no correction to record.
 */
export async function countStock(orgId: string, actorUserId: string, input: CountStockInput): Promise<StockWriteResult> {
  const locationId = await getStoreLocationId(orgId);
  if (!locationId) return { ok: false, error: "No location is set up for this organization yet." };

  return db().transaction(async (tx) => {
    const ingredient = await loadIngredientForWrite(tx, orgId, input.ingredientId);
    if (!ingredient) return { ok: false, error: "That ingredient no longer exists." };

    let countedBase: number;
    try {
      const conversion = conversionFor(input.unit);
      if (conversion.baseUnit !== ingredient.baseUnit) {
        return { ok: false, error: unitMismatchError(ingredient.baseUnit, input.unit) };
      }
      countedBase = toBaseUnitsDecimal(input.countedQuantity, input.unit);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "That quantity can't be converted." };
    }
    if (countedBase < 0) return { ok: false, error: "A counted quantity can't be negative." };

    const [item] = await tx
      .select({ quantityOnHand: inventoryItems.quantityOnHand })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.orgId, orgId), eq(inventoryItems.ingredientId, input.ingredientId), eq(inventoryItems.locationId, locationId)))
      .limit(1);
    const currentOnHand = item?.quantityOnHand ?? 0;
    const delta = countedBase - currentOnHand;

    if (delta === 0) {
      return { ok: true, onHand: currentOnHand, delta: 0 };
    }

    const rate = ingredient.costPerBaseUnitMilli as MilliPaise;
    const costPerBaseUnit = rateToPaise(rate);
    const magnitude = Math.abs(delta);
    const totalCost = costFromRate(rate, magnitude);

    const label = unitLabel(ingredient.baseUnit);
    const autoNote = `Physical count: ${countedBase} ${label} counted, ${currentOnHand} ${label} on hand.`;
    const notes = input.notes ? `${autoNote} ${input.notes}` : autoNote;

    const [movement] = await tx
      .insert(inventoryMovements)
      .values({
        orgId,
        ingredientId: input.ingredientId,
        locationId,
        type: "ADJUSTMENT",
        quantity: delta,
        costPerBaseUnit,
        totalCost,
        actorUserId,
        notes,
      })
      .returning({ id: inventoryMovements.id });
    if (!movement) throw new Error("stock: count adjustment insert returned no row");

    const onHand = await applyMovementDelta(tx, orgId, input.ingredientId, locationId, delta);

    await tx.insert(auditLogs).values({
      orgId,
      actorUserId,
      action: "stock_counted",
      entity: "inventory_movements",
      entityId: movement.id,
      before: { onHand: currentOnHand },
      after: { onHand, countedBase, delta },
    });

    return { ok: true, onHand, delta };
  });
}

