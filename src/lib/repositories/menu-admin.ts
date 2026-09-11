import "server-only";

/**
 * Reads and writes for the FRYBIRD IQ Menu Manager.
 *
 * Everything a customer or a cashier ever sees still comes from `getMenu()`
 * in `./menu` — this module is the write side plus the admin-only reads
 * (draft items, every product regardless of status) that screen needs and
 * `getMenu()` deliberately does not serve. No permission checks happen here:
 * every Server Action in `src/lib/menu-admin/actions.ts` calls
 * `requirePermission` before reaching any function below, the same division
 * every other repository in this codebase follows.
 */

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  categories,
  categoryAvailability,
  comboItems,
  menuAuditLog,
  modifierGroups,
  modifiers,
  productAvailability,
  productChannelPrices,
  productModifierGroups,
  products,
  recipeItems,
  recipes,
  taxRates,
} from "@/db/schema";
import { type AvailabilityStatus, resolveAvailability } from "@/domain/menu-availability";
import { businessDate } from "@/lib/dates";
import { type Paise } from "@/lib/money";

/**
 * Thrown when a caller-supplied id resolves to a row belonging to a
 * different organization — a category, tax rate, modifier group or product
 * picked from someone else's data rather than the caller's own.
 *
 * The admin UI only ever offers the caller's own rows in its dropdowns, but
 * every one of these ids arrives at the server as a plain string inside a
 * form submission. A UI that never offers the wrong id is not the same as a
 * server that refuses it — §41. Every write below that accepts a foreign key
 * from client input verifies it against `orgId` itself before touching the
 * database, rather than trusting the id came from a dropdown that was
 * scoped correctly.
 */
export class CrossOrgReference extends Error {
  constructor(what: string) {
    super(`menu-admin: ${what} does not belong to this organization`);
    this.name = "CrossOrgReference";
  }
}

async function assertCategoryOwned(orgId: string, categoryId: string): Promise<void> {
  const [row] = await db().select({ id: categories.id }).from(categories).where(and(eq(categories.id, categoryId), eq(categories.orgId, orgId))).limit(1);
  if (!row) throw new CrossOrgReference("category");
}

async function assertTaxRateOwned(orgId: string, taxRateId: string): Promise<void> {
  const [row] = await db().select({ id: taxRates.id }).from(taxRates).where(and(eq(taxRates.id, taxRateId), eq(taxRates.orgId, orgId))).limit(1);
  if (!row) throw new CrossOrgReference("tax rate");
}

async function assertProductOwned(orgId: string, productId: string): Promise<void> {
  const [row] = await db().select({ id: products.id }).from(products).where(and(eq(products.id, productId), eq(products.orgId, orgId))).limit(1);
  if (!row) throw new CrossOrgReference("product");
}

async function assertModifierGroupOwned(orgId: string, groupId: string): Promise<void> {
  const [row] = await db().select({ id: modifierGroups.id }).from(modifierGroups).where(and(eq(modifierGroups.id, groupId), eq(modifierGroups.orgId, orgId))).limit(1);
  if (!row) throw new CrossOrgReference("modifier group");
}

/* ------------------------------------------------------------------ */
/* Change log — a real, persisted record; never a fake "publish" state */
/* ------------------------------------------------------------------ */

type LoggableValue = string | number | boolean | null;

function stringifyLoggable(value: LoggableValue): string | null {
  if (value === null) return null;
  return typeof value === "string" ? value : String(value);
}

/**
 * Records one field's old and new value against a menu entity. Called from
 * the write functions below, right alongside the update it is describing —
 * never reconstructed after the fact by diffing two reads, which could miss
 * a change made between them.
 *
 * Only fields that actually changed are worth a row; callers pass every
 * candidate field and this filters silently rather than making every call
 * site repeat the `oldValue !== newValue` check.
 */
async function logChanges(input: {
  orgId: string;
  entityType: "category" | "product" | "modifierGroup" | "availability";
  entityId: string;
  entityName: string;
  actorUserId: string | null;
  changes: readonly { field: string; oldValue: LoggableValue; newValue: LoggableValue }[];
}): Promise<void> {
  const rows = input.changes
    .filter((c) => stringifyLoggable(c.oldValue) !== stringifyLoggable(c.newValue))
    .map((c) => ({
      orgId: input.orgId,
      entityType: input.entityType,
      entityId: input.entityId,
      entityName: input.entityName,
      field: c.field,
      oldValue: stringifyLoggable(c.oldValue),
      newValue: stringifyLoggable(c.newValue),
      actorUserId: input.actorUserId,
    }));
  if (rows.length === 0) return;
  await db().insert(menuAuditLog).values(rows);
}

export interface MenuChangeRow {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly entityName: string;
  readonly field: string;
  readonly oldValue: string | null;
  readonly newValue: string | null;
  readonly createdAt: Date;
}

/** The most recent changes across the whole menu, newest first — Review Changes' "what changed" list. */
export async function getRecentChanges(orgId: string, limit = 50): Promise<MenuChangeRow[]> {
  return db()
    .select({
      id: menuAuditLog.id,
      entityType: menuAuditLog.entityType,
      entityId: menuAuditLog.entityId,
      entityName: menuAuditLog.entityName,
      field: menuAuditLog.field,
      oldValue: menuAuditLog.oldValue,
      newValue: menuAuditLog.newValue,
      createdAt: menuAuditLog.createdAt,
    })
    .from(menuAuditLog)
    .where(eq(menuAuditLog.orgId, orgId))
    .orderBy(desc(menuAuditLog.createdAt))
    .limit(limit);
}

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

