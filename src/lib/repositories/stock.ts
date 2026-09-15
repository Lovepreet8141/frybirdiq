import "server-only";

/**
 * Stock movements — receive, adjust, count, waste. Roadmap 3.2 and 3.3.
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

import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, ingredients, inventoryItems, inventoryMovements, memberships, recipeVersionItems, recipes, wasteEntries } from "@/db/schema";
import { movementTypeEnum, type Unit } from "@/db/schema/inventory";
import type { DateRange } from "@/lib/dates";
import { getStoreLocationId } from "@/lib/repositories/hardware";
import { type DbTx, recordIngredientPriceInTx } from "@/lib/repositories/inventory";
import { consumptionQuantity, costFromRate, type MilliPaise, purchaseRatePerBaseUnit, rateToPaise } from "@/lib/iq/costing";
import { type BaseUnit, conversionFor, toBaseUnits, toBaseUnitsDecimal, unitLabel } from "@/lib/iq/units";
import { WASTE_REASON_LABEL, type WasteReasonOption } from "@/lib/inventory/waste-reasons";
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

export interface IngredientOption {
  readonly id: string;
  readonly name: string;
  readonly baseUnit: BaseUnit;
}

/**
 * The minimal ingredient list for the waste-recording picker — id, name and
 * base unit only, no cost. Roadmap 3.3.
 *
 * KITCHEN holds `inventory.waste` but not `inventory.view`
 * (docs/INVENTORY-ARCHITECTURE.md §3, `domain/permissions.ts`), so the
 * waste-recording page cannot reuse `listIngredients` in
 * `repositories/inventory.ts` — that function's `IngredientRow` carries
 * `costPerBaseUnit`, which would hand pricing to a role that was never
 * granted `inventory.view`. This is deliberately its own, narrower query.
 */
export async function listIngredientOptions(orgId: string): Promise<readonly IngredientOption[]> {
  const rows = await db()
    .select({ id: ingredients.id, name: ingredients.name, baseUnit: ingredients.baseUnit })
    .from(ingredients)
    .where(and(eq(ingredients.orgId, orgId), eq(ingredients.isActive, true)))
    .orderBy(asc(ingredients.name));
  // Only G, ML and PIECE are ever written (validated at the boundary); the column type is the wider enum.
  return rows.map((row) => ({ ...row, baseUnit: row.baseUnit as BaseUnit }));
}

export interface WasteWeekTotal {
  readonly totalCost: Paise;
  readonly entryCount: number;
}

/**
 * The rolling 7-day waste total, org-wide — the roadmap's own "done when"
 * criterion: "a waste entry appears ... in the week's waste total." A
 * rolling window rather than a calendar week, the same convention Smart 86
 * (roadmap 3.6) uses for its 7-day velocity.
 */
export async function getWasteWeekTotal(orgId: string): Promise<WasteWeekTotal> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [row] = await db()
    .select({
      totalCost: sql<string>`coalesce(sum(${wasteEntries.cost}), 0)`,
      entryCount: sql<number>`count(*)::int`,
    })
    .from(wasteEntries)
    .where(and(eq(wasteEntries.orgId, orgId), gte(wasteEntries.occurredAt, since)));
  return { totalCost: paise(BigInt(row?.totalCost ?? "0")), entryCount: row?.entryCount ?? 0 };
}

export interface FoodCostComparison {
  /** What the recipes say should have been used for everything sold — zero waste, zero shrinkage assumed. Sum of every SALE movement's `totalCost` in the period. */
  readonly theoreticalCost: Paise;
  /** What actually left the shelf, for any reason, this period — sales at their recipe cost, plus waste, plus shrinkage found on a count. */
  readonly actualCost: Paise;
  /** `actualCost - theoreticalCost`. Positive: waste and shrinkage cost more than the recipe math alone accounts for. */
  readonly varianceCost: Paise;
  /** SALE movements in the period. Zero means there is nothing to compare yet — the caller must not render 0 vs 0 as a clean result. */
  readonly saleMovementCount: number;
}

