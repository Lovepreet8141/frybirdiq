"use server";

/**
 * Server Actions for the FRYBIRD IQ Menu Manager.
 *
 * Every action re-checks its own permission — `menu.edit` for most of this,
 * `menu.price` for anything that changes what a customer pays, `menu.publish`
 * for the moment a draft goes live — the same division `src/domain/permissions.ts`
 * already draws between MANAGER (edits) and OWNER/ADMIN (prices, publishes).
 * Rendering a screen is never the check; the action is. §41.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { NotPermitted, NotSignedIn, requirePermission } from "@/lib/auth";
import { fromRupees } from "@/lib/money";
import {
  CrossOrgReference,
  addComboItem,
  addModifier,
  createBareRecipe,
  createCategory,
  createModifierGroup,
  createProduct,
  deleteAvailabilityRule,
  deleteCategory,
  deleteCategoryAvailabilityRule,
  deleteModifier,
  deleteModifierGroup,
  duplicateProduct,
  listDraftItems,
  moveCategory,
  moveProductPosition,
  moveProductToCategory,
  publishCategory,
  publishModifierGroup,
  publishProduct,
  removeComboItem,
  setAvailabilityRule,
  setCategoryActive,
  setCategoryAvailabilityRule,
  setProductActive,
  setProductImages,
  setProductModifierGroups,
  updateCategory,
  updateModifier,
  updateModifierGroup,
  updateProductDetails,
  updateProductPrice,
} from "@/lib/repositories/menu-admin";
import { deleteMedia, uploadMedia } from "@/lib/repositories/media";
import { AVAILABILITY_STATUSES } from "@/domain/menu-availability";
import { MENU_VISIBILITY_CHANNELS, UNAVAILABLE_REASON_PRESETS, type ReactivationPreset } from "./constants";

export interface ActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

function explain(error: unknown): ActionResult {
  if (error instanceof NotSignedIn) return { ok: false, error: "You've been signed out. Sign in again." };
  if (error instanceof NotPermitted) return { ok: false, error: "You don't have permission to do that." };
  // A crafted id that doesn't belong to this organization — the dropdowns
  // never offer one, so this only fires against a request built by hand.
  if (error instanceof CrossOrgReference) return { ok: false, error: "That could not be found." };
  throw error;
}

function revalidateMenu() {
  revalidatePath("/app/iq/menu");
  revalidatePath("/menu");
}

const slugField = z
  .string()
  .trim()
  .min(1, "Needs a slug.")
  .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers and hyphens only.");

/* ---------------------------------- Categories ---------------------------------- */

const categorySchema = z.object({
  name: z.string().trim().min(1, "Needs a name."),
  slug: slugField,
  description: z.string().trim().max(500).optional(),
  imageUrl: z.string().trim().url().optional().or(z.literal("")),
});