export interface CategoryAdminRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly position: number;
  readonly isActive: boolean;
  readonly status: "DRAFT" | "PUBLISHED";
  readonly productCount: number;
}

export async function listCategoriesAdmin(orgId: string): Promise<CategoryAdminRow[]> {
  const rows = await db()
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      description: categories.description,
      imageUrl: categories.imageUrl,
      position: categories.position,
      isActive: categories.isActive,
      status: categories.status,
      productCount: sql<number>`count(${products.id})::int`,
    })
    .from(categories)
    .leftJoin(products, eq(products.categoryId, categories.id))
    .where(eq(categories.orgId, orgId))
    .groupBy(categories.id)
    .orderBy(asc(categories.position));
  return rows;
}

export async function getCategoryAdmin(orgId: string, id: string): Promise<CategoryAdminRow | null> {
  const rows = await listCategoriesAdmin(orgId);
  return rows.find((row) => row.id === id) ?? null;
}

export interface CategoryInput {
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
}

export async function createCategory(orgId: string, input: CategoryInput): Promise<{ id: string }> {
  const [max] = await db().select({ position: sql<number>`coalesce(max(${categories.position}), -1)` }).from(categories).where(eq(categories.orgId, orgId));
  const [row] = await db()
    .insert(categories)
    .values({ orgId, ...input, position: (max?.position ?? -1) + 1, status: "DRAFT" })
    .returning({ id: categories.id });
  if (!row) throw new Error("menu-admin: could not create category");
  return row;
}

export async function updateCategory(orgId: string, id: string, input: CategoryInput, actorUserId: string | null = null): Promise<void> {
  const [before] = await db().select({ name: categories.name }).from(categories).where(and(eq(categories.id, id), eq(categories.orgId, orgId))).limit(1);
  await db().update(categories).set({ ...input, updatedAt: new Date() }).where(and(eq(categories.id, id), eq(categories.orgId, orgId)));
  if (before) {
    await logChanges({
      orgId,
      entityType: "category",
      entityId: id,
      entityName: input.name,
      actorUserId,
      changes: [{ field: "name", oldValue: before.name, newValue: input.name }],
    });
  }
}

export async function setCategoryActive(orgId: string, id: string, isActive: boolean, actorUserId: string | null = null): Promise<void> {
  const [before] = await db().select({ name: categories.name, isActive: categories.isActive }).from(categories).where(and(eq(categories.id, id), eq(categories.orgId, orgId))).limit(1);
  await db().update(categories).set({ isActive, updatedAt: new Date() }).where(and(eq(categories.id, id), eq(categories.orgId, orgId)));
  if (before) {
    await logChanges({
      orgId,
      entityType: "category",
      entityId: id,
      entityName: before.name,
      actorUserId,
      changes: [{ field: "active", oldValue: before.isActive, newValue: isActive }],
    });
  }
}

export async function publishCategory(orgId: string, id: string, actorUserId: string | null = null): Promise<void> {
  const [before] = await db().select({ name: categories.name, status: categories.status }).from(categories).where(and(eq(categories.id, id), eq(categories.orgId, orgId))).limit(1);
  await db().update(categories).set({ status: "PUBLISHED", updatedAt: new Date() }).where(and(eq(categories.id, id), eq(categories.orgId, orgId)));
  if (before) {
    await logChanges({
      orgId,
      entityType: "category",
      entityId: id,
      entityName: before.name,
      actorUserId,
      changes: [{ field: "status", oldValue: before.status, newValue: "PUBLISHED" }],
    });
  }
}

/** Refused while a product still references the category — same guard the FK already enforces, checked first for a clean message. */
export async function deleteCategory(orgId: string, id: string): Promise<{ ok: boolean; error?: string }> {
  const [inUse] = await db().select({ id: products.id }).from(products).where(and(eq(products.categoryId, id), eq(products.orgId, orgId))).limit(1);
  if (inUse) return { ok: false, error: "This category still has products in it. Move or delete them first." };
  await db().delete(categories).where(and(eq(categories.id, id), eq(categories.orgId, orgId)));
  return { ok: true };
}

/**
 * Swaps this category's position with its neighbour — the reorder control's
 * "up"/"down" action.
 *
 * The two updates run inside one transaction so a concurrent read (the
 * website's category rail, another admin tab) can never observe the instant
 * between them where both categories briefly hold the same position — the
 * swap is atomic, not two independent writes that happen to run back to
 * back.
 */
export async function moveCategory(orgId: string, id: string, direction: "up" | "down"): Promise<void> {
  const all = await listCategoriesAdmin(orgId);
  const index = all.findIndex((row) => row.id === id);
  if (index === -1) return;
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= all.length) return;

  const a = all[index]!;
  const b = all[swapWith]!;

  await db().transaction(async (tx) => {
    await tx.update(categories).set({ position: b.position, updatedAt: new Date() }).where(and(eq(categories.id, a.id), eq(categories.orgId, orgId)));
    await tx.update(categories).set({ position: a.position, updatedAt: new Date() }).where(and(eq(categories.id, b.id), eq(categories.orgId, orgId)));
  });
}

/* ------------------------------------------------------------------ */
/* Products                                                             */
/* ------------------------------------------------------------------ */

export interface ProductAdminRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly basePrice: Paise;
  readonly isActive: boolean;
  readonly status: "DRAFT" | "PUBLISHED";
  readonly sku: string | null;
  readonly image: string | null;
  readonly isVegetarian: boolean;
  readonly badges: readonly string[];
  readonly hasModifiers: boolean;
  readonly position: number;
  /** Resolved right now, wildcard (every location/channel) — the row/card badge. */
  readonly availabilityStatus: AvailabilityStatus;
}