/**
 * Theoretical vs actual food cost for a period. Roadmap 3.5.
 *
 * Theoretical is exactly what a SALE movement's `totalCost` already records
 * — recipe quantity x ingredient rate at the moment of consumption, written
 * by `recordConsumption` above. It is not recomputed here; it is summed.
 *
 * Actual adds every other movement type that represents stock genuinely
 * gone for a bad reason: WASTE in full, and the negative half of
 * ADJUSTMENT (a physical count that came up short of the cache — real
 * shrinkage, docs/INVENTORY-ARCHITECTURE.md D5). The positive half of
 * ADJUSTMENT (stock found that nobody had logged) is excluded from both
 * sides, the same as PURCHASE — it was never sold or lost, so it belongs
 * in neither number.
 *
 * RETURN (a SALE reversed because its order was rejected or cancelled
 * after ACCEPTED — `reverseConsumption` above) is deliberately excluded
 * from both sides too, rather than netted against SALE. A RETURN's
 * `totalCost` always equals the SALE it undoes, so including it in one
 * number and not the other would make a cancelled order look like a
 * saving, and netting it out of both would only matter across a period
 * boundary that a same-transaction reversal almost never crosses. Leaving
 * it out of both keeps `varianceCost` reading as exactly what it claims to
 * be: the cost of waste and shrinkage, nothing else.
 *
 * One real SQL aggregate with `filter`, not client-side summation of an
 * unbounded row set — the same shape as `getWasteWeekTotal` above.
 */
export async function getFoodCostComparison(orgId: string, range: Pick<DateRange, "from" | "to">): Promise<FoodCostComparison> {
  const [row] = await db()
    .select({
      theoreticalCost: sql<string>`coalesce(sum(${inventoryMovements.totalCost}) filter (where ${inventoryMovements.type} = 'SALE'), 0)`,
      actualCost: sql<string>`coalesce(sum(${inventoryMovements.totalCost}) filter (
        where ${inventoryMovements.type} in ('SALE', 'WASTE')
           or (${inventoryMovements.type} = 'ADJUSTMENT' and ${inventoryMovements.quantity} < 0)
      ), 0)`,
      saleMovementCount: sql<number>`count(*) filter (where ${inventoryMovements.type} = 'SALE')::int`,
    })
    .from(inventoryMovements)
    .where(and(eq(inventoryMovements.orgId, orgId), gte(inventoryMovements.occurredAt, range.from), lt(inventoryMovements.occurredAt, range.to)));

  const theoreticalCost = paise(BigInt(row?.theoreticalCost ?? "0"));
  const actualCost = paise(BigInt(row?.actualCost ?? "0"));

  return {
    theoreticalCost,
    actualCost,
    varianceCost: (actualCost - theoreticalCost) as Paise,
    saleMovementCount: row?.saleMovementCount ?? 0,
  };
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

export interface RecordWasteInput {
  readonly ingredientId: string;
  /** A positive decimal, in `unit` — a kitchen-scale reading, same convention as `adjustStock`. */
  readonly quantity: string;
  readonly unit: Unit;
  readonly reason: WasteReasonOption;
  readonly notes: string | null;
}

/**
 * Records waste. Roadmap 3.3, docs/INVENTORY-ARCHITECTURE.md §4 write path 7.
 *
 * Writes a WASTE movement (negative, valued at the ingredient's *current
 * usable* rate — the same convention `adjustStock` uses, not the raw
 * purchase rate `receiveStock` uses: waste is a recipe-costing loss, not a
 * receiving event) and a `waste_entries` row linked to it via `movementId`,
 * in the same transaction as the on-hand decrement — so a waste entry can
 * never exist without the movement that actually took the stock out, or
 * vice versa. This is also what makes the roadmap's own "done when" true:
 * the movement is what the ingredient's movement history reads.
 */
export async function recordWaste(orgId: string, actorUserId: string, input: RecordWasteInput): Promise<StockWriteResult> {
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

    const rate = ingredient.costPerBaseUnitMilli as MilliPaise;
    const costPerBaseUnit = rateToPaise(rate);
    // costFromRate(0, …) is already zero when nothing has ever been priced.
    const totalCost = costFromRate(rate, magnitude);

    const reasonLabel = WASTE_REASON_LABEL[input.reason];
    const movementNotes = input.notes ? `${reasonLabel} — ${input.notes}` : reasonLabel;

    const [movement] = await tx
      .insert(inventoryMovements)
      .values({
        orgId,
        ingredientId: input.ingredientId,
        locationId,
        type: "WASTE",
        quantity: -magnitude,
        costPerBaseUnit,
        totalCost,
        actorUserId,
        notes: movementNotes,
      })
      .returning({ id: inventoryMovements.id });
    if (!movement) throw new Error("stock: waste movement insert returned no row");

    const [entry] = await tx
      .insert(wasteEntries)
      .values({
        orgId,
        ingredientId: input.ingredientId,
        locationId,
        movementId: movement.id,
        // A manual entry, not one caused by an order's cancellation — that
        // link is 3.4's concern (docs/INVENTORY-ARCHITECTURE.md §D2/§7).
        orderId: null,
        quantity: magnitude,
        unit: ingredient.baseUnit,
        reason: input.reason,
        cost: totalCost,
        actorUserId,
        notes: input.notes,
      })
      .returning({ id: wasteEntries.id });
    if (!entry) throw new Error("stock: waste entry insert returned no row");

    const onHand = await applyMovementDelta(tx, orgId, input.ingredientId, locationId, -magnitude);

    await tx.insert(auditLogs).values({
      orgId,
      actorUserId,
      action: "waste_recorded",
      entity: "waste_entries",
      entityId: entry.id,
      after: { ingredientId: input.ingredientId, magnitude, unit: ingredient.baseUnit, reason: input.reason, totalCost: totalCost.toString(), onHand },
    });

    return { ok: true, onHand, delta: -magnitude };
  });
}

