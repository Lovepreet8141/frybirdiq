import "server-only";

/**
 * Purchase orders. Roadmap 3.7, docs/INVENTORY-ARCHITECTURE.md §4 write
 * paths 5–6.
 *
 * DRAFT → ORDERED → RECEIVED | CANCELLED — `purchase_orders.status` is a
 * checked `text` column (schema comment: "held honest by the check below
 * rather than a new enum"), not a Drizzle enum; every transition here
 * re-validates the current value itself rather than trusting the caller.
 *
 * Receiving is the one write that touches stock: it calls
 * `receiveStockInTx` (`src/lib/repositories/stock.ts`) once per line, inside
 * one transaction together with the PO's own status update, so a failure on
 * any single line rolls back the whole receipt rather than leaving it half
 * landed. That function already does everything "receiving creates the 3.2
 * movement" means — a PURCHASE movement plus the ingredient price update —
 * so this file does not duplicate that logic, only the PO-specific bookkeeping
 * around it (line quantities, status, the receipt's expense rows).
 */

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, expenseCategories, expenses, ingredients, purchaseOrderItems, purchaseOrders, suppliers } from "@/db/schema";
import type { Unit } from "@/db/schema/inventory";
import { businessDate } from "@/lib/dates";
import { conversionFor, unitLabel, type BaseUnit } from "@/lib/iq/units";
import { ZERO, add, multiply, paise, type Paise } from "@/lib/money";
import { type DbTx } from "@/lib/repositories/inventory";
import { getStoreLocationId } from "@/lib/repositories/hardware";
import { receiveStockInTx } from "@/lib/repositories/stock";
import { withIdempotency } from "@/lib/repositories/idempotency";

export type PurchaseOrderStatus = "DRAFT" | "ORDERED" | "RECEIVED" | "CANCELLED";

export const PURCHASE_ORDER_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  DRAFT: "Draft",
  ORDERED: "Ordered",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