/**
 * The product list every Menu Manager screen reads — Products, the category
 * view, and the Menu Control Center's card grid all call this one function
 * rather than each assembling its own query, so "what a product's row looks
 * like" cannot drift between screens.
 */
export async function listProductsAdmin(orgId: string, filter?: { search?: string; categoryId?: string }): Promise<ProductAdminRow[]> {
  const database = db();
  const [rows, groupLinks, availabilityRows] = await Promise.all([
    database
      .select({
        id: products.id,
        name: products.name,
        slug: products.slug,
        categoryId: products.categoryId,
        categoryName: categories.name,
        basePrice: products.basePrice,
        isActive: products.isActive,
        status: products.status,
        sku: products.sku,
        images: products.images,
        isVegetarian: products.isVegetarian,
        tags: products.tags,
        position: products.position,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(eq(products.orgId, orgId))
      .orderBy(asc(categories.position), asc(products.position)),
    database.selectDistinct({ productId: productModifierGroups.productId }).from(productModifierGroups).innerJoin(products, eq(productModifierGroups.productId, products.id)).where(eq(products.orgId, orgId)),
    database.select().from(productAvailability).where(eq(productAvailability.orgId, orgId)),
  ]);

  const productIdsWithModifiers = new Set(groupLinks.map((r) => r.productId));
  const availabilityByProduct = new Map<string, typeof availabilityRows>();
  for (const row of availabilityRows) {
    const existing = availabilityByProduct.get(row.productId) ?? [];
    existing.push(row);
    availabilityByProduct.set(row.productId, existing);
  }
  const today = businessDate();
  function resolveStatus(productId: string): AvailabilityStatus {
    const productRows = availabilityByProduct.get(productId);
    if (!productRows || productRows.length === 0) return "AVAILABLE";
    return resolveAvailability(
      productRows.map((row) => ({ locationId: null, channel: null, status: row.status, unavailableUntil: row.unavailableUntil, reason: row.reason, setOnBusinessDate: businessDate(row.updatedAt) })),
      { locationId: null, channel: null, now: new Date(), today },
    ).status;
  }

  const search = filter?.search?.trim().toLowerCase();
  return rows
    .filter((row) => !filter?.categoryId || row.categoryId === filter.categoryId)
    .filter((row) => !search || row.name.toLowerCase().includes(search) || (row.sku ?? "").toLowerCase().includes(search))
    .map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      basePrice: row.basePrice as Paise,
      isActive: row.isActive,
      status: row.status,
      isVegetarian: row.isVegetarian,
      badges: row.tags,
      hasModifiers: productIdsWithModifiers.has(row.id),
      position: row.position,
      availabilityStatus: resolveStatus(row.id),
      sku: row.sku,
      image: row.images?.[0]?.url ?? null,
    }));
}

export interface ProductDetail {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly shortDescription: string | null;
  readonly categoryId: string | null;
  readonly basePrice: Paise;
  readonly taxRateId: string | null;
  readonly spiceLevel: number;
  readonly isVegetarian: boolean;
  readonly allergens: readonly string[];
  readonly tags: readonly string[];
  readonly images: readonly { url: string; alt: string }[];
  readonly sku: string | null;
  readonly prepMinutes: number | null;
  readonly kdsStation: string | null;
  readonly servingInfo: string | null;
  readonly isActive: boolean;
  readonly status: "DRAFT" | "PUBLISHED";
  readonly modifierGroupIds: readonly string[];
  /** Whether this product bundles others — see `combo_items` — the product editor uses this to show combo-specific sections. */
  readonly isCombo: boolean;
}

export async function getProductAdmin(orgId: string, id: string): Promise<ProductDetail | null> {
  const [row] = await db().select().from(products).where(and(eq(products.id, id), eq(products.orgId, orgId))).limit(1);
  if (!row) return null;

  const [assigned, comboRows] = await Promise.all([
    db().select({ groupId: productModifierGroups.groupId }).from(productModifierGroups).where(eq(productModifierGroups.productId, id)).orderBy(asc(productModifierGroups.position)),
    db().select({ id: comboItems.id }).from(comboItems).where(eq(comboItems.comboProductId, id)).limit(1),
  ]);

  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    shortDescription: row.shortDescription,
    categoryId: row.categoryId,
    basePrice: row.basePrice as Paise,
    taxRateId: row.taxRateId,
    spiceLevel: row.spiceLevel,
    isVegetarian: row.isVegetarian,
    allergens: row.allergens,
    tags: row.tags,
    images: row.images,
    sku: row.sku,
    prepMinutes: row.prepMinutes,
    kdsStation: row.kdsStation,
    servingInfo: row.servingInfo,
    isActive: row.isActive,
    status: row.status,
    modifierGroupIds: assigned.map((a) => a.groupId),
    isCombo: comboRows.length > 0,
  };
}

export interface ProductInput {
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly shortDescription: string | null;
  readonly categoryId: string | null;
  readonly taxRateId: string | null;
  readonly spiceLevel: number;
  readonly isVegetarian: boolean;
  readonly allergens: readonly string[];
  readonly tags: readonly string[];
  readonly sku: string | null;
  readonly prepMinutes: number | null;
  readonly kdsStation: string | null;
  readonly servingInfo: string | null;
}

