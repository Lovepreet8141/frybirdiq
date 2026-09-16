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
import { NotPermitted, NotSignedIn, requirePermission } from "@/lib/auth";
import { unitEnum } from "@/db/schema/inventory";
import { type InventoryFormState } from "@/lib/inventory/actions";
import { fromBaseUnits, unitLabel } from "@/lib/iq/units";
import { fromRupees } from "@/lib/money";
import { IdempotencyConflict } from "@/lib/repositories/idempotency";

/** Auth failures become a sentence, not a stack trace (§57). Anything else is a real bug and is rethrown. */
function explain(error: unknown): InventoryFormState {
  if (error instanceof NotSignedIn) return { status: "error", message: "You've been signed out. Sign in again." };
  if (error instanceof NotPermitted) return { status: "error", message: "You don't have permission to change inventory." };
  throw error;
}

/**
 * A stock-write failure that isn't a validation refusal (those come back
 * as an ordinary `{ok:false}` value, not a throw). `IdempotencyConflict`
 * gets its own honest message — same key, content that doesn't match the
 * earlier attempt it's tied to, normally only reachable by editing the
 * form and resubmitting while the first attempt is still in flight, per
 * `useIdempotencyKey`'s own comment in stock-forms.tsx — rather than
 * being lumped in with a genuine network failure.
 */
function explainWriteFailure(error: unknown, noun: string): InventoryFormState {
  if (error instanceof IdempotencyConflict) return { status: "error", message: "That looks like a repeat submission. Check the form and try again." };
  return { status: "error", message: `Couldn't reach the server. Try again — it's safe, this ${noun} can't be recorded twice.` };
}

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
  // Minted once by the form on mount (stock-forms.tsx), carried on every
  // retry of the same submission. A network error or a double-tap resends
  // this same key, and receiveStock's withIdempotency wrap returns the
  // first attempt's result instead of recording the delivery twice.
  idempotencyKey: z.uuid(),
});

export async function receiveStockAction(_previous: InventoryFormState, formData: FormData): Promise<InventoryFormState> {
  const parsed = receiveSchema.safeParse({
    ingredientId: String(formData.get("ingredientId") ?? ""),
    purchaseQuantity: String(formData.get("purchaseQuantity") ?? ""),
    purchaseUnit: String(formData.get("purchaseUnit") ?? ""),
    purchaseCost: String(formData.get("purchaseCost") ?? ""),
    supplierId: String(formData.get("supplierId") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };

  let staff;
  try {
    staff = await requirePermission("inventory.adjust");
  } catch (error) {
    return explain(error);
  }

  let result;
  try {
    result = await receiveStock(
      staff.orgId,
      staff.userId,
      {
        ingredientId: parsed.data.ingredientId,
        purchaseQuantity: Number(parsed.data.purchaseQuantity),
        purchaseUnit: parsed.data.purchaseUnit,
        purchaseCost: fromRupees(parsed.data.purchaseCost),
        supplierId: parsed.data.supplierId,
        notes: parsed.data.notes,
      },
      parsed.data.idempotencyKey,
    );
  } catch (error) {
    // An unhandled throw here would otherwise reach the route's error
    // boundary and remount this form, losing the idempotencyKey React is
    // holding — the one thing that makes "try again" safe. Converting it
    // to a normal error response keeps the form (and the key) exactly
    // where they are, matching the same fix already applied to the POS
    // payment sheet for the same class of risk.
    return explainWriteFailure(error, "delivery");
  }
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
  idempotencyKey: z.uuid(),
});

export async function adjustStockAction(_previous: InventoryFormState, formData: FormData): Promise<InventoryFormState> {
  const parsed = adjustSchema.safeParse({
    ingredientId: String(formData.get("ingredientId") ?? ""),
    direction: String(formData.get("direction") ?? ""),
    quantity: String(formData.get("quantity") ?? ""),
    unit: String(formData.get("unit") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };

  let staff;
  try {
    staff = await requirePermission("inventory.adjust");
  } catch (error) {
    return explain(error);
  }

  let result;
  try {
    result = await adjustStock(
      staff.orgId,
      staff.userId,
      {
        ingredientId: parsed.data.ingredientId,
        direction: parsed.data.direction,
        quantity: parsed.data.quantity,
        unit: parsed.data.unit,
        notes: parsed.data.notes,
      },
      parsed.data.idempotencyKey,
    );
  } catch (error) {
    return explainWriteFailure(error, "adjustment");
  }
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