/* ------------------------------------------------------------------ */
/* Consumption — order lifecycle. Roadmap 3.4.                        */
/* ------------------------------------------------------------------ */

export interface ConsumptionLineInput {
  readonly orderItemId: string;
  /** Null when the line's product has since been deleted, or was never linked — normal, same as `order_items.productId` being nullable per §51. */
  readonly productId: string | null;
  /** Units of the product sold on this line. */
  readonly quantity: number;
}

export interface ConsumptionResult {
  readonly ok: true;
  /** SALE movements actually written — excludes lines with no recipe and idempotent no-ops on a retry. */
  readonly movementsWritten: number;
  /** Lines that consumed nothing, and why. A missing product or recipe is normal, not an error — same convention as `getRecipeDetail` returning nothing. */
  readonly warnings: readonly string[];
}

/**
 * Consumes stock for an order at ACCEPTED — "the moment the kitchen commits
 * to cooking something is the moment the ingredients are actually used"
 * (roadmap 3.4, business decision; not COMPLETED). One transaction per
 * order — "one movement batch per order" — so a genuinely broken recipe
 * reference on one line cannot leave the rest of the order half-consumed.
 *
 * Idempotent on (order item, ingredient): `inventory_movements_sale_line_unique`
 * (a partial unique index, SALE only) is the actual guarantee, not just
 * application logic — `onConflictDoNothing` targets it directly, so a
 * retried call, or two calls racing past `advanceOrder`'s `assertTransition`
 * before either commits, writes the movement at most once. A conflict is a
 * silent no-op, not an error.
 *
 * A line with no product, no recipe, or no saved recipe version consumes
 * nothing and is reported as a warning, never as `{ ok: false }` — a broken
 * recipe reference is a data-quality problem to surface separately, not a
 * reason to block the kitchen from accepting a real order.
 */
