"use server";

/**
 * Stock movement Server Actions — receive, adjust, count. Roadmap 3.2.
 *
 * Every one of these re-checks `inventory.adjust` itself, regardless of
 * what the form that called it was allowed to render (§41: hiding a button
 * is not authorization). Kept separate from `actions.ts`, which owns
 * ingredient/supplier/price master data on `purchasing.manage`.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { unitEnum } from "@/db/schema/inventory";
import { explain, type InventoryFormState } from "@/lib/inventory/actions";
import { fromBaseUnits, unitLabel } from "@/lib/iq/units";
import { fromRupees } from "@/lib/money";
import { adjustStock, countStock, receiveStock } from "@/lib/repositories/stock";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value));

const optionalUuid = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value))
  .pipe(z.uuid().nullable());

const notPack = z.enum(unitEnum.enumValues).refine((unit) => unit !== "PACK", "A pack has no fixed size — enter what's in it instead.");

function revalidateIngredient(ingredientId: string): void {
  revalidatePath("/app/inventory");
  revalidatePath(`/app/inventory/ingredients/${ingredientId}`);
}

/* ------------------------------------------------------------------ */
/* Receive                                                             */
/* ------------------------------------------------------------------ */

const receiveSchema = z.object({
  ingredientId: z.uuid(),
  purchaseQuantity: z
    .string()
    .trim()
    .regex(/^\d+$/, "Quantity must be a whole number — 10 kg, not 9.5.")
    .refine((value) => Number(value) > 0, "Quantity must be more than zero."),
  purchaseUnit: notPack,
  purchaseCost: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter what you paid, like 2800 or 2800.50.")
    .refine((value) => Number(value) > 0, "The price must be more than zero."),
  supplierId: optionalUuid,
  notes: optionalText(300),
});

export async function receiveStockAction(_previous: InventoryFormState, formData: FormData): Promise<InventoryFormState> {
  const parsed = receiveSchema.safeParse({
    ingredientId: String(formData.get("ingredientId") ?? ""),
    purchaseQuantity: String(formData.get("purchaseQuantity") ?? ""),
    purchaseUnit: String(formData.get("purchaseUnit") ?? ""),
    purchaseCost: String(formData.get("purchaseCost") ?? ""),
    supplierId: String(formData.get("supplierId") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };

  let staff;
  try {
    staff = await requirePermission("inventory.adjust");
  } catch (error) {
    return explain(error);
  }

  const result = await receiveStock(staff.orgId, staff.userId, {
    ingredientId: parsed.data.ingredientId,
    purchaseQuantity: Number(parsed.data.purchaseQuantity),
    purchaseUnit: parsed.data.purchaseUnit,
    purchaseCost: fromRupees(parsed.data.purchaseCost),
    supplierId: parsed.data.supplierId,
    notes: parsed.data.notes,
  });
  if (!result.ok) return { status: "error", message: result.error };

  revalidateIngredient(parsed.data.ingredientId);
  return { status: "success", message: `Received ${parsed.data.purchaseQuantity} ${unitLabel(parsed.data.purchaseUnit)}. Stock and price updated.` };
}

/* ------------------------------------------------------------------ */
/* Adjust                                                              */
/* ------------------------------------------------------------------ */

const adjustSchema = z.object({
  ingredientId: z.uuid(),
  direction: z.enum(["ADD", "REMOVE"]),
  quantity: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, "Quantity should be a number like 9.4.")
    .refine((value) => Number(value) > 0, "Quantity must be more than zero."),
  unit: notPack,
  notes: z.string().trim().min(1, "Say why you're adjusting stock.").max(300),
});

export async function adjustStockAction(_previous: InventoryFormState, formData: FormData): Promise<InventoryFormState> {
  const parsed = adjustSchema.safeParse({
    ingredientId: String(formData.get("ingredientId") ?? ""),
    direction: String(formData.get("direction") ?? ""),
    quantity: String(formData.get("quantity") ?? ""),
    unit: String(formData.get("unit") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };

  let staff;
  try {
    staff = await requirePermission("inventory.adjust");
  } catch (error) {
    return explain(error);
  }

  const result = await adjustStock(staff.orgId, staff.userId, {
    ingredientId: parsed.data.ingredientId,
    direction: parsed.data.direction,
    quantity: parsed.data.quantity,
    unit: parsed.data.unit,
    notes: parsed.data.notes,
  });
  if (!result.ok) return { status: "error", message: result.error };

  revalidateIngredient(parsed.data.ingredientId);
  const sign = parsed.data.direction === "REMOVE" ? "-" : "+";
  return { status: "success", message: `Adjusted ${sign}${parsed.data.quantity} ${unitLabel(parsed.data.unit)}.` };
}

/* ------------------------------------------------------------------ */
/* Count                                                               */
/* ------------------------------------------------------------------ */

const countSchema = z.object({
  ingredientId: z.uuid(),
  countedQuantity: z.string().trim().regex(/^\d+(\.\d+)?$/, "Counted quantity should be a number like 9.4."),
  unit: notPack,
  notes: optionalText(300),
});

export async function countStockAction(_previous: InventoryFormState, formData: FormData): Promise<InventoryFormState> {
  const parsed = countSchema.safeParse({
    ingredientId: String(formData.get("ingredientId") ?? ""),
    countedQuantity: String(formData.get("countedQuantity") ?? ""),
    unit: String(formData.get("unit") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };

  let staff;
  try {
    staff = await requirePermission("inventory.adjust");
  } catch (error) {
    return explain(error);
  }

  const result = await countStock(staff.orgId, staff.userId, {
    ingredientId: parsed.data.ingredientId,
    countedQuantity: parsed.data.countedQuantity,
    unit: parsed.data.unit,
    notes: parsed.data.notes,
  });
  if (!result.ok) return { status: "error", message: result.error };

  revalidateIngredient(parsed.data.ingredientId);
  if (result.delta === 0) {
    return { status: "success", message: "Count matches — no adjustment needed." };
  }
  const magnitude = fromBaseUnits(Math.abs(result.delta), parsed.data.unit);
  const sign = result.delta < 0 ? "-" : "+";
  return { status: "success", message: `Counted ${parsed.data.countedQuantity} ${unitLabel(parsed.data.unit)}. Recorded ${sign}${magnitude} ${unitLabel(parsed.data.unit)}.` };
}