export async function createCategoryAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = categorySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };

  try {
    const staff = await requirePermission("menu.edit");
    await createCategory(staff.orgId, {
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description || null,
      imageUrl: parsed.data.imageUrl || null,
    });
    revalidateMenu();
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

export async function updateCategoryAction(id: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = categorySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };

  try {
    const staff = await requirePermission("menu.edit");
    await updateCategory(
      staff.orgId,
      id,
      {
        name: parsed.data.name,
        slug: parsed.data.slug,
        description: parsed.data.description || null,
        imageUrl: parsed.data.imageUrl || null,
      },
      staff.userId,
    );
    revalidateMenu();
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

export async function setCategoryActiveAction(id: string, isActive: boolean): Promise<ActionResult> {
  try {
    const staff = await requirePermission("menu.edit");
    await setCategoryActive(staff.orgId, id, isActive, staff.userId);
    revalidateMenu();
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

export async function publishCategoryAction(id: string): Promise<ActionResult> {
  try {
    const staff = await requirePermission("menu.publish");
    await publishCategory(staff.orgId, id, staff.userId);
    revalidateMenu();
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

export async function deleteCategoryAction(id: string): Promise<ActionResult> {
  try {
    const staff = await requirePermission("menu.edit");
    const result = await deleteCategory(staff.orgId, id);
    revalidateMenu();
    return result;
  } catch (error) {
    return explain(error);
  }
}

export async function moveCategoryAction(id: string, direction: "up" | "down"): Promise<ActionResult> {
  try {
    const staff = await requirePermission("menu.edit");
    await moveCategory(staff.orgId, id, direction);
    revalidateMenu();
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

/* ---------------------------------- Products ---------------------------------- */

const productDetailsSchema = z.object({
  name: z.string().trim().min(1, "Needs a name."),
  slug: slugField,
  description: z.string().trim().max(2000).optional(),
  shortDescription: z.string().trim().max(200).optional(),
  categoryId: z.string().trim().uuid().optional().or(z.literal("")),
  taxRateId: z.string().trim().uuid().optional().or(z.literal("")),
  spiceLevel: z.coerce.number().int().min(0).max(5),
  isVegetarian: z.coerce.boolean(),
  allergens: z.string().optional(),
  tags: z.string().optional(),
  sku: z.string().trim().max(60).optional(),
  prepMinutes: z.coerce.number().int().min(0).max(240).optional().or(z.literal("")),
  kdsStation: z.string().trim().max(60).optional(),
  servingInfo: z.string().trim().max(100).optional(),
});

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export interface CreateProductResult extends ActionResult {
  readonly id?: string;
}

export async function createProductAction(_prev: CreateProductResult, formData: FormData): Promise<CreateProductResult> {
  const parsed = productDetailsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };

  try {
    const staff = await requirePermission("menu.edit");
    const { id } = await createProduct(staff.orgId, {
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description || null,
      shortDescription: parsed.data.shortDescription || null,
      categoryId: parsed.data.categoryId || null,
      taxRateId: parsed.data.taxRateId || null,
      spiceLevel: parsed.data.spiceLevel,
      isVegetarian: parsed.data.isVegetarian,
      allergens: splitList(parsed.data.allergens),
      tags: splitList(parsed.data.tags),
      sku: parsed.data.sku || null,
      prepMinutes: parsed.data.prepMinutes === "" ? null : (parsed.data.prepMinutes ?? null),
      kdsStation: parsed.data.kdsStation || null,
      servingInfo: parsed.data.servingInfo || null,
    });
    revalidateMenu();
    return { ok: true, id };
  } catch (error) {
    return explain(error);
  }
}

export async function updateProductDetailsAction(id: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = productDetailsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };

  try {
    const staff = await requirePermission("menu.edit");
    await updateProductDetails(
      staff.orgId,
      id,
      {
        name: parsed.data.name,
        slug: parsed.data.slug,
        description: parsed.data.description || null,
        shortDescription: parsed.data.shortDescription || null,
        categoryId: parsed.data.categoryId || null,
        taxRateId: parsed.data.taxRateId || null,
        spiceLevel: parsed.data.spiceLevel,
        isVegetarian: parsed.data.isVegetarian,
        allergens: splitList(parsed.data.allergens),
        tags: splitList(parsed.data.tags),
        sku: parsed.data.sku || null,
        prepMinutes: parsed.data.prepMinutes === "" ? null : (parsed.data.prepMinutes ?? null),
        kdsStation: parsed.data.kdsStation || null,
        servingInfo: parsed.data.servingInfo || null,
      },
      staff.userId,
    );
    revalidateMenu();
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

const priceSchema = z.object({
  basePrice: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 249 or 249.50."),
});

export async function updateProductPriceAction(id: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = priceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };

  try {
    const staff = await requirePermission("menu.price");
    await updateProductPrice(staff.orgId, id, fromRupees(parsed.data.basePrice), staff.userId);
    revalidateMenu();
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

export async function setProductActiveAction(id: string, isActive: boolean): Promise<ActionResult> {
  try {
    const staff = await requirePermission("menu.edit");
    await setProductActive(staff.orgId, id, isActive, staff.userId);
    revalidateMenu();
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

export async function publishProductAction(id: string): Promise<ActionResult> {
  try {
    const staff = await requirePermission("menu.publish");
    await publishProduct(staff.orgId, id, staff.userId);
    revalidateMenu();
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

/** Clones a product as a new draft — the product list/card's "Duplicate" action. */
export async function duplicateProductAction(id: string): Promise<CreateProductResult> {
  try {
    const staff = await requirePermission("menu.edit");
    const { id: newId } = await duplicateProduct(staff.orgId, id);
    revalidateMenu();
    return { ok: true, id: newId };
  } catch (error) {
    return explain(error);
  }
}

export async function moveProductPositionAction(id: string, direction: "up" | "down"): Promise<ActionResult> {
  try {
    const staff = await requirePermission("menu.edit");
    await moveProductPosition(staff.orgId, id, direction);
    revalidateMenu();
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

/** The product list's quick "move to category" dropdown — reassigns without opening the full editor. */
export async function moveProductToCategoryAction(id: string, categoryId: string | null): Promise<ActionResult> {
  try {
    const staff = await requirePermission("menu.edit");
    await moveProductToCategory(staff.orgId, id, categoryId, staff.userId);
    revalidateMenu();
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

export async function setProductModifierGroupsAction(id: string, groupIds: readonly string[]): Promise<ActionResult> {
  try {
    const staff = await requirePermission("menu.edit");
    await setProductModifierGroups(staff.orgId, id, groupIds);
    revalidateMenu();
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

export async function setProductImagesAction(id: string, images: readonly { url: string; alt: string }[]): Promise<ActionResult> {
  try {
    const staff = await requirePermission("menu.edit");
    await setProductImages(staff.orgId, id, images);
    revalidateMenu();
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

/* ---------------------------------- Media ---------------------------------- */

export type MediaUploadResult = { ok: true; id: string; url: string } | { ok: false; error: string };

export async function uploadMediaAction(formData: FormData): Promise<MediaUploadResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an image first." };

  try {
    const staff = await requirePermission("menu.edit");
    const result = await uploadMedia({ orgId: staff.orgId, uploadedBy: staff.userId, file, alt: String(formData.get("alt") ?? "") });
    if (!result.ok) return result;
    revalidatePath("/app/iq/menu/products", "layout");
    revalidatePath("/app/iq/menu/media");
    return result;
  } catch (error) {
    const explained = explain(error);
    return { ok: false, error: explained.error ?? "Something went wrong." };
  }
}

/** The media library's "delete" action — refused by `deleteMedia` itself while any product still uses the photo. */
export async function deleteMediaAction(id: string): Promise<ActionResult> {
  try {
    const staff = await requirePermission("menu.edit");
    const result = await deleteMedia(staff.orgId, id);
    revalidatePath("/app/iq/menu/media");
    return result;
  } catch (error) {
    return explain(error);
  }
}

/* ---------------------------------- Modifier groups ---------------------------------- */

const groupSchema = z.object({
  name: z.string().trim().min(1, "Needs a name."),
  slug: slugField,
  description: z.string().trim().max(500).optional(),
  minSelections: z.coerce.number().int().min(0).max(20),
  maxSelections: z.coerce.number().int().min(1).max(20).optional().or(z.literal("")),
});

export interface CreateGroupResult extends ActionResult {
  readonly id?: string;
}

export async function createModifierGroupAction(_prev: CreateGroupResult, formData: FormData): Promise<CreateGroupResult> {
  const parsed = groupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };

  try {
    const staff = await requirePermission("menu.edit");
    const { id } = await createModifierGroup(staff.orgId, {
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description || null,
      minSelections: parsed.data.minSelections,
      maxSelections: parsed.data.maxSelections === "" ? null : (parsed.data.maxSelections ?? null),
    });
    revalidateMenu();
    return { ok: true, id };
  } catch (error) {
    return explain(error);
  }
}

export async function updateModifierGroupAction(id: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = groupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };

  try {
    const staff = await requirePermission("menu.edit");
    await updateModifierGroup(staff.orgId, id, {
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description || null,
      minSelections: parsed.data.minSelections,
      maxSelections: parsed.data.maxSelections === "" ? null : (parsed.data.maxSelections ?? null),
    });
    revalidateMenu();
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

export async function publishModifierGroupAction(id: string): Promise<ActionResult> {
  try {
    const staff = await requirePermission("menu.publish");
    await publishModifierGroup(staff.orgId, id);
    revalidateMenu();
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

/** The Review Changes screen's "Publish all changes" — every current draft, one permission check. */
export async function publishAllDraftsAction(): Promise<ActionResult> {
  try {
    const staff = await requirePermission("menu.publish");
    const drafts = await listDraftItems(staff.orgId);
    for (const item of drafts) {
      if (item.kind === "category") await publishCategory(staff.orgId, item.id, staff.userId);
      else if (item.kind === "product") await publishProduct(staff.orgId, item.id, staff.userId);
      else await publishModifierGroup(staff.orgId, item.id);
    }
    revalidateMenu();
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

export async function deleteModifierGroupAction(id: string): Promise<ActionResult> {
  try {
    const staff = await requirePermission("menu.edit");
    const result = await deleteModifierGroup(staff.orgId, id);
    revalidateMenu();
    return result;
  } catch (error) {
    return explain(error);
  }
}

const modifierSchema = z.object({
  name: z.string().trim().min(1, "Needs a name."),
  slug: slugField,
  priceDelta: z.string().trim().regex(/^-?\d+(\.\d{1,2})?$/, "Enter an amount like 0, 30 or -20."),
  isDefault: z.coerce.boolean(),
  isAvailable: z.coerce.boolean(),
});

export async function addModifierAction(groupId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = modifierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };

  try {
    const staff = await requirePermission("menu.edit");
    await addModifier(staff.orgId, groupId, {
      name: parsed.data.name,
      slug: parsed.data.slug,
      priceDelta: fromRupees(parsed.data.priceDelta),
      isDefault: parsed.data.isDefault,
      isAvailable: parsed.data.isAvailable,
    });
    revalidateMenu();
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

export async function updateModifierAction(id: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = modifierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };

  try {
    const staff = await requirePermission("menu.edit");
    await updateModifier(staff.orgId, id, {
      name: parsed.data.name,
      slug: parsed.data.slug,
      priceDelta: fromRupees(parsed.data.priceDelta),
      isDefault: parsed.data.isDefault,
      isAvailable: parsed.data.isAvailable,
    });
    revalidateMenu();
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

export async function deleteModifierAction(id: string): Promise<ActionResult> {
  try {
    const staff = await requirePermission("menu.edit");
    await deleteModifier(staff.orgId, id);
    revalidateMenu();
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

/* ---------------------------------- Combos ---------------------------------- */

export async function addComboItemAction(comboProductId: string, productId: string, quantity: number): Promise<ActionResult> {
  try {
    const staff = await requirePermission("menu.edit");
    await addComboItem(staff.orgId, comboProductId, productId, quantity);
    revalidateMenu();
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

export async function removeComboItemAction(id: string): Promise<ActionResult> {
  try {
    const staff = await requirePermission("menu.edit");
    await removeComboItem(staff.orgId, id);
    revalidateMenu();
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

/* ---------------------------------- Availability ---------------------------------- */

const availabilitySchema = z.object({
  locationId: z.string().trim().uuid().optional().or(z.literal("")),
  channel: z.enum(MENU_VISIBILITY_CHANNELS).optional().or(z.literal("")),
  status: z.enum(AVAILABILITY_STATUSES),
  unavailableUntil: z.string().trim().optional(),
  reason: z.string().trim().max(200).optional(),
});

export async function setAvailabilityRuleAction(productId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = availabilitySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };

  try {
    const staff = await requirePermission("menu.edit");
    await setAvailabilityRule(
      staff.orgId,
      productId,
      {
        locationId: parsed.data.locationId || null,
        channel: parsed.data.channel || null,
        status: parsed.data.status,
        unavailableUntil: parsed.data.unavailableUntil ? new Date(parsed.data.unavailableUntil) : null,
        reason: parsed.data.reason || null,
      },
      staff.userId,
    );
    revalidateMenu();
    revalidatePath("/app/pos");
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

export async function deleteAvailabilityRuleAction(id: string): Promise<ActionResult> {
  try {
    const staff = await requirePermission("menu.edit");
    await deleteAvailabilityRule(staff.orgId, id);
    revalidateMenu();
    revalidatePath("/app/pos");
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

/**
 * The product row/card's one-tap "mark sold out" / "make available" action —
 * a thin, opinionated wrapper over `setAvailabilityRule` that turns a
 * reactivation preset into the right status + timestamp, reusing the exact
 * domain rules already tested in `src/domain/menu-availability.test.ts`
 * rather than inventing a second scheduling concept:
 *
 *   "2h"/"4h"/"custom" -> SCHEDULED_UNAVAILABLE, back at that instant
 *   "tomorrow"         -> SOLD_OUT_TODAY, which already expires at the next
 *                          business-date rollover — exactly "tomorrow"
 *   "indefinite"        -> TEMPORARILY_UNAVAILABLE, no auto-reactivation
 *
 * Always the wildcard rule (every location, every channel) — "sold out" at
 * the counter almost always means sold out everywhere; a manager who wants
 * a channel-specific exception still has the full availability form.
 */
export async function quickSetAvailabilityAction(input: {
  productId: string;
  reason: (typeof UNAVAILABLE_REASON_PRESETS)[number];
  customReason?: string;
  reactivation: ReactivationPreset;
  customUntil?: string;
}): Promise<ActionResult> {
  try {
    const staff = await requirePermission("menu.edit");

    const reason = input.reason === "Other" ? (input.customReason?.trim() || "Other") : input.reason;
    const now = Date.now();
    const { status, unavailableUntil } = ((): { status: (typeof AVAILABILITY_STATUSES)[number]; unavailableUntil: Date | null } => {
      switch (input.reactivation) {
        case "2h":
          return { status: "SCHEDULED_UNAVAILABLE", unavailableUntil: new Date(now + 2 * 60 * 60 * 1000) };
        case "4h":
          return { status: "SCHEDULED_UNAVAILABLE", unavailableUntil: new Date(now + 4 * 60 * 60 * 1000) };
        case "custom":
          return { status: "SCHEDULED_UNAVAILABLE", unavailableUntil: input.customUntil ? new Date(input.customUntil) : null };
        case "tomorrow":
          return { status: "SOLD_OUT_TODAY", unavailableUntil: null };
        case "indefinite":
          return { status: "TEMPORARILY_UNAVAILABLE", unavailableUntil: null };
      }
    })();

    await setAvailabilityRule(staff.orgId, input.productId, { locationId: null, channel: null, status, unavailableUntil, reason }, staff.userId);
    revalidateMenu();
    revalidatePath("/app/pos");
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

/** The row/card's "make available" quick action — clears the wildcard rule back to AVAILABLE. */
export async function quickMarkAvailableAction(productId: string): Promise<ActionResult> {
  try {
    const staff = await requirePermission("menu.edit");
    await setAvailabilityRule(staff.orgId, productId, { locationId: null, channel: null, status: "AVAILABLE", unavailableUntil: null, reason: null }, staff.userId);
    revalidateMenu();
    revalidatePath("/app/pos");
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

/* ---------------------------------- Category availability ---------------------------------- */

const categoryAvailabilitySchema = z.object({
  channel: z.enum(MENU_VISIBILITY_CHANNELS).optional().or(z.literal("")),
  status: z.enum(AVAILABILITY_STATUSES),
  unavailableUntil: z.string().trim().optional(),
  reason: z.string().trim().max(200).optional(),
});

export async function setCategoryAvailabilityRuleAction(categoryId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = categoryAvailabilitySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };

  try {
    const staff = await requirePermission("menu.edit");
    await setCategoryAvailabilityRule(
      staff.orgId,
      categoryId,
      {
        channel: parsed.data.channel || null,
        status: parsed.data.status,
        unavailableUntil: parsed.data.unavailableUntil ? new Date(parsed.data.unavailableUntil) : null,
        reason: parsed.data.reason || null,
      },
      staff.userId,
    );
    revalidateMenu();
    revalidatePath("/app/pos");
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

export async function deleteCategoryAvailabilityRuleAction(id: string): Promise<ActionResult> {
  try {
    const staff = await requirePermission("menu.edit");
    await deleteCategoryAvailabilityRule(staff.orgId, id);
    revalidateMenu();
    revalidatePath("/app/pos");
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

/* ---------------------------------- Recipe ---------------------------------- */

export async function createBareRecipeAction(productId: string, yieldQuantity: number): Promise<ActionResult> {
  try {
    const staff = await requirePermission("recipes.edit");
    await createBareRecipe(staff.orgId, productId, yieldQuantity);
    revalidateMenu();
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}
