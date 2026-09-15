"use server";

/**
 * Record-waste Server Action. Roadmap 3.3.
 *
 * Re-checks `inventory.waste` itself, regardless of what the page that
 * called it decided to render (§41: hiding a button is not authorization).
 * Kept separate from `stock-actions.ts` (receive/adjust/count, gated on
 * `inventory.adjust`) because it is gated on a different permission that a
 * different set of roles holds — KITCHEN has `inventory.waste` but not
 * `inventory.adjust` or `inventory.view` (`domain/permissions.ts`).
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { NotPermitted, NotSignedIn, requirePermission } from "@/lib/auth";
import { unitEnum, wasteReasonEnum } from "@/db/schema/inventory";
import { type InventoryFormState } from "@/lib/inventory/actions";
import { unitLabel } from "@/lib/iq/units";
import { recordWaste } from "@/lib/repositories/stock";

/** Auth failures become a sentence, not a stack trace (§57). Anything else is a real bug and is rethrown. */
function explain(error: unknown): InventoryFormState {
  if (error instanceof NotSignedIn) return { status: "error", message: "You've been signed out. Sign in again." };
  if (error instanceof NotPermitted) return { status: "error", message: "You don't have permission to record waste." };
  throw error;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value));

const notPack = z.enum(unitEnum.enumValues).refine((unit) => unit !== "PACK", "A pack has no fixed size — enter what's in it instead.");

const wasteSchema = z.object({
  ingredientId: z.uuid(),
  quantity: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, "Quantity should be a number like 0.6.")
    .refine((value) => Number(value) > 0, "Quantity must be more than zero."),
  unit: notPack,
  reason: z.enum(wasteReasonEnum.enumValues),
  notes: optionalText(300),
});

export async function recordWasteAction(_previous: InventoryFormState, formData: FormData): Promise<InventoryFormState> {
  const parsed = wasteSchema.safeParse({
    ingredientId: String(formData.get("ingredientId") ?? ""),
    quantity: String(formData.get("quantity") ?? ""),
    unit: String(formData.get("unit") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };

  let staff;
  try {
    staff = await requirePermission("inventory.waste");
  } catch (error) {
    return explain(error);
  }

  const result = await recordWaste(staff.orgId, staff.userId, {
    ingredientId: parsed.data.ingredientId,
    quantity: parsed.data.quantity,
    unit: parsed.data.unit,
    reason: parsed.data.reason,
    notes: parsed.data.notes,
  });
  if (!result.ok) return { status: "error", message: result.error };

  // Every surface a waste entry can show up on: its own recording page, the
  // ingredient's own movement history, and the inventory dashboard's
  // week-of-waste total.
  revalidatePath("/app/inventory/waste");
  revalidatePath("/app/inventory");
  revalidatePath(`/app/inventory/ingredients/${parsed.data.ingredientId}`);

  return { status: "success", message: `Recorded ${parsed.data.quantity} ${unitLabel(parsed.data.unit)} wasted.` };
}