export async function createProduct(orgId: string, input: ProductInput): Promise<{ id: string }> {
  if (input.categoryId) await assertCategoryOwned(orgId, input.categoryId);
  if (input.taxRateId) await assertTaxRateOwned(orgId, input.taxRateId);

  const [max] = await db().select({ position: sql<number>`coalesce(max(${products.position}), -1)` }).from(products).where(eq(products.orgId, orgId));
  const [row] = await db()
    .insert(products)
    .values({
      orgId,
      ...input,
      allergens: [...input.allergens],
      tags: [...input.tags],
      basePrice: 0n,
      position: (max?.position ?? -1) + 1,
      status: "DRAFT",
      isActive: true,
    })
    .returning({ id: products.id });
  if (!row) throw new Error("menu-admin: could not create product");
  return row;
}

export async function updateProductDetails(orgId: string, id: string, input: ProductInput, actorUserId: string | null = null): Promise<void> {
  if (input.categoryId) await assertCategoryOwned(orgId, input.categoryId);
  if (input.taxRateId) await assertTaxRateOwned(orgId, input.taxRateId);

  const [before] = await db().select({ name: products.name, categoryId: products.categoryId, sku: products.sku }).from(products).where(and(eq(products.id, id), eq(products.orgId, orgId))).limit(1);

  await db()
    .update(products)
    .set({ ...input, allergens: [...input.allergens], tags: [...input.tags], updatedAt: new Date() })
    .where(and(eq(products.id, id), eq(products.orgId, orgId)));

  if (before) {
    await logChanges({
      orgId,
      entityType: "product",
      entityId: id,
      entityName: input.name,
      actorUserId,
      changes: [
        { field: "name", oldValue: before.name, newValue: input.name },
        { field: "category", oldValue: before.categoryId, newValue: input.categoryId },
        { field: "sku", oldValue: before.sku, newValue: input.sku },
      ],
    });
  }
}

/** `menu.price`-gated at the action layer — the one field a MANAGER cannot touch. */
export async function updateProductPrice(orgId: string, id: string, basePrice: Paise, actorUserId: string | null = null): Promise<void> {
  const [before] = await db().select({ name: products.name, basePrice: products.basePrice }).from(products).where(and(eq(products.id, id), eq(products.orgId, orgId))).limit(1);
  await db().update(products).set({ basePrice, updatedAt: new Date() }).where(and(eq(products.id, id), eq(products.orgId, orgId)));
  if (before) {
    await logChanges({
      orgId,
      entityType: "product",
      entityId: id,
      entityName: before.name,
      actorUserId,
      changes: [{ field: "price (paise)", oldValue: before.basePrice.toString(), newValue: basePrice.toString() }],
    });
  }
}

export async function setProductImages(orgId: string, id: string, images: readonly { url: string; alt: string }[]): Promise<void> {
  await db().update(products).set({ images: [...images], updatedAt: new Date() }).where(and(eq(products.id, id), eq(products.orgId, orgId)));
}

export async function setProductActive(orgId: string, id: string, isActive: boolean, actorUserId: string | null = null): Promise<void> {
  const [before] = await db().select({ name: products.name, isActive: products.isActive }).from(products).where(and(eq(products.id, id), eq(products.orgId, orgId))).limit(1);
  await db().update(products).set({ isActive, updatedAt: new Date() }).where(and(eq(products.id, id), eq(products.orgId, orgId)));
  if (before) {
    await logChanges({
      orgId,
      entityType: "product",
      entityId: id,
      entityName: before.name,
      actorUserId,
      changes: [{ field: "active", oldValue: before.isActive, newValue: isActive }],
    });
  }
}

export async function publishProduct(orgId: string, id: string, actorUserId: string | null = null): Promise<void> {
  const [before] = await db().select({ name: products.name, status: products.status }).from(products).where(and(eq(products.id, id), eq(products.orgId, orgId))).limit(1);
  await db().update(products).set({ status: "PUBLISHED", updatedAt: new Date() }).where(and(eq(products.id, id), eq(products.orgId, orgId)));
  if (before) {
    await logChanges({
      orgId,
      entityType: "product",
      entityId: id,
      entityName: before.name,
      actorUserId,
      changes: [{ field: "status", oldValue: before.status, newValue: "PUBLISHED" }],
    });
  }
}

/** Reorders a product within its category — the product list's "move up/down" action. Uncategorised products reorder among themselves. */
export async function moveProductPosition(orgId: string, id: string, direction: "up" | "down"): Promise<void> {
  const [target] = await db().select({ categoryId: products.categoryId }).from(products).where(and(eq(products.id, id), eq(products.orgId, orgId))).limit(1);
  if (!target) return;

  const siblings = await db()
    .select({ id: products.id, position: products.position })
    .from(products)
    .where(and(eq(products.orgId, orgId), target.categoryId ? eq(products.categoryId, target.categoryId) : isNull(products.categoryId)))
    .orderBy(asc(products.position));

  const index = siblings.findIndex((row) => row.id === id);
  if (index === -1) return;
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= siblings.length) return;

  const a = siblings[index]!;
  const b = siblings[swapWith]!;
  await db().transaction(async (tx) => {
    await tx.update(products).set({ position: b.position, updatedAt: new Date() }).where(and(eq(products.id, a.id), eq(products.orgId, orgId)));
    await tx.update(products).set({ position: a.position, updatedAt: new Date() }).where(and(eq(products.id, b.id), eq(products.orgId, orgId)));
  });
}

