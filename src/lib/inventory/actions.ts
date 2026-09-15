"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { NotPermitted, NotSignedIn, requirePermission } from "@/lib/auth";
import { bps, formatINR, fromRupees } from "@/lib/money";
import { unitEnum } from "@/db/schema/inventory";
import {
  createIngredient,
  createSupplier,
  isKnownBaseUnit,
  recordIngredientPrice,
  updateIngredient,
  updateSupplier,
} from "@/lib/repositories/inventory";

export type InventoryFormState = { status: "idle" } | { status: "error"; message: string } | { status: "success"; message: string };

/** Auth failures become a sentence, not a stack trace (§57). Anything else is a real bug and is rethrown. */
function explain(error: unknown): InventoryFormState {
  if (error instanceof NotSignedIn) return { status: "error", message: "You've been signed out. Sign in again." };
  if (error instanceof NotPermitted) return { status: "error", message: "You don't have permission to change inventory." };
  throw error;
}

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

const percent = (label: string, { min, maxExclusive }: { min: number; maxExclusive: number }) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,3}(\.\d)?$/, `${label} should be a percentage like 80 or 82.5.`)
    .refine((value) => Number(value) >= min && Number(value) < maxExclusive, `${label} must be from ${min}% up to but not including ${maxExclusive}%.`);

const supplierSchema = z.object({
  id: optionalUuid,
  name: z.string().trim().min(1, "Give the supplier a name.").max(120),
  phone: optionalText(30),
  email: z.union([z.literal(""), z.email("Enter a valid email address.")]).transform((value) => (value === "" ? null : value)),
  gstin: optionalText(15),
  address: optionalText(300),
  isActive: z.string().optional().transform((value) => value === "on"),
});

export async function saveSupplierAction(_previous: InventoryFormState, formData: FormData): Promise<InventoryFormState> {
  const parsed = supplierSchema.safeParse({
    id: String(formData.get("id") ?? ""),
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    email: String(formData.get("email") ?? ""),
    gstin: String(formData.get("gstin") ?? ""),
    address: String(formData.get("address") ?? ""),
    isActive: formData.get("isActive") === null ? undefined : String(formData.get("isActive")),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };

  let staff;
  try {
    staff = await requirePermission("purchasing.manage");
  } catch (error) {
    return explain(error);
  }

  const { id, ...input } = parsed.data;
  if (id) {
    const found = await updateSupplier(staff.orgId, staff.userId, id, input);
    if (!found) return { status: "error", message: "That supplier no longer exists." };
    revalidatePath("/app/inventory/suppliers");
    return { status: "success", message: "Supplier saved." };
  }
  await createSupplier(staff.orgId, staff.userId, input);
  revalidatePath("/app/inventory/suppliers");
  redirect("/app/inventory/suppliers?saved=1");
}

const ingredientSchema = z.object({
  id: optionalUuid,
  name: z.string().trim().min(1, "Give the ingredient a name.").max(120),
  sku: optionalText(40),
  baseUnit: z.string().refine(isKnownBaseUnit, "Choose grams, millilitres or pieces."),
  yieldPct: percent("Yield", { min: 1, maxExclusive: 101 }),
  wastePct: percent("Waste", { min: 0, maxExclusive: 100 }),
  supplierId: optionalUuid,
  isPackaging: z.string().optional().transform((value) => value === "on"),
  isActive: z.string().optional().transform((value) => value === "on"),
});

export async function saveIngredientAction(_previous: InventoryFormState, formData: FormData): Promise<InventoryFormState> {
  const parsed = ingredientSchema.safeParse({
    id: String(formData.get("id") ?? ""),
    name: String(formData.get("name") ?? ""),
    sku: String(formData.get("sku") ?? ""),
    baseUnit: String(formData.get("baseUnit") ?? ""),
    yieldPct: String(formData.get("yieldPct") ?? "100"),
    wastePct: String(formData.get("wastePct") ?? "0"),
    supplierId: String(formData.get("supplierId") ?? ""),
    isPackaging: formData.get("isPackaging") === null ? undefined : String(formData.get("isPackaging")),
    isActive: formData.get("isActive") === null ? undefined : String(formData.get("isActive")),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };

  let staff;
  try {
    staff = await requirePermission("purchasing.manage");
  } catch (error) {
    return explain(error);
  }

  const { id, yieldPct, wastePct, baseUnit, ...rest } = parsed.data;
  if (!isKnownBaseUnit(baseUnit)) return { status: "error", message: "Choose grams, millilitres or pieces." };
  const input = { ...rest, baseUnit, yieldBps: bps(Number(yieldPct)), wasteBps: bps(Number(wastePct)) };

  if (id) {
    const result = await updateIngredient(staff.orgId, staff.userId, id, input);
    if (!result.ok) return { status: "error", message: result.error };
    revalidatePath("/app/inventory");
    revalidatePath(`/app/inventory/ingredients/${id}`);
    return { status: "success", message: "Ingredient saved." };
  }
  const created = await createIngredient(staff.orgId, staff.userId, input);
  revalidatePath("/app/inventory");
  redirect(`/app/inventory/ingredients/${created.id}?created=1`);
}

const priceSchema = z.object({
  ingredientId: z.uuid(),
  purchaseQuantity: z
    .string()
    .trim()
    .regex(/^\d+$/, "Quantity must be a whole number — 10 kg, not 9.5.")
    .refine((value) => Number(value) > 0, "Quantity must be more than zero."),
  purchaseUnit: z.enum(unitEnum.enumValues).refine((unit) => unit !== "PACK", "A pack has no fixed size — enter what's in it instead."),
  purchaseCost: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter what you paid, like 2800 or 2800.50.")
    .refine((value) => Number(value) > 0, "The price must be more than zero."),
  supplierId: optionalUuid,
});

export async function recordPriceAction(_previous: InventoryFormState, formData: FormData): Promise<InventoryFormState> {
  const parsed = priceSchema.safeParse({
    ingredientId: String(formData.get("ingredientId") ?? ""),
    purchaseQuantity: String(formData.get("purchaseQuantity") ?? ""),
    purchaseUnit: String(formData.get("purchaseUnit") ?? ""),
    purchaseCost: String(formData.get("purchaseCost") ?? ""),
    supplierId: String(formData.get("supplierId") ?? ""),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };

  let staff;
  try {
    staff = await requirePermission("purchasing.manage");
  } catch (error) {
    return explain(error);
  }

  const result = await recordIngredientPrice(staff.orgId, staff.userId, {
    ingredientId: parsed.data.ingredientId,
    purchaseQuantity: Number(parsed.data.purchaseQuantity),
    purchaseUnit: parsed.data.purchaseUnit,
    purchaseCost: fromRupees(parsed.data.purchaseCost),
    supplierId: parsed.data.supplierId,
  });
  if (!result.ok) return { status: "error", message: result.error };

  revalidatePath("/app/inventory");
  revalidatePath(`/app/inventory/ingredients/${parsed.data.ingredientId}`);
  return { status: "success", message: `Recorded. Usable cost is now ${formatINR(result.rate)} per unit.` };
}
