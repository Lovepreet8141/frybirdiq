"use server";

/**
 * Purchase order Server Actions. Roadmap 3.7.
 *
 * Every one of these re-checks `purchasing.manage` itself, regardless of
 * what the page that called it decided to render (§41: hiding a button is
 * not authorization) — same discipline as `stock-actions.ts` and
 * `waste-actions.ts`. Structured-argument calls rather than `FormData`, the
 * same shape `saveRecipeVersionAction` uses for its own variable-length line
 * array (`src/lib/menu-admin/actions.ts`) — a purchase order's line count is
 * exactly the same kind of "the client sends items, the server decides what
 * they cost and whether they're allowed" shape a `<form>` doesn't fit well.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { NotPermitted, NotSignedIn, requirePermission } from "@/lib/auth";
import { unitEnum } from "@/db/schema/inventory";
import { fromRupees } from "@/lib/money";
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  receivePurchaseOrder,
  sendPurchaseOrder,
  type CreatePurchaseOrderInput,
} from "@/lib/repositories/purchase-orders";

export interface ActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

/** Auth failures become a sentence, not a stack trace (§57). Anything else is a real bug and is rethrown. */
function explain(error: unknown): ActionResult {
  if (error instanceof NotSignedIn) return { ok: false, error: "You've been signed out. Sign in again." };
  if (error instanceof NotPermitted) return { ok: false, error: "You don't have permission to manage purchase orders." };
  throw error;
}

function revalidatePurchaseOrderSurfaces(id?: string): void {
  revalidatePath("/app/inventory");
  revalidatePath("/app/inventory/purchase-orders");
  if (id) revalidatePath(`/app/inventory/purchase-orders/${id}`);
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

const notPack = z.enum(unitEnum.enumValues).refine((unit) => unit !== "PACK", "A pack has no fixed size — enter what's in it instead.");

const wholeQuantity = z
  .number()
  .int("Quantity must be a whole number.")
  .positive("Quantity must be more than zero.")
  .max(1_000_000, "That quantity looks too large — check the unit.");

const costRupees = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Enter a cost like 280 or 280.50.")
  .refine((value) => Number(value) > 0, "Cost must be more than zero.");

const createLineSchema = z.object({
  ingredientId: z.uuid(),
  quantity: wholeQuantity,
  unit: notPack,
  unitCost: costRupees,
});

const createPurchaseOrderSchema = z.object({
  supplierId: z.uuid("Choose a supplier."),
  reference: z.string().trim().max(120).nullable(),
  expectedAt: z.string().trim().nullable(),
  lines: z.array(createLineSchema).min(1, "Add at least one line before saving.").max(100),
});

export interface CreatePurchaseOrderLineActionInput {
  readonly ingredientId: string;
  readonly quantity: number;
  readonly unit: string;
  readonly unitCost: string;
}

export interface CreatePurchaseOrderActionInput {
  readonly supplierId: string;
  readonly reference: string | null;
  readonly expectedAt: string | null;
  readonly lines: readonly CreatePurchaseOrderLineActionInput[];
}

export async function createPurchaseOrderAction(input: CreatePurchaseOrderActionInput): Promise<ActionResult & { id?: string }> {
  const parsed = createPurchaseOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the order." };

  let staff;
  try {
    staff = await requirePermission("purchasing.manage");
  } catch (error) {
    return explain(error);
  }

  const expectedAt = parsed.data.expectedAt ? new Date(parsed.data.expectedAt) : null;
  if (expectedAt && Number.isNaN(expectedAt.getTime())) return { ok: false, error: "That expected date isn't valid." };

  const repoInput: CreatePurchaseOrderInput = {
    supplierId: parsed.data.supplierId,
    reference: parsed.data.reference?.trim() ? parsed.data.reference.trim() : null,
    expectedAt,
    lines: parsed.data.lines.map((line) => ({
      ingredientId: line.ingredientId,
      quantity: line.quantity,
      unit: line.unit,
      unitCost: fromRupees(line.unitCost),
    })),
  };

  const result = await createPurchaseOrder(staff.orgId, staff.userId, repoInput);
  if (!result.ok) return result;

  revalidatePurchaseOrderSurfaces(result.id);
  return { ok: true, id: result.id };
}

/* ------------------------------------------------------------------ */
/* Send, cancel                                                        */
/* ------------------------------------------------------------------ */

const idSchema = z.uuid();

export async function sendPurchaseOrderAction(id: string): Promise<ActionResult> {
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: "That purchase order id isn't valid." };

  let staff;
  try {
    staff = await requirePermission("purchasing.manage");
  } catch (error) {
    return explain(error);
  }

  const result = await sendPurchaseOrder(staff.orgId, staff.userId, parsedId.data);
  if (!result.ok) return result;

  revalidatePurchaseOrderSurfaces(parsedId.data);
  return { ok: true };
}

export async function cancelPurchaseOrderAction(id: string): Promise<ActionResult> {
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: "That purchase order id isn't valid." };

  let staff;
  try {
    staff = await requirePermission("purchasing.manage");
  } catch (error) {
    return explain(error);
  }

  const result = await cancelPurchaseOrder(staff.orgId, staff.userId, parsedId.data);
  if (!result.ok) return result;

  revalidatePurchaseOrderSurfaces(parsedId.data);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Receive                                                             */
/* ------------------------------------------------------------------ */

const receiveLineSchema = z.object({
  purchaseOrderItemId: z.uuid(),
  receivedQuantity: z.number().int().min(0),
});

const receivePurchaseOrderSchema = z.object({
  id: z.uuid(),
  lines: z.array(receiveLineSchema).max(200).optional(),
});

export interface ReceivePurchaseOrderLineActionInput {
  readonly purchaseOrderItemId: string;
  readonly receivedQuantity: number;
}

/** `lines` omitted (or left undefined) means "received in full" — every line at its ordered quantity. */
export async function receivePurchaseOrderAction(id: string, lines?: readonly ReceivePurchaseOrderLineActionInput[]): Promise<ActionResult & { movementCount?: number }> {
  const parsed = receivePurchaseOrderSchema.safeParse({ id, lines });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the receiving form." };

  let staff;
  try {
    staff = await requirePermission("purchasing.manage");
  } catch (error) {
    return explain(error);
  }

  const result = await receivePurchaseOrder(staff.orgId, staff.userId, parsed.data.id, { lines: parsed.data.lines });
  if (!result.ok) return result;

  revalidatePurchaseOrderSurfaces(parsed.data.id);
  return { ok: true, movementCount: result.movementCount };
}