export async function recordConsumption(
  orgId: string,
  actorUserId: string | null,
  input: { orderId: string; lines: readonly ConsumptionLineInput[] },
): Promise<ConsumptionResult | { ok: false; error: string }> {
  const locationId = await getStoreLocationId(orgId);
  if (!locationId) return { ok: false, error: "No location is set up for this organization yet." };

  return db().transaction(async (tx) => {
    let movementsWritten = 0;
    const warnings: string[] = [];

    for (const line of input.lines) {
      if (!line.productId) {
        warnings.push(`Order item ${line.orderItemId} has no linked product — nothing consumed.`);
        continue;
      }
      if (line.quantity <= 0) continue;

      const [recipe] = await tx
        .select({ currentVersionId: recipes.currentVersionId, yieldQuantity: recipes.yieldQuantity })
        .from(recipes)
        .where(and(eq(recipes.orgId, orgId), eq(recipes.productId, line.productId)))
        .limit(1);

      if (!recipe || !recipe.currentVersionId) {
        warnings.push(`Product ${line.productId} has no saved recipe — nothing consumed for order item ${line.orderItemId}.`);
        continue;
      }

      const versionItems = await tx
        .select({
          ingredientId: recipeVersionItems.ingredientId,
          quantityBase: recipeVersionItems.quantity,
          costPerBaseUnitMilli: ingredients.costPerBaseUnitMilli,
        })
        .from(recipeVersionItems)
        .innerJoin(ingredients, eq(ingredients.id, recipeVersionItems.ingredientId))
        .where(eq(recipeVersionItems.versionId, recipe.currentVersionId));

      if (versionItems.length === 0) {
        warnings.push(`Recipe for product ${line.productId} has no ingredient lines — nothing consumed for order item ${line.orderItemId}.`);
        continue;
      }

      for (const item of versionItems) {
        const magnitude = consumptionQuantity(item.quantityBase, line.quantity, recipe.yieldQuantity);
        if (magnitude <= 0) continue;

        const rate = item.costPerBaseUnitMilli as MilliPaise;
        const costPerBaseUnit = rateToPaise(rate);
        // Valued at the ingredient's current usable rate, not one frozen into
        // the recipe version — recipes don't store cost snapshots.
        const totalCost = costFromRate(rate, magnitude);

        const [movement] = await tx
          .insert(inventoryMovements)
          .values({
            orgId,
            ingredientId: item.ingredientId,
            locationId,
            type: "SALE",
            quantity: -magnitude,
            costPerBaseUnit,
            totalCost,
            orderId: input.orderId,
            orderItemId: line.orderItemId,
            recipeVersionId: recipe.currentVersionId,
            actorUserId,
            notes: null,
          })
          .onConflictDoNothing({
            target: [inventoryMovements.orderItemId, inventoryMovements.ingredientId],
            where: sql`${inventoryMovements.type} = 'SALE'`,
          })
          .returning({ id: inventoryMovements.id });

        // A conflict means this exact order item + ingredient was already
        // consumed — D7's idempotent no-op, not an error.
        if (!movement) continue;

        const onHand = await applyMovementDelta(tx, orgId, item.ingredientId, locationId, -magnitude);
        movementsWritten++;

        await tx.insert(auditLogs).values({
          orgId,
          actorUserId,
          action: "stock_consumed",
          entity: "inventory_movements",
          entityId: movement.id,
          after: { orderId: input.orderId, orderItemId: line.orderItemId, ingredientId: item.ingredientId, magnitude, onHand },
        });
      }
    }

    return { ok: true, movementsWritten, warnings };
  });
}

export interface ReversalResult {
  readonly ok: true;
  /** RETURN movements actually written — excludes movements already reversed on a retry. */
  readonly movementsReversed: number;
}