function asStatus(value: string): PurchaseOrderStatus {
  // The check constraint on `purchase_orders.status` is the real guarantee;
  // this cast just gives the rest of the file a narrow type to switch on.
  return value as PurchaseOrderStatus;
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export interface PurchaseOrderRow {
  readonly id: string;
  readonly reference: string | null;
  readonly status: PurchaseOrderStatus;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly total: Paise;
  readonly itemCount: number;
  readonly expectedAt: Date | null;
  readonly receivedAt: Date | null;
  readonly createdAt: Date;
}

export async function listPurchaseOrders(orgId: string): Promise<readonly PurchaseOrderRow[]> {
  const rows = await db()
    .select({
      id: purchaseOrders.id,
      reference: purchaseOrders.reference,
      status: purchaseOrders.status,
      supplierId: purchaseOrders.supplierId,
      supplierName: suppliers.name,
      total: purchaseOrders.total,
      expectedAt: purchaseOrders.expectedAt,
      receivedAt: purchaseOrders.receivedAt,
      createdAt: purchaseOrders.createdAt,
      itemCount: purchaseOrderItems.id,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .leftJoin(purchaseOrderItems, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
    .where(eq(purchaseOrders.orgId, orgId))
    .orderBy(desc(purchaseOrders.createdAt));

  // Grouped in JS rather than a SQL count(*) + group by — the row set is one
  // PO's worth of lines at a time in practice (a handful), and this keeps
  // the query a plain join instead of two round trips.
  const byId = new Map<string, PurchaseOrderRow>();
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (existing) {
      byId.set(row.id, { ...existing, itemCount: existing.itemCount + (row.itemCount ? 1 : 0) });
      continue;
    }
    byId.set(row.id, {
      id: row.id,
      reference: row.reference,
      status: asStatus(row.status),
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      total: paise(row.total),
      itemCount: row.itemCount ? 1 : 0,
      expectedAt: row.expectedAt,
      receivedAt: row.receivedAt,
      createdAt: row.createdAt,
    });
  }
  return [...byId.values()];
}

export interface PurchaseOrderLineRow {
  readonly id: string;
  readonly ingredientId: string;
  readonly ingredientName: string;
  readonly quantity: number;
  readonly unit: Unit;
  readonly unitCost: Paise;
  readonly lineTotal: Paise;
  readonly receivedQuantity: number | null;
}

export interface PurchaseOrderDetail {
  readonly id: string;
  readonly reference: string | null;
  readonly status: PurchaseOrderStatus;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly subtotal: Paise;
  readonly taxTotal: Paise;
  readonly total: Paise;
  readonly expectedAt: Date | null;
  readonly receivedAt: Date | null;
  readonly createdAt: Date;
  readonly lines: readonly PurchaseOrderLineRow[];
}

export async function getPurchaseOrder(orgId: string, id: string): Promise<PurchaseOrderDetail | null> {
  const [po] = await db()
    .select({
      id: purchaseOrders.id,
      reference: purchaseOrders.reference,
      status: purchaseOrders.status,
      supplierId: purchaseOrders.supplierId,
      supplierName: suppliers.name,
      subtotal: purchaseOrders.subtotal,
      taxTotal: purchaseOrders.taxTotal,
      total: purchaseOrders.total,
      expectedAt: purchaseOrders.expectedAt,
      receivedAt: purchaseOrders.receivedAt,
      createdAt: purchaseOrders.createdAt,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.id, id)))
    .limit(1);
  if (!po) return null;

  const lines = await db()
    .select({
      id: purchaseOrderItems.id,
      ingredientId: purchaseOrderItems.ingredientId,
      ingredientName: ingredients.name,
      quantity: purchaseOrderItems.quantity,
      unit: purchaseOrderItems.unit,
      unitCost: purchaseOrderItems.unitCost,
      lineTotal: purchaseOrderItems.lineTotal,
      receivedQuantity: purchaseOrderItems.receivedQuantity,
    })
    .from(purchaseOrderItems)
    .innerJoin(ingredients, eq(ingredients.id, purchaseOrderItems.ingredientId))
    .where(eq(purchaseOrderItems.purchaseOrderId, id))
    .orderBy(asc(ingredients.name));

  return {
    id: po.id,
    reference: po.reference,
    status: asStatus(po.status),
    supplierId: po.supplierId,
    supplierName: po.supplierName,
    subtotal: paise(po.subtotal),
    taxTotal: paise(po.taxTotal),
    total: paise(po.total),
    expectedAt: po.expectedAt,
    receivedAt: po.receivedAt,
    createdAt: po.createdAt,
    lines: lines.map((line) => ({
      id: line.id,
      ingredientId: line.ingredientId,
      ingredientName: line.ingredientName,
      quantity: line.quantity,
      unit: line.unit,
      unitCost: paise(line.unitCost),
      lineTotal: paise(line.lineTotal),
      receivedQuantity: line.receivedQuantity,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export interface PurchaseOrderLineInput {
  readonly ingredientId: string;
  /** As ordered: whole number, in `unit` — same convention as `recordIngredientPrice`'s `purchaseQuantity`. */
  readonly quantity: number;
  readonly unit: Unit;
  /** Per unit of `unit`, not per base unit. */
  readonly unitCost: Paise;
}

export interface CreatePurchaseOrderInput {
  readonly supplierId: string;
  readonly reference: string | null;
  readonly expectedAt: Date | null;
  readonly lines: readonly PurchaseOrderLineInput[];
}

export type CreatePurchaseOrderResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Write path 5 (create). Always lands as DRAFT — sending and receiving are
 * their own, separate transitions below. Totals are computed here, from the
 * lines the client sent, never trusted from the client (§ "the client sends
 * items, not totals").
 *
 * No GST is applied to a purchase order: `src/lib/tax/gst` prices what
 * FRYBIRD charges a customer, and nothing in docs/INVENTORY-ARCHITECTURE.md
 * models input tax credit on a supplier bill — `taxTotal` stays zero here,
 * matching the schema's own default, and `total` is exactly `subtotal`.
 */
export async function createPurchaseOrder(orgId: string, actorUserId: string, input: CreatePurchaseOrderInput): Promise<CreatePurchaseOrderResult> {
  if (input.lines.length === 0) return { ok: false, error: "Add at least one line before saving." };

  const locationId = await getStoreLocationId(orgId);
  if (!locationId) return { ok: false, error: "No location is set up for this organization yet." };

  return db().transaction(async (tx) => {
    const [supplier] = await tx.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.orgId, orgId), eq(suppliers.id, input.supplierId))).limit(1);
    if (!supplier) return { ok: false, error: "That supplier no longer exists." };

    const ingredientIds = [...new Set(input.lines.map((line) => line.ingredientId))];
    const ingredientRows = await tx
      .select({ id: ingredients.id, name: ingredients.name, baseUnit: ingredients.baseUnit })
      .from(ingredients)
      .where(and(eq(ingredients.orgId, orgId), inArray(ingredients.id, ingredientIds)));
    const ingredientMap = new Map(ingredientRows.map((row) => [row.id, row]));

    const lineTotals: Paise[] = [];
    for (const line of input.lines) {
      const ingredient = ingredientMap.get(line.ingredientId);
      if (!ingredient) return { ok: false, error: "One of the ingredients on this order no longer exists." };
      const conversion = conversionFor(line.unit);
      if (conversion.baseUnit !== ingredient.baseUnit) {
        return { ok: false, error: `${ingredient.name} is measured in ${unitLabel(ingredient.baseUnit as BaseUnit)}; a line in ${unitLabel(line.unit)} can't be converted to it.` };
      }
      lineTotals.push(multiply(line.unitCost, line.quantity));
    }

    const subtotal = add(...lineTotals);

    const [po] = await tx
      .insert(purchaseOrders)
      .values({
        orgId,
        locationId,
        supplierId: input.supplierId,
        reference: input.reference,
        status: "DRAFT",
        subtotal,
        taxTotal: ZERO,
        total: subtotal,
        expectedAt: input.expectedAt,
      })
      .returning({ id: purchaseOrders.id });
    if (!po) throw new Error("purchase-orders: insert returned no row");

    await tx.insert(purchaseOrderItems).values(
      input.lines.map((line, index) => ({
        orgId,
        purchaseOrderId: po.id,
        ingredientId: line.ingredientId,
        quantity: line.quantity,
        unit: line.unit,
        unitCost: line.unitCost,
        lineTotal: lineTotals[index]!,
      })),
    );

    await tx.insert(auditLogs).values({
      orgId,
      actorUserId,
      action: "purchase_order_created",
      entity: "purchase_orders",
      entityId: po.id,
      after: { supplierId: input.supplierId, reference: input.reference, lineCount: input.lines.length, total: subtotal.toString() },
    });

    return { ok: true, id: po.id };
  });
}

/* ------------------------------------------------------------------ */
/* Status transitions — send, cancel                                   */
/* ------------------------------------------------------------------ */

export type PurchaseOrderTransitionResult = { ok: true } | { ok: false; error: string };

async function loadForTransition(tx: DbTx, orgId: string, id: string) {
  const [po] = await tx.select({ id: purchaseOrders.id, status: purchaseOrders.status }).from(purchaseOrders).where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.id, id))).limit(1);
  return po ? { id: po.id, status: asStatus(po.status) } : null;
}

/**
 * DRAFT → ORDERED. The roadmap's own "sent" — the real column value is
 * ORDERED, not SENT (docs/ROADMAP.md's phrasing is colloquial; the schema's
 * check constraint is the actual contract). A pure status transition, no
 * stock or money effect — those only happen on receipt.
 */
export async function sendPurchaseOrder(orgId: string, actorUserId: string, id: string): Promise<PurchaseOrderTransitionResult> {
  return db().transaction(async (tx) => {
    const po = await loadForTransition(tx, orgId, id);
    if (!po) return { ok: false, error: "That purchase order no longer exists." };
    if (po.status !== "DRAFT") {
      return { ok: false, error: `Only a draft purchase order can be sent (this one is ${PURCHASE_ORDER_STATUS_LABEL[po.status].toLowerCase()}).` };
    }

    await tx.update(purchaseOrders).set({ status: "ORDERED", updatedAt: new Date() }).where(eq(purchaseOrders.id, id));
    await tx.insert(auditLogs).values({
      orgId,
      actorUserId,
      action: "purchase_order_ordered",
      entity: "purchase_orders",
      entityId: id,
      before: { status: po.status },
      after: { status: "ORDERED" },
    });
    return { ok: true };
  });
}

/**
 * DRAFT or ORDERED → CANCELLED. No stock effect either way — nothing has
 * been received yet by definition of being cancellable.
 */
export async function cancelPurchaseOrder(orgId: string, actorUserId: string, id: string): Promise<PurchaseOrderTransitionResult> {
  return db().transaction(async (tx) => {
    const po = await loadForTransition(tx, orgId, id);
    if (!po) return { ok: false, error: "That purchase order no longer exists." };
    if (po.status !== "DRAFT" && po.status !== "ORDERED") {
      return { ok: false, error: `A ${PURCHASE_ORDER_STATUS_LABEL[po.status].toLowerCase()} purchase order can't be cancelled.` };
    }

    await tx.update(purchaseOrders).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(purchaseOrders.id, id));
    await tx.insert(auditLogs).values({
      orgId,
      actorUserId,
      action: "purchase_order_cancelled",
      entity: "purchase_orders",
      entityId: id,
      before: { status: po.status },
      after: { status: "CANCELLED" },
    });
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* Receive                                                             */
/* ------------------------------------------------------------------ */

export interface ReceivePurchaseOrderLineInput {
  readonly purchaseOrderItemId: string;
  /**
   * What actually arrived for this line. Omitted (or the whole `lines`
   * array omitted) means "received in full" — the ordered quantity — which
   * is the roadmap's own "done when" case and the one-click default in the
   * UI. When given, must be between 0 (nothing arrived for this line) and
   * the ordered quantity; this build has no concept of over-delivery or a
   * back-order, so a short shipment is recorded but there is no second
   * receipt for the remainder — the PO still closes as RECEIVED, the same
   * terminal state a full receipt reaches, because the schema's check
   * constraint has no partial status to move it to instead.
   */
  readonly receivedQuantity?: number;
}

export interface ReceivePurchaseOrderInput {
  readonly lines?: readonly ReceivePurchaseOrderLineInput[];
}

export type ReceivePurchaseOrderResult = { ok: true; movementCount: number } | { ok: false; error: string };

/** Thrown to roll back a receipt already partway through its writes — caught in `receivePurchaseOrder` and turned back into `{ ok: false }`. Every line is pre-validated before any write happens, so this only fires if something changes underneath the transaction between the check and the write. */
class PurchaseOrderReceiveError extends Error {}

const RECEIPT_EXPENSE_CATEGORIES: readonly { readonly isPackaging: boolean; readonly categoryName: string }[] = [
  { isPackaging: false, categoryName: "Food supplies" },
  { isPackaging: true, categoryName: "Packaging" },
];

/**
 * Writes the receipt's expense row(s) — docs/INVENTORY-ARCHITECTURE.md D7 /
 * §9 / §12a: the one door a stock purchase takes into the P&L, so it is
 * never entered a second time by hand and never silently absent from it
 * either. One row per category actually present on the receipt (food,
 * packaging, or both), `purchaseOrderId` set so `expenses_purchase_order_
 * category_unique` refuses a duplicate if this ever runs twice.
 *
 * Best-effort: a category that isn't seeded under its expected name is
 * skipped rather than failing the whole receipt — stock and the ingredient
 * price, the roadmap's actual "done when", must never depend on expense
 * category naming being exactly right.
 */
async function writeReceiptExpenses(tx: DbTx, orgId: string, actorUserId: string, po: { id: string; reference: string | null; supplierId: string }, costByIsPackaging: ReadonlyMap<boolean, Paise>): Promise<void> {
  const paidOn = businessDate(new Date());

  for (const { isPackaging, categoryName } of RECEIPT_EXPENSE_CATEGORIES) {
    const amount = costByIsPackaging.get(isPackaging) ?? ZERO;
    if (amount <= ZERO) continue;

    const [category] = await tx.select({ id: expenseCategories.id }).from(expenseCategories).where(and(eq(expenseCategories.orgId, orgId), eq(expenseCategories.name, categoryName))).limit(1);
    if (!category) continue;

    const label = po.reference ? `PO ${po.reference}` : `PO ${po.id.slice(0, 8)}`;
    await tx
      .insert(expenses)
      .values({
        orgId,
        categoryId: category.id,
        description: `${categoryName} received — ${label}`,
        amount,
        paidOn,
        supplierId: po.supplierId,
        reference: po.reference,
        purchaseOrderId: po.id,
      })
      .onConflictDoNothing({ target: [expenses.purchaseOrderId, expenses.categoryId] });

    await tx.insert(auditLogs).values({
      orgId,
      actorUserId,
      action: "expense_recorded_from_purchase_order",
      entity: "expenses",
      entityId: po.id,
      after: { categoryName, amount: amount.toString(), purchaseOrderId: po.id },
    });
  }
}

async function receivePurchaseOrderNow(orgId: string, actorUserId: string, id: string, input: ReceivePurchaseOrderInput): Promise<ReceivePurchaseOrderResult> {
  try {
    return await db().transaction(async (tx) => {
      const [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.id, id))).limit(1);
      if (!po) return { ok: false, error: "That purchase order no longer exists." };
      if (po.status !== "ORDERED") {
        return { ok: false, error: `Only an ordered purchase order can be received (this one is ${PURCHASE_ORDER_STATUS_LABEL[asStatus(po.status)].toLowerCase()}).` };
      }

      const items = await tx.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, id));
      if (items.length === 0) return { ok: false, error: "This purchase order has no line items." };

      const overrideByItemId = new Map((input.lines ?? []).map((line) => [line.purchaseOrderItemId, line.receivedQuantity]));
      const knownItemIds = new Set(items.map((item) => item.id));
      for (const line of input.lines ?? []) {
        if (!knownItemIds.has(line.purchaseOrderItemId)) return { ok: false, error: "One of the lines in the request doesn't belong to this purchase order." };
      }

      const ingredientIds = items.map((item) => item.ingredientId);
      const ingredientRows = await tx
        .select({ id: ingredients.id, baseUnit: ingredients.baseUnit, isPackaging: ingredients.isPackaging })
        .from(ingredients)
        .where(inArray(ingredients.id, ingredientIds));
      const ingredientMap = new Map(ingredientRows.map((row) => [row.id, row]));

      // Pre-validate every line before writing anything, so a bad line
      // refuses the whole receipt cleanly rather than needing a rollback.
      const plan: { itemId: string; ingredientId: string; unit: Unit; receivedQuantity: number; purchaseCost: Paise; isPackaging: boolean }[] = [];
      for (const item of items) {
        const receivedQuantity = overrideByItemId.get(item.id) ?? item.quantity;
        if (!Number.isInteger(receivedQuantity) || receivedQuantity < 0 || receivedQuantity > item.quantity) {
          return { ok: false, error: `Received quantity for one line must be a whole number between 0 and the ${item.quantity} ordered.` };
        }
        const ingredient = ingredientMap.get(item.ingredientId);
        if (!ingredient) return { ok: false, error: "One of the ingredients on this order no longer exists." };
        const conversion = conversionFor(item.unit);
        if (conversion.baseUnit !== ingredient.baseUnit) {
          return { ok: false, error: "One of this order's lines no longer matches its ingredient's unit." };
        }
        plan.push({
          itemId: item.id,
          ingredientId: item.ingredientId,
          unit: item.unit,
          receivedQuantity,
          purchaseCost: multiply(paise(item.unitCost), receivedQuantity),
          isPackaging: ingredient.isPackaging,
        });
      }

      let movementCount = 0;
      const costByIsPackaging = new Map<boolean, Paise>();

      for (const line of plan) {
        if (line.receivedQuantity <= 0) {
          await tx.update(purchaseOrderItems).set({ receivedQuantity: 0 }).where(eq(purchaseOrderItems.id, line.itemId));
          continue;
        }

        const result = await receiveStockInTx(tx, orgId, actorUserId, po.locationId, {
          ingredientId: line.ingredientId,
          purchaseQuantity: line.receivedQuantity,
          purchaseUnit: line.unit,
          purchaseCost: line.purchaseCost,
          supplierId: po.supplierId,
          notes: po.reference ? `Received via PO ${po.reference}` : `Received via purchase order ${po.id.slice(0, 8)}`,
        });
        // Every line was pre-validated above; a failure here means something
        // changed underneath this transaction. Throw to roll back whatever
        // this loop already wrote — a half-received PO must never commit.
        if (!result.ok) throw new PurchaseOrderReceiveError(result.error);

        movementCount++;
        await tx.update(purchaseOrderItems).set({ receivedQuantity: line.receivedQuantity }).where(eq(purchaseOrderItems.id, line.itemId));
        costByIsPackaging.set(line.isPackaging, add(costByIsPackaging.get(line.isPackaging) ?? ZERO, line.purchaseCost));
      }

      await tx.update(purchaseOrders).set({ status: "RECEIVED", receivedAt: new Date(), updatedAt: new Date() }).where(eq(purchaseOrders.id, id));

      await writeReceiptExpenses(tx, orgId, actorUserId, { id: po.id, reference: po.reference, supplierId: po.supplierId }, costByIsPackaging);

      await tx.insert(auditLogs).values({
        orgId,
        actorUserId,
        action: "purchase_order_received",
        entity: "purchase_orders",
        entityId: id,
        after: { movementCount },
      });

      return { ok: true, movementCount };
    });
  } catch (error) {
    if (error instanceof PurchaseOrderReceiveError) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * ORDERED → RECEIVED. Write path 6: per line, `receiveStockInTx` (a
 * PURCHASE movement plus the supplier price update, in the same transaction
 * as everything else here) and the line's own `receivedQuantity`; then the
 * PO itself moves to RECEIVED with `receivedAt` set, and the receipt's
 * expense row(s) are written (D7).
 *
 * Idempotent on `po:<id>:receive`, exactly the key
 * docs/INVENTORY-ARCHITECTURE.md §4 write path 6 names — a retried request
 * (a double-tap on "Receive," a retried Server Action) returns the first
 * attempt's result rather than landing the stock twice.
 */
export async function receivePurchaseOrder(orgId: string, actorUserId: string, id: string, input: ReceivePurchaseOrderInput = {}): Promise<ReceivePurchaseOrderResult> {
  const { result } = await withIdempotency(
    {
      key: `po:${id}:receive`,
      operation: "purchase_order_receive",
      orgId,
      request: { id, lines: input.lines ?? [] },
    },
    () => receivePurchaseOrderNow(orgId, actorUserId, id, input),
  );
  return result;
}