/** Moves a product to a different category (or to "uncategorised") — the product list's quick "move to category" action. */
export async function moveProductToCategory(orgId: string, id: string, newCategoryId: string | null, actorUserId: string | null = null): Promise<void> {
  if (newCategoryId) await assertCategoryOwned(orgId, newCategoryId);

  const [before] = await db()
    .select({ name: products.name, categoryId: products.categoryId, oldCategoryName: categories.name })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(eq(products.id, id), eq(products.orgId, orgId)))
    .limit(1);
  if (!before) return;

  const [max] = await db().select({ position: sql<number>`coalesce(max(${products.position}), -1)` }).from(products).where(and(eq(products.orgId, orgId), newCategoryId ? eq(products.categoryId, newCategoryId) : isNull(products.categoryId)));

  await db().update(products).set({ categoryId: newCategoryId, position: (max?.position ?? -1) + 1, updatedAt: new Date() }).where(and(eq(products.id, id), eq(products.orgId, orgId)));

  const [newCategoryName] = newCategoryId ? await db().select({ name: categories.name }).from(categories).where(eq(categories.id, newCategoryId)).limit(1) : [null];
  await logChanges({
    orgId,
    entityType: "product",
    entityId: id,
    entityName: before.name,
    actorUserId,
    changes: [{ field: "category", oldValue: before.oldCategoryName, newValue: newCategoryName?.name ?? null }],
  });
}

/**
 * Clones a product — name, description, pricing, dietary/tax fields, photos,
 * and its assigned modifier groups — as a new DRAFT, for "start from an
 * existing burger rather than a blank form." Combo contents are not copied;
 * a duplicated combo starts as a normal draft product with no bundled items,
 * since blindly cloning combo_items could silently double-bundle a product
 * that was never meant to appear in two combos without a deliberate choice.
 */
export async function duplicateProduct(orgId: string, id: string): Promise<{ id: string }> {
  const source = await getProductAdmin(orgId, id);
  if (!source) throw new CrossOrgReference("product");

  const slug = `${source.slug}-copy-${Math.random().toString(36).slice(2, 7)}`;
  const { id: newId } = await createProduct(orgId, {
    name: `${source.name} (copy)`,
    slug,
    description: source.description,
    shortDescription: source.shortDescription,
    categoryId: source.categoryId,
    taxRateId: source.taxRateId,
    spiceLevel: source.spiceLevel,
    isVegetarian: source.isVegetarian,
    allergens: source.allergens,
    tags: source.tags,
    sku: null,
    prepMinutes: source.prepMinutes,
    kdsStation: source.kdsStation,
    servingInfo: source.servingInfo,
  });

  await Promise.all([
    updateProductPrice(orgId, newId, source.basePrice),
    setProductImages(orgId, newId, source.images),
    source.modifierGroupIds.length > 0 ? setProductModifierGroups(orgId, newId, source.modifierGroupIds) : Promise.resolve(),
  ]);

  return { id: newId };
}

/**
 * Replaces which modifier groups a product offers.
 *
 * Every `groupId` is independently verified against `orgId` before it can
 * be attached — the admin UI's checkbox list only ever offers the caller's
 * own groups (`listModifierGroupsAdmin(orgId)`), but that is a UI
 * convenience, not the security boundary; a crafted request could name any
 * group id. If even one does not belong to this organization the whole
 * write is refused rather than silently dropping the bad id and saving a
 * list the caller did not actually ask for.
 *
 * The delete-then-insert runs inside one transaction so a concurrent read
 * (the website, the counter, another admin tab) can never observe the
 * product with zero modifier groups that exists for a moment between the
 * two statements — either the whole replacement is visible, or none of it
 * is.
 */
export async function setProductModifierGroups(orgId: string, productId: string, groupIds: readonly string[]): Promise<void> {
  await assertProductOwned(orgId, productId);

  if (groupIds.length > 0) {
    const owned = await db().select({ id: modifierGroups.id }).from(modifierGroups).where(and(inArray(modifierGroups.id, [...groupIds]), eq(modifierGroups.orgId, orgId)));
    if (owned.length !== new Set(groupIds).size) throw new CrossOrgReference("modifier group");
  }

  await db().transaction(async (tx) => {
    await tx.delete(productModifierGroups).where(eq(productModifierGroups.productId, productId));
    if (groupIds.length > 0) {
      await tx.insert(productModifierGroups).values(groupIds.map((groupId, position) => ({ productId, groupId, position })));
    }
  });
}

/* ------------------------------------------------------------------ */
/* Modifier groups                                                     */
/* ------------------------------------------------------------------ */

export interface ModifierGroupAdminRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly minSelections: number;
  readonly maxSelections: number | null;
  readonly status: "DRAFT" | "PUBLISHED";
  readonly modifiers: readonly { id: string; name: string; slug: string; priceDelta: Paise; isAvailable: boolean }[];
}

export async function listModifierGroupsAdmin(orgId: string): Promise<ModifierGroupAdminRow[]> {
  const groups = await db().select().from(modifierGroups).where(eq(modifierGroups.orgId, orgId)).orderBy(asc(modifierGroups.position));
  const modifierRows = await db()
    .select()
    .from(modifiers)
    .where(inArray(modifiers.groupId, groups.map((g) => g.id)))
    .orderBy(asc(modifiers.position));

  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    slug: group.slug,
    minSelections: group.minSelections,
    maxSelections: group.maxSelections,
    status: group.status,
    modifiers: modifierRows
      .filter((m) => m.groupId === group.id)
      .map((m) => ({ id: m.id, name: m.name, slug: m.slug, priceDelta: m.priceDelta as Paise, isAvailable: m.isAvailable })),
  }));
}

export interface ModifierGroupInput {
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly minSelections: number;
  readonly maxSelections: number | null;
}

export async function createModifierGroup(orgId: string, input: ModifierGroupInput): Promise<{ id: string }> {
  const [row] = await db().insert(modifierGroups).values({ orgId, ...input, status: "DRAFT" }).returning({ id: modifierGroups.id });
  if (!row) throw new Error("menu-admin: could not create modifier group");
  return row;
}