/**
 * Reverses whatever `recordConsumption` did for an order — REJECTED/CANCELLED
 * only, never REFUNDED (roadmap 3.4, business decision: a refund happens
 * after the food may already be cooked and handed over — the chicken was
 * genuinely used — while a rejection/cancellation means it never was).
 *
 * Writes a new RETURN movement per un-reversed SALE; never edits or deletes
 * the original (same immutability discipline as an order line or a recipe
 * version). There is no partial unique index on `reversalOfMovementId` the
 * way `inventory_movements_sale_line_unique` guards SALE, so this locks the
 * order's SALE rows with `SELECT … FOR UPDATE` first — two calls racing
 * past `advanceOrder`/`rejectOrder`'s `assertTransition` for the same order
 * (the same kind of race the SALE unique index guards against) serialize on
 * those rows instead of both crediting the stock back, rather than relying
 * on a clean sequential retry alone.
 */
export async function reverseConsumption(
  orgId: string,
  actorUserId: string | null,
  orderId: string,
  reason: string | null,
): Promise<ReversalResult | { ok: false; error: string }> {
  return db().transaction(async (tx) => {
    const saleMovements = await tx
      .select({
        id: inventoryMovements.id,
        ingredientId: inventoryMovements.ingredientId,
        locationId: inventoryMovements.locationId,
        quantity: inventoryMovements.quantity,
        costPerBaseUnit: inventoryMovements.costPerBaseUnit,
        totalCost: inventoryMovements.totalCost,
        orderItemId: inventoryMovements.orderItemId,
      })
      .from(inventoryMovements)
      .where(and(eq(inventoryMovements.orgId, orgId), eq(inventoryMovements.orderId, orderId), eq(inventoryMovements.type, "SALE")))
      .for("update");

    if (saleMovements.length === 0) {
      return { ok: true, movementsReversed: 0 };
    }

    const saleIds = saleMovements.map((movement) => movement.id);
    const existingReturns = await tx
      .select({ reversalOfMovementId: inventoryMovements.reversalOfMovementId })
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.orgId, orgId),
          eq(inventoryMovements.type, "RETURN"),
          inArray(inventoryMovements.reversalOfMovementId, saleIds),
        ),
      );
    const alreadyReversed = new Set(
      existingReturns.map((row) => row.reversalOfMovementId).filter((id): id is string => id !== null),
    );

    let movementsReversed = 0;

    for (const sale of saleMovements) {
      if (alreadyReversed.has(sale.id)) continue;

      const magnitude = Math.abs(sale.quantity);
      if (magnitude === 0) continue;

      const [movement] = await tx
        .insert(inventoryMovements)
        .values({
          orgId,
          ingredientId: sale.ingredientId,
          // Reuses the original SALE's own location rather than re-resolving
          // the org's current location, so a reversal always lands the stock
          // back where it was actually taken from.
          locationId: sale.locationId,
          type: "RETURN",
          quantity: magnitude,
          costPerBaseUnit: sale.costPerBaseUnit,
          totalCost: sale.totalCost,
          orderId,
          orderItemId: sale.orderItemId,
          reversalOfMovementId: sale.id,
          actorUserId,
          notes: reason,
        })
        .returning({ id: inventoryMovements.id });
      if (!movement) throw new Error("stock: return movement insert returned no row");

      const onHand = await applyMovementDelta(tx, orgId, sale.ingredientId, sale.locationId, magnitude);
      movementsReversed++;

      await tx.insert(auditLogs).values({
        orgId,
        actorUserId,
        action: "stock_consumption_reversed",
        entity: "inventory_movements",
        entityId: movement.id,
        after: { orderId, reversalOfMovementId: sale.id, ingredientId: sale.ingredientId, magnitude, onHand },
      });
    }

    return { ok: true, movementsReversed };
  });
}