export async function updateModifierGroup(orgId: string, id: string, input: ModifierGroupInput): Promise<void> {
  await db().update(modifierGroups).set({ ...input, updatedAt: new Date() }).where(and(eq(modifierGroups.id, id), eq(modifierGroups.orgId, orgId)));
}

export async function publishModifierGroup(orgId: string, id: string): Promise<void> {
  await db().update(modifierGroups).set({ status: "PUBLISHED", updatedAt: new Date() }).where(and(eq(modifierGroups.id, id), eq(modifierGroups.orgId, orgId)));
}

export async function deleteModifierGroup(orgId: string, id: string): Promise<{ ok: boolean; error?: string }> {
  const [inUse] = await db().select({ id: productModifierGroups.id }).from(productModifierGroups).where(eq(productModifierGroups.groupId, id)).limit(1);
  if (inUse) return { ok: false, error: "This group is still assigned to a product. Remove it there first." };
  await db().delete(modifierGroups).where(and(eq(modifierGroups.id, id), eq(modifierGroups.orgId, orgId)));
  return { ok: true };
}

export interface ModifierInput {
  readonly name: string;
  readonly slug: string;
  readonly priceDelta: Paise;
  readonly isDefault: boolean;
  readonly isAvailable: boolean;
}

export async function addModifier(orgId: string, groupId: string, input: ModifierInput): Promise<void> {
  await assertModifierGroupOwned(orgId, groupId);
  const [max] = await db().select({ position: sql<number>`coalesce(max(${modifiers.position}), -1)` }).from(modifiers).where(eq(modifiers.groupId, groupId));
  await db().insert(modifiers).values({ orgId, groupId, ...input, position: (max?.position ?? -1) + 1 });
}

export async function updateModifier(orgId: string, id: string, input: ModifierInput): Promise<void> {
  await db().update(modifiers).set({ ...input, updatedAt: new Date() }).where(and(eq(modifiers.id, id), eq(modifiers.orgId, orgId)));
}

export async function deleteModifier(orgId: string, id: string): Promise<void> {
  await db().delete(modifiers).where(and(eq(modifiers.id, id), eq(modifiers.orgId, orgId)));
}

/* ------------------------------------------------------------------ */
/* Combos                                                               */
/* ------------------------------------------------------------------ */

export interface ComboItemRow {
  readonly id: string;
  readonly productId: string;
  readonly productName: string;
  readonly quantity: number;
}

/** A combo is a regular product (see `products`); this reads what it bundles. */
export async function listComboItems(orgId: string, comboProductId: string): Promise<ComboItemRow[]> {
  const rows = await db()
    .select({ id: comboItems.id, productId: comboItems.productId, productName: products.name, quantity: comboItems.quantity })
    .from(comboItems)
    .innerJoin(products, eq(comboItems.productId, products.id))
    .where(and(eq(comboItems.comboProductId, comboProductId), eq(products.orgId, orgId)))
    .orderBy(asc(comboItems.position));
  return rows;
}

/** Both the combo container and the product being bundled into it must belong to the caller's organization. */
export async function addComboItem(orgId: string, comboProductId: string, productId: string, quantity: number): Promise<void> {
  await assertProductOwned(orgId, comboProductId);
  await assertProductOwned(orgId, productId);
  const [max] = await db().select({ position: sql<number>`coalesce(max(${comboItems.position}), -1)` }).from(comboItems).where(eq(comboItems.comboProductId, comboProductId));
  await db().insert(comboItems).values({ comboProductId, productId, quantity, position: (max?.position ?? -1) + 1 });
}

export async function removeComboItem(orgId: string, id: string): Promise<void> {
  const database = db();
  const [row] = await database
    .select({ id: comboItems.id })
    .from(comboItems)
    .innerJoin(products, eq(comboItems.comboProductId, products.id))
    .where(and(eq(comboItems.id, id), eq(products.orgId, orgId)))
    .limit(1);
  if (!row) return;
  await database.delete(comboItems).where(eq(comboItems.id, id));
}

/* ------------------------------------------------------------------ */
/* Availability                                                         */
/* ------------------------------------------------------------------ */

export interface AvailabilityRuleRow {
  readonly id: string;
  readonly locationId: string | null;
  readonly channel: string | null;
  readonly status: AvailabilityStatus;
  readonly unavailableUntil: Date | null;
  readonly reason: string | null;
  readonly updatedAt: Date;
}

export async function listAvailabilityRules(orgId: string, productId: string): Promise<AvailabilityRuleRow[]> {
  return db().select().from(productAvailability).where(and(eq(productAvailability.orgId, orgId), eq(productAvailability.productId, productId))).orderBy(desc(productAvailability.updatedAt));
}

export interface AvailabilityRuleInput {
  readonly locationId: string | null;
  readonly channel: string | null;
  readonly status: AvailabilityStatus;
  readonly unavailableUntil: Date | null;
  readonly reason: string | null;
}

/**
 * Upserts the one rule for this (product, location, channel) triple.
 *
 * `onConflictDoUpdate` needs a literal target; since `location_id`/`channel`
 * can each be null and Postgres treats NULL as distinct in a unique index,
 * a plain upsert would insert a duplicate wildcard row instead of updating
 * the existing one. So this looks the row up itself first — the
 * "at most one wildcard row" guarantee the schema comment promises the
 * repository layer would own.
 */
export async function setAvailabilityRule(orgId: string, productId: string, input: AvailabilityRuleInput, actorUserId: string | null = null): Promise<void> {
  await assertProductOwned(orgId, productId);

  const database = db();
  const conditions = [eq(productAvailability.orgId, orgId), eq(productAvailability.productId, productId)];
  conditions.push(input.locationId === null ? isNull(productAvailability.locationId) : eq(productAvailability.locationId, input.locationId));
  conditions.push(input.channel === null ? isNull(productAvailability.channel) : eq(productAvailability.channel, input.channel));

  const [existing] = await database.select().from(productAvailability).where(and(...conditions)).limit(1);
  const [product] = await database.select({ name: products.name }).from(products).where(eq(products.id, productId)).limit(1);

  if (existing) {
    await database
      .update(productAvailability)
      .set({ status: input.status, unavailableUntil: input.unavailableUntil, reason: input.reason, updatedAt: new Date() })
      .where(eq(productAvailability.id, existing.id));
  } else {
    await database.insert(productAvailability).values({ orgId, productId, ...input });
  }

  if (product) {
    await logChanges({
      orgId,
      entityType: "availability",
      entityId: productId,
      entityName: product.name,
      actorUserId,
      changes: [{ field: input.channel ? `availability (${input.channel})` : "availability", oldValue: existing?.status ?? "AVAILABLE", newValue: input.status }],
    });
  }
}

export async function deleteAvailabilityRule(orgId: string, id: string): Promise<void> {
  await db().delete(productAvailability).where(and(eq(productAvailability.id, id), eq(productAvailability.orgId, orgId)));
}

/* ------------------------------------------------------------------ */
/* Category availability — channel visibility for a whole category.    */
/* ------------------------------------------------------------------ */

export interface CategoryAvailabilityRuleRow {
  readonly id: string;
  readonly channel: string | null;
  readonly status: AvailabilityStatus;
  readonly unavailableUntil: Date | null;
  readonly reason: string | null;
  readonly updatedAt: Date;
}

export async function listCategoryAvailabilityRules(orgId: string, categoryId: string): Promise<CategoryAvailabilityRuleRow[]> {
  return db().select().from(categoryAvailability).where(and(eq(categoryAvailability.orgId, orgId), eq(categoryAvailability.categoryId, categoryId))).orderBy(desc(categoryAvailability.updatedAt));
}

export interface CategoryAvailabilityRuleInput {
  readonly channel: string | null;
  readonly status: AvailabilityStatus;
  readonly unavailableUntil: Date | null;
  readonly reason: string | null;
}

/** Same upsert-by-lookup shape as `setAvailabilityRule`, scoped to a category instead of a product. */
export async function setCategoryAvailabilityRule(orgId: string, categoryId: string, input: CategoryAvailabilityRuleInput, actorUserId: string | null = null): Promise<void> {
  await assertCategoryOwned(orgId, categoryId);

  const database = db();
  const conditions = [eq(categoryAvailability.orgId, orgId), eq(categoryAvailability.categoryId, categoryId)];
  conditions.push(input.channel === null ? isNull(categoryAvailability.channel) : eq(categoryAvailability.channel, input.channel));

  const [existing] = await database.select().from(categoryAvailability).where(and(...conditions)).limit(1);
  const [category] = await database.select({ name: categories.name }).from(categories).where(eq(categories.id, categoryId)).limit(1);

  if (existing) {
    await database
      .update(categoryAvailability)
      .set({ status: input.status, unavailableUntil: input.unavailableUntil, reason: input.reason, updatedAt: new Date() })
      .where(eq(categoryAvailability.id, existing.id));
  } else {
    await database.insert(categoryAvailability).values({ orgId, categoryId, ...input });
  }

  if (category) {
    await logChanges({
      orgId,
      entityType: "availability",
      entityId: categoryId,
      entityName: category.name,
      actorUserId,
      changes: [{ field: input.channel ? `visibility (${input.channel})` : "visibility", oldValue: existing?.status ?? "AVAILABLE", newValue: input.status }],
    });
  }
}

export async function deleteCategoryAvailabilityRule(orgId: string, id: string): Promise<void> {
  await db().delete(categoryAvailability).where(and(eq(categoryAvailability.id, id), eq(categoryAvailability.orgId, orgId)));
}

/* ------------------------------------------------------------------ */
/* Draft/publish review                                                */
/* ------------------------------------------------------------------ */

export interface DraftItem {
  readonly kind: "category" | "product" | "modifierGroup";
  readonly id: string;
  readonly name: string;
}

export async function listDraftItems(orgId: string): Promise<DraftItem[]> {
  const database = db();
  const [draftCategories, draftProducts, draftGroups] = await Promise.all([
    database.select({ id: categories.id, name: categories.name }).from(categories).where(and(eq(categories.orgId, orgId), eq(categories.status, "DRAFT"))),
    database.select({ id: products.id, name: products.name }).from(products).where(and(eq(products.orgId, orgId), eq(products.status, "DRAFT"))),
    database.select({ id: modifierGroups.id, name: modifierGroups.name }).from(modifierGroups).where(and(eq(modifierGroups.orgId, orgId), eq(modifierGroups.status, "DRAFT"))),
  ]);

  return [
    ...draftCategories.map((c) => ({ kind: "category" as const, id: c.id, name: c.name })),
    ...draftProducts.map((p) => ({ kind: "product" as const, id: p.id, name: p.name })),
    ...draftGroups.map((g) => ({ kind: "modifierGroup" as const, id: g.id, name: g.name })),
  ];
}

/* ------------------------------------------------------------------ */
/* Menu health — the Menu Control Center's completeness summary.       */
/* ------------------------------------------------------------------ */

export interface MenuHealth {
  readonly totalProducts: number;
  readonly withPhotos: number;
  readonly withDescriptions: number;
  readonly withModifiers: number;
  readonly unavailable: number;
  readonly drafts: number;
  readonly missingTaxRate: number;
  /** 0-100, weighted toward the fields that actually matter to a customer deciding what to order. */
  readonly completenessPct: number;
}

/**
 * Only counts what the schema/business rules actually require — a photo, a
 * description and a tax rate are real gaps; nothing here invents a
 * compliance requirement that isn't already a real column or rule.
 */
export async function getMenuHealth(orgId: string): Promise<MenuHealth> {
  const database = db();

  const [rows, withModifierRows, availabilityRows] = await Promise.all([
    database
      .select({ id: products.id, images: products.images, description: products.description, status: products.status, taxRateId: products.taxRateId })
      .from(products)
      .where(and(eq(products.orgId, orgId), eq(products.isActive, true))),
    database.selectDistinct({ productId: productModifierGroups.productId }).from(productModifierGroups).innerJoin(products, eq(productModifierGroups.productId, products.id)).where(eq(products.orgId, orgId)),
    database.select().from(productAvailability).where(eq(productAvailability.orgId, orgId)),
  ]);

  const productIdsWithModifiers = new Set(withModifierRows.map((r) => r.productId));
  const availabilityByProduct = new Map<string, typeof availabilityRows>();
  for (const row of availabilityRows) {
    const existing = availabilityByProduct.get(row.productId) ?? [];
    existing.push(row);
    availabilityByProduct.set(row.productId, existing);
  }

  const today = businessDate();
  let unavailable = 0;
  for (const productRows of availabilityByProduct.values()) {
    const resolved = resolveAvailability(
      productRows.map((row) => ({ locationId: null, channel: null, status: row.status, unavailableUntil: row.unavailableUntil, reason: row.reason, setOnBusinessDate: businessDate(row.updatedAt) })),
      { locationId: null, channel: null, now: new Date(), today },
    );
    if (!resolved.available) unavailable += 1;
  }

  const totalProducts = rows.length;
  const withPhotos = rows.filter((r) => r.images.length > 0).length;
  const withDescriptions = rows.filter((r) => (r.description ?? "").trim().length > 0).length;
  const withModifiers = rows.filter((r) => productIdsWithModifiers.has(r.id)).length;
  const drafts = rows.filter((r) => r.status === "DRAFT").length;
  const missingTaxRate = rows.filter((r) => r.taxRateId === null).length;

  const completenessPct =
    totalProducts === 0 ? 100 : Math.round(((withPhotos + withDescriptions + (totalProducts - missingTaxRate)) / (totalProducts * 3)) * 100);

  return { totalProducts, withPhotos, withDescriptions, withModifiers, unavailable, drafts, missingTaxRate, completenessPct };
}

/* ------------------------------------------------------------------ */
/* Recipe status — no quantities invented. See src/db/schema/menu.ts.  */
/* ------------------------------------------------------------------ */

export interface RecipeStatus {
  readonly linked: boolean;
  readonly ingredientCount: number;
}

export async function getRecipeStatus(orgId: string, productId: string): Promise<RecipeStatus> {
  const [recipe] = await db().select({ id: recipes.id }).from(recipes).where(and(eq(recipes.orgId, orgId), eq(recipes.productId, productId))).limit(1);
  if (!recipe) return { linked: false, ingredientCount: 0 };

  const [count] = await db().select({ n: sql<number>`count(*)::int` }).from(recipeItems).where(eq(recipeItems.recipeId, recipe.id));
  return { linked: true, ingredientCount: count?.n ?? 0 };
}

export async function createBareRecipe(orgId: string, productId: string, yieldQuantity: number): Promise<void> {
  await assertProductOwned(orgId, productId);
  await db().insert(recipes).values({ orgId, productId, yieldQuantity }).onConflictDoNothing({ target: recipes.productId });
}

/**
 * What inventory says about whether this product can still be sold.
 *
 * Always "unknown" today — there is no code anywhere that derives
 * sellability from stock counts yet, and BUILD-PLAN.md is explicit: never
 * invent an inventory number. This is the integration point a future
 * inventory-aware availability feature replaces, not a placeholder result
 * dressed up as a real one — callers must not treat "unknown" as "in stock".
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for the shape callers will need once this is real
export function inventoryAvailability(productId: string): "unknown" {
  return "unknown";
}

/** Unused today (see `productChannelPrices`'s own comment) — read for completeness by the pricing tab, never written by this pass. */
export async function getChannelPriceOverrides(orgId: string, productId: string): Promise<readonly { channel: string; price: Paise }[]> {
  const rows = await db()
    .select({ channel: productChannelPrices.channel, price: productChannelPrices.price })
    .from(productChannelPrices)
    .where(and(eq(productChannelPrices.orgId, orgId), eq(productChannelPrices.productId, productId)));
  return rows.map((r) => ({ channel: r.channel, price: r.price as Paise }));
}

/* ------------------------------------------------------------------ */
/* Tax rates — read here for the pricing tab's dropdown.                */
/* ------------------------------------------------------------------ */

export interface TaxRateRow {
  readonly id: string;
  readonly name: string;
  readonly rateBps: number;
  readonly hsnCode: string | null;
}

export async function listTaxRates(orgId: string): Promise<TaxRateRow[]> {
  return db().select({ id: taxRates.id, name: taxRates.name, rateBps: taxRates.rateBps, hsnCode: taxRates.hsnCode }).from(taxRates).where(eq(taxRates.orgId, orgId));
}
