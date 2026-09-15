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
import { type PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  categories,
  categoryAvailability,
  comboItems,
  ingredients,
  menuAuditLog,
  modifierGroups,
  modifiers,
  priceHistory,
  productAvailability,
  productModifierGroups,
  products,
  recipeVersionItems,
  recipeVersions,
  recipes,
  taxRates,
} from "@/db/schema";
import { type AvailabilityStatus, resolveAvailability } from "@/domain/menu-availability";
import { businessDate } from "@/lib/dates";
import { type MilliPaise, theoreticalRecipeCost } from "@/lib/iq/costing";
import { type BaseUnit } from "@/lib/iq/units";
import { type Paise, paise, scale } from "@/lib/money";
import { planSwap } from "@/lib/menu-admin/reorder";

/**
 * Thrown when an edit's `expectedUpdatedAt` no longer matches the row —
 * someone else saved a change to this exact entity since the form was
 * loaded. Deliberately scoped to the multi-field edit forms (category,
 * product details/price, modifier group, modifier option) where a stale
 * save could silently discard a colleague's different edit — never to the
 * single-purpose toggles (archive, publish, mark-unavailable, reorder),
 * where two people acting on the same row in quick succession is normal,
 * sequential, legitimate use, not a conflict. See the Menu Control Center
 * architecture contract, §0.2 — this is conflict *detection* on an
 * immediate write, not staging; the winning save still applies instantly.
 */
export class ConcurrentModificationError extends Error {
  constructor(what: string) {
    super(`menu-admin: ${what} was changed by someone else since you loaded it`);
    this.name = "ConcurrentModificationError";
  }
}

/**
 * Compares a concurrency-token column against a client-supplied
 * `expectedUpdatedAt` at millisecond precision.
 *
 * `updated_at` columns are `timestamptz` with no explicit precision, so
 * Postgres stores microseconds — but the `postgres` driver reads timestamps
 * back into JS `Date`, which can only hold milliseconds, and re-serializes
 * with `.toISOString()` (also milliseconds) when it goes back out as a query
 * parameter. A plain `eq(column, expectedUpdatedAt)` therefore compares a
 * microsecond-precision stored value against a millisecond-precision
 * parameter and fails almost every time, even when nothing has changed —
 * caught by `pnpm menu:verify` throwing `ConcurrentModificationError` on a
 * `duplicateProduct` call no one else had touched. Truncating both sides to
 * the millisecond, the finest precision a `Date` can actually represent,
 * fixes the comparison without a schema change; two genuinely distinct edits
 * landing in the same millisecond is not a real-world case this staff UI
 * needs to guard against.
 */
function sameUpdatedAt(column: PgColumn, expectedUpdatedAt: Date) {
  return sql`date_trunc('milliseconds', ${column}) = date_trunc('milliseconds', ${expectedUpdatedAt.toISOString()}::timestamptz)`;
}

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
export type AuditEntityType = "category" | "product" | "modifierGroup" | "modifier" | "combo" | "availability" | "recipe";

interface AuditIdentity {
  readonly orgId: string;
  readonly entityType: AuditEntityType;
  readonly entityId: string;
  readonly entityName: string;
  readonly actorUserId: string | null;
}

async function logChanges(input: AuditIdentity & { changes: readonly { field: string; oldValue: LoggableValue; newValue: LoggableValue }[] }): Promise<void> {
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

/** Every entity creation logs one "created" row — closes the gap where only updates were ever audited. */
async function auditCreate(input: AuditIdentity): Promise<void> {
  await logChanges({ ...input, changes: [{ field: "created", oldValue: null, newValue: input.entityName }] });
}

/**
 * Every entity deletion logs one "deleted" row — called with the entity's
 * name captured *before* the delete, since `menuAuditLog.entityId` is a
 * loose reference by design (it must survive the row it names being gone).
 */
async function auditDelete(input: AuditIdentity): Promise<void> {
  await logChanges({ ...input, changes: [{ field: "deleted", oldValue: input.entityName, newValue: null }] });
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
  /** The optimistic-concurrency token — the edit form round-trips this back so a stale save is refused. */
  readonly updatedAt: Date;
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
      updatedAt: categories.updatedAt,
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

export async function createCategory(orgId: string, input: CategoryInput, actorUserId: string | null = null): Promise<{ id: string }> {
  const [max] = await db().select({ position: sql<number>`coalesce(max(${categories.position}), -1)` }).from(categories).where(eq(categories.orgId, orgId));
  const [row] = await db()
    .insert(categories)
    .values({ orgId, ...input, position: (max?.position ?? -1) + 1, status: "DRAFT" })
    .returning({ id: categories.id });
  if (!row) throw new Error("menu-admin: could not create category");
  await auditCreate({ orgId, entityType: "category", entityId: row.id, entityName: input.name, actorUserId });
  return row;
}

/**
 * `expectedUpdatedAt` is the concurrency token — the edit form round-trips
 * the `updatedAt` it loaded with. If nothing matches (id+org right, but the
 * timestamp has moved because someone else saved first), this throws
 * `ConcurrentModificationError` rather than overwriting their change.
 */
export async function updateCategory(orgId: string, id: string, input: CategoryInput, expectedUpdatedAt: Date, actorUserId: string | null = null): Promise<void> {
  const [before] = await db().select({ name: categories.name }).from(categories).where(and(eq(categories.id, id), eq(categories.orgId, orgId))).limit(1);

  const [updated] = await db()
    .update(categories)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(categories.id, id), eq(categories.orgId, orgId), sameUpdatedAt(categories.updatedAt, expectedUpdatedAt)))
    .returning({ id: categories.id });

  if (!updated) {
    const [current] = await db().select({ id: categories.id }).from(categories).where(and(eq(categories.id, id), eq(categories.orgId, orgId))).limit(1);
    if (current) throw new ConcurrentModificationError("category");
    return; // genuinely gone or not this org's — no-op, matches the rest of this file's ownership-miss behaviour
  }

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
export async function deleteCategory(orgId: string, id: string, actorUserId: string | null = null): Promise<{ ok: boolean; error?: string }> {
  const [inUse] = await db().select({ id: products.id }).from(products).where(and(eq(products.categoryId, id), eq(products.orgId, orgId))).limit(1);
  if (inUse) return { ok: false, error: "This category still has products in it. Move or delete them first." };
  const [deleted] = await db().delete(categories).where(and(eq(categories.id, id), eq(categories.orgId, orgId))).returning({ name: categories.name });
  if (deleted) await auditDelete({ orgId, entityType: "category", entityId: id, entityName: deleted.name, actorUserId });
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
  const writes = planSwap(await listCategoriesAdmin(orgId), id, direction);
  if (!writes) return;

  await db().transaction(async (tx) => {
    for (const write of writes) {
      await tx.update(categories).set({ position: write.position, updatedAt: new Date() }).where(and(eq(categories.id, write.id), eq(categories.orgId, orgId)));
    }
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
  readonly productType: "SIMPLE" | "COMBO";
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
        productType: products.productType,
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
      productType: row.productType,
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
  readonly productType: "SIMPLE" | "COMBO";
  /** Derived from `productType`, kept as a convenience for the editor's conditional sections — never re-derived from `comboItems.length`. */
  readonly isCombo: boolean;
  /** The optimistic-concurrency token — round-tripped by the details and price forms. */
  readonly updatedAt: Date;
}

export async function getProductAdmin(orgId: string, id: string): Promise<ProductDetail | null> {
  const [row] = await db().select().from(products).where(and(eq(products.id, id), eq(products.orgId, orgId))).limit(1);
  if (!row) return null;

  const assigned = await db().select({ groupId: productModifierGroups.groupId }).from(productModifierGroups).where(eq(productModifierGroups.productId, id)).orderBy(asc(productModifierGroups.position));

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
    productType: row.productType,
    isCombo: row.productType === "COMBO",
    updatedAt: row.updatedAt,
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
  readonly productType: "SIMPLE" | "COMBO";
}

export async function createProduct(orgId: string, input: ProductInput, actorUserId: string | null = null): Promise<{ id: string }> {
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
  await auditCreate({ orgId, entityType: input.productType === "COMBO" ? "combo" : "product", entityId: row.id, entityName: input.name, actorUserId });
  return row;
}

/**
 * `expectedUpdatedAt` is the concurrency token — see `updateCategory`'s doc
 * comment for the full rationale, identical here.
 */
export async function updateProductDetails(orgId: string, id: string, input: ProductInput, expectedUpdatedAt: Date, actorUserId: string | null = null): Promise<void> {
  if (input.categoryId) await assertCategoryOwned(orgId, input.categoryId);
  if (input.taxRateId) await assertTaxRateOwned(orgId, input.taxRateId);

  const [before] = await db().select({ name: products.name, categoryId: products.categoryId, sku: products.sku }).from(products).where(and(eq(products.id, id), eq(products.orgId, orgId))).limit(1);

  const [updated] = await db()
    .update(products)
    .set({ ...input, allergens: [...input.allergens], tags: [...input.tags], updatedAt: new Date() })
    .where(and(eq(products.id, id), eq(products.orgId, orgId), sameUpdatedAt(products.updatedAt, expectedUpdatedAt)))
    .returning({ id: products.id });

  if (!updated) {
    const [current] = await db().select({ id: products.id }).from(products).where(and(eq(products.id, id), eq(products.orgId, orgId))).limit(1);
    if (current) throw new ConcurrentModificationError("product");
    return;
  }

  if (before) {
    await logChanges({
      orgId,
      entityType: input.productType === "COMBO" ? "combo" : "product",
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

/** `menu.price`-gated at the action layer — the one field a MANAGER cannot touch. Also concurrency-guarded (§0.2). */
export async function updateProductPrice(orgId: string, id: string, basePrice: Paise, expectedUpdatedAt: Date, actorUserId: string | null = null): Promise<void> {
  const [before] = await db().select({ name: products.name, basePrice: products.basePrice }).from(products).where(and(eq(products.id, id), eq(products.orgId, orgId))).limit(1);

  // The price row and its history entry are written in one transaction so
  // the two can never disagree — a `basePrice` that moved with no matching
  // `priceHistory` row (or the reverse) is a bug this makes impossible
  // rather than something to reconcile later. `products.basePrice` is never
  // treated as its own record of the past; the append-only series is.
  const updated = await db().transaction(async (tx) => {
    const [row] = await tx
      .update(products)
      .set({ basePrice, updatedAt: new Date() })
      .where(and(eq(products.id, id), eq(products.orgId, orgId), sameUpdatedAt(products.updatedAt, expectedUpdatedAt)))
      .returning({ id: products.id });

    // Only a real change gets a row — saving the same price again isn't a
    // price change, and `logChanges` below already filters the same way.
    if (row && before && before.basePrice !== basePrice) {
      await tx.insert(priceHistory).values({ orgId, productId: id, oldPrice: before.basePrice, newPrice: basePrice, changedBy: actorUserId });
    }
    return row;
  });

  if (!updated) {
    const [current] = await db().select({ id: products.id }).from(products).where(and(eq(products.id, id), eq(products.orgId, orgId))).limit(1);
    if (current) throw new ConcurrentModificationError("product");
    return;
  }

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

export interface PriceHistoryRow {
  readonly id: string;
  readonly oldPrice: Paise | null;
  readonly newPrice: Paise;
  readonly changedBy: string | null;
  readonly createdAt: Date;
}

/** The full price series for one product, oldest first — what IQ reads instead of inferring price-over-time from the audit log. */
export async function listPriceHistory(orgId: string, productId: string): Promise<PriceHistoryRow[]> {
  const rows = await db()
    .select({ id: priceHistory.id, oldPrice: priceHistory.oldPrice, newPrice: priceHistory.newPrice, changedBy: priceHistory.changedBy, createdAt: priceHistory.createdAt })
    .from(priceHistory)
    .where(and(eq(priceHistory.productId, productId), eq(priceHistory.orgId, orgId)))
    .orderBy(asc(priceHistory.createdAt));
  return rows.map((row) => ({ ...row, oldPrice: row.oldPrice as Paise | null, newPrice: row.newPrice as Paise }));
}

/** Not concurrency-guarded — a photo picker action, not a multi-field edit form (§0.2's scoping). */
export async function setProductImages(orgId: string, id: string, images: readonly { url: string; alt: string }[], actorUserId: string | null = null): Promise<void> {
  const [before] = await db().select({ name: products.name, images: products.images }).from(products).where(and(eq(products.id, id), eq(products.orgId, orgId))).limit(1);
  await db().update(products).set({ images: [...images], updatedAt: new Date() }).where(and(eq(products.id, id), eq(products.orgId, orgId)));
  if (before) {
    await logChanges({
      orgId,
      entityType: "product",
      entityId: id,
      entityName: before.name,
      actorUserId,
      changes: [{ field: "photo count", oldValue: before.images.length, newValue: images.length }],
    });
  }
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
    .orderBy(asc(products.position), asc(products.createdAt));

  const writes = planSwap(siblings, id, direction);
  if (!writes) return;

  await db().transaction(async (tx) => {
    for (const write of writes) {
      await tx.update(products).set({ position: write.position, updatedAt: new Date() }).where(and(eq(products.id, write.id), eq(products.orgId, orgId)));
    }
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
export async function duplicateProduct(orgId: string, id: string, actorUserId: string | null = null): Promise<{ id: string }> {
  const source = await getProductAdmin(orgId, id);
  if (!source) throw new CrossOrgReference("product");

  const slug = `${source.slug}-copy-${Math.random().toString(36).slice(2, 7)}`;
  const { id: newId } = await createProduct(
    orgId,
    {
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
      productType: source.productType,
    },
    actorUserId,
  );

  // Sequenced, not Promise.all: updateProductPrice is concurrency-guarded
  // against products.updatedAt, and setProductImages also bumps that same
  // column — running them concurrently would race the guard against its
  // own sibling call and could throw a spurious ConcurrentModificationError
  // on a row nobody else has touched yet.
  const [justCreated] = await db().select({ updatedAt: products.updatedAt }).from(products).where(eq(products.id, newId)).limit(1);
  await updateProductPrice(orgId, newId, source.basePrice, justCreated!.updatedAt, actorUserId);
  await setProductImages(orgId, newId, source.images);
  if (source.modifierGroupIds.length > 0) await setProductModifierGroups(orgId, newId, source.modifierGroupIds, actorUserId);

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
export async function setProductModifierGroups(orgId: string, productId: string, groupIds: readonly string[], actorUserId: string | null = null): Promise<void> {
  await assertProductOwned(orgId, productId);

  if (groupIds.length > 0) {
    const owned = await db().select({ id: modifierGroups.id }).from(modifierGroups).where(and(inArray(modifierGroups.id, [...groupIds]), eq(modifierGroups.orgId, orgId)));
    if (owned.length !== new Set(groupIds).size) throw new CrossOrgReference("modifier group");
  }

  const database = db();
  const [product, before, allGroups] = await Promise.all([
    database.select({ name: products.name }).from(products).where(eq(products.id, productId)).limit(1),
    database.select({ groupId: productModifierGroups.groupId }).from(productModifierGroups).where(eq(productModifierGroups.productId, productId)),
    database.select({ id: modifierGroups.id, name: modifierGroups.name }).from(modifierGroups).where(eq(modifierGroups.orgId, orgId)),
  ]);
  const nameById = new Map(allGroups.map((g) => [g.id, g.name]));
  const beforeNames = before.map((b) => nameById.get(b.groupId) ?? b.groupId).sort().join(", ");
  const afterNames = groupIds.map((id) => nameById.get(id) ?? id).sort().join(", ");

  await database.transaction(async (tx) => {
    await tx.delete(productModifierGroups).where(eq(productModifierGroups.productId, productId));
    if (groupIds.length > 0) {
      await tx.insert(productModifierGroups).values(groupIds.map((groupId, position) => ({ productId, groupId, position })));
    }
  });

  if (product[0]) {
    await logChanges({
      orgId,
      entityType: "product",
      entityId: productId,
      entityName: product[0].name,
      actorUserId,
      changes: [{ field: "modifier groups", oldValue: beforeNames || null, newValue: afterNames || null }],
    });
  }
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
  readonly updatedAt: Date;
  readonly modifiers: readonly { id: string; name: string; slug: string; priceDelta: Paise; isDefault: boolean; isAvailable: boolean; updatedAt: Date }[];
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
    updatedAt: group.updatedAt,
    modifiers: modifierRows
      .filter((m) => m.groupId === group.id)
      .map((m) => ({ id: m.id, name: m.name, slug: m.slug, priceDelta: m.priceDelta as Paise, isDefault: m.isDefault, isAvailable: m.isAvailable, updatedAt: m.updatedAt })),
  }));
}

export interface ModifierGroupInput {
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly minSelections: number;
  readonly maxSelections: number | null;
}

export async function createModifierGroup(orgId: string, input: ModifierGroupInput, actorUserId: string | null = null): Promise<{ id: string }> {
  const [row] = await db().insert(modifierGroups).values({ orgId, ...input, status: "DRAFT" }).returning({ id: modifierGroups.id });
  if (!row) throw new Error("menu-admin: could not create modifier group");
  await auditCreate({ orgId, entityType: "modifierGroup", entityId: row.id, entityName: input.name, actorUserId });
  return row;
}

/** Concurrency-guarded (§0.2) — a modifier group's full edit form. */
export async function updateModifierGroup(orgId: string, id: string, input: ModifierGroupInput, expectedUpdatedAt: Date, actorUserId: string | null = null): Promise<void> {
  const [before] = await db().select({ name: modifierGroups.name, minSelections: modifierGroups.minSelections, maxSelections: modifierGroups.maxSelections }).from(modifierGroups).where(and(eq(modifierGroups.id, id), eq(modifierGroups.orgId, orgId))).limit(1);

  const [updated] = await db()
    .update(modifierGroups)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(modifierGroups.id, id), eq(modifierGroups.orgId, orgId), sameUpdatedAt(modifierGroups.updatedAt, expectedUpdatedAt)))
    .returning({ id: modifierGroups.id });

  if (!updated) {
    const [current] = await db().select({ id: modifierGroups.id }).from(modifierGroups).where(and(eq(modifierGroups.id, id), eq(modifierGroups.orgId, orgId))).limit(1);
    if (current) throw new ConcurrentModificationError("modifier group");
    return;
  }

  if (before) {
    await logChanges({
      orgId,
      entityType: "modifierGroup",
      entityId: id,
      entityName: input.name,
      actorUserId,
      changes: [
        { field: "name", oldValue: before.name, newValue: input.name },
        { field: "min selections (required/optional)", oldValue: before.minSelections, newValue: input.minSelections },
        { field: "max selections", oldValue: before.maxSelections, newValue: input.maxSelections },
      ],
    });
  }
}

export async function publishModifierGroup(orgId: string, id: string, actorUserId: string | null = null): Promise<void> {
  const [before] = await db().select({ name: modifierGroups.name, status: modifierGroups.status }).from(modifierGroups).where(and(eq(modifierGroups.id, id), eq(modifierGroups.orgId, orgId))).limit(1);
  await db().update(modifierGroups).set({ status: "PUBLISHED", updatedAt: new Date() }).where(and(eq(modifierGroups.id, id), eq(modifierGroups.orgId, orgId)));
  if (before) {
    await logChanges({ orgId, entityType: "modifierGroup", entityId: id, entityName: before.name, actorUserId, changes: [{ field: "status", oldValue: before.status, newValue: "PUBLISHED" }] });
  }
}

export async function deleteModifierGroup(orgId: string, id: string, actorUserId: string | null = null): Promise<{ ok: boolean; error?: string }> {
  const [inUse] = await db().select({ id: productModifierGroups.id }).from(productModifierGroups).where(eq(productModifierGroups.groupId, id)).limit(1);
  if (inUse) return { ok: false, error: "This group is still assigned to a product. Remove it there first." };
  const [deleted] = await db().delete(modifierGroups).where(and(eq(modifierGroups.id, id), eq(modifierGroups.orgId, orgId))).returning({ name: modifierGroups.name });
  if (deleted) await auditDelete({ orgId, entityType: "modifierGroup", entityId: id, entityName: deleted.name, actorUserId });
  return { ok: true };
}

export interface ModifierInput {
  readonly name: string;
  readonly slug: string;
  readonly priceDelta: Paise;
  readonly isDefault: boolean;
  readonly isAvailable: boolean;
}

export async function addModifier(orgId: string, groupId: string, input: ModifierInput, actorUserId: string | null = null): Promise<void> {
  await assertModifierGroupOwned(orgId, groupId);
  const [max] = await db().select({ position: sql<number>`coalesce(max(${modifiers.position}), -1)` }).from(modifiers).where(eq(modifiers.groupId, groupId));
  const [row] = await db().insert(modifiers).values({ orgId, groupId, ...input, position: (max?.position ?? -1) + 1 }).returning({ id: modifiers.id });
  if (row) await auditCreate({ orgId, entityType: "modifier", entityId: row.id, entityName: input.name, actorUserId });
}

/** Reorders an option within its group — the group editor's "move up/down", the same swap products and categories use. */
export async function moveModifierPosition(orgId: string, id: string, direction: "up" | "down"): Promise<void> {
  const [target] = await db().select({ groupId: modifiers.groupId }).from(modifiers).where(and(eq(modifiers.id, id), eq(modifiers.orgId, orgId))).limit(1);
  if (!target) return;

  const siblings = await db()
    .select({ id: modifiers.id, position: modifiers.position })
    .from(modifiers)
    .where(and(eq(modifiers.orgId, orgId), eq(modifiers.groupId, target.groupId)))
    .orderBy(asc(modifiers.position), asc(modifiers.createdAt));

  const writes = planSwap(siblings, id, direction);
  if (!writes) return;

  await db().transaction(async (tx) => {
    for (const write of writes) {
      await tx.update(modifiers).set({ position: write.position, updatedAt: new Date() }).where(and(eq(modifiers.id, write.id), eq(modifiers.orgId, orgId)));
    }
  });
}

/** Concurrency-guarded (§0.2) — a modifier option's full edit form. */
export async function updateModifier(orgId: string, id: string, input: ModifierInput, expectedUpdatedAt: Date, actorUserId: string | null = null): Promise<void> {
  const [before] = await db().select({ name: modifiers.name, priceDelta: modifiers.priceDelta, isAvailable: modifiers.isAvailable }).from(modifiers).where(and(eq(modifiers.id, id), eq(modifiers.orgId, orgId))).limit(1);

  const [updated] = await db()
    .update(modifiers)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(modifiers.id, id), eq(modifiers.orgId, orgId), sameUpdatedAt(modifiers.updatedAt, expectedUpdatedAt)))
    .returning({ id: modifiers.id });

  if (!updated) {
    const [current] = await db().select({ id: modifiers.id }).from(modifiers).where(and(eq(modifiers.id, id), eq(modifiers.orgId, orgId))).limit(1);
    if (current) throw new ConcurrentModificationError("modifier option");
    return;
  }

  if (before) {
    await logChanges({
      orgId,
      entityType: "modifier",
      entityId: id,
      entityName: input.name,
      actorUserId,
      changes: [
        { field: "name", oldValue: before.name, newValue: input.name },
        { field: "price (paise)", oldValue: before.priceDelta.toString(), newValue: input.priceDelta.toString() },
        { field: "available", oldValue: before.isAvailable, newValue: input.isAvailable },
      ],
    });
  }
}

export async function deleteModifier(orgId: string, id: string, actorUserId: string | null = null): Promise<void> {
  const [deleted] = await db().delete(modifiers).where(and(eq(modifiers.id, id), eq(modifiers.orgId, orgId))).returning({ name: modifiers.name });
  if (deleted) await auditDelete({ orgId, entityType: "modifier", entityId: id, entityName: deleted.name, actorUserId });
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
export async function addComboItem(orgId: string, comboProductId: string, productId: string, quantity: number, actorUserId: string | null = null): Promise<void> {
  await assertProductOwned(orgId, comboProductId);
  await assertProductOwned(orgId, productId);
  const database = db();
  const [max, combo, item] = await Promise.all([
    database.select({ position: sql<number>`coalesce(max(${comboItems.position}), -1)` }).from(comboItems).where(eq(comboItems.comboProductId, comboProductId)),
    database.select({ name: products.name }).from(products).where(eq(products.id, comboProductId)).limit(1),
    database.select({ name: products.name }).from(products).where(eq(products.id, productId)).limit(1),
  ]);
  await database.insert(comboItems).values({ comboProductId, productId, quantity, position: (max[0]?.position ?? -1) + 1 });

  if (combo[0]) {
    await logChanges({
      orgId,
      entityType: "combo",
      entityId: comboProductId,
      entityName: combo[0].name,
      actorUserId,
      changes: [{ field: "composition", oldValue: null, newValue: `+${quantity}× ${item[0]?.name ?? "item"}` }],
    });
  }
}

export async function removeComboItem(orgId: string, id: string, actorUserId: string | null = null): Promise<void> {
  const database = db();
  const [row] = await database
    .select({ id: comboItems.id, comboProductId: comboItems.comboProductId, comboName: products.name, itemProductId: comboItems.productId, quantity: comboItems.quantity })
    .from(comboItems)
    .innerJoin(products, eq(comboItems.comboProductId, products.id))
    .where(and(eq(comboItems.id, id), eq(products.orgId, orgId)))
    .limit(1);
  if (!row) return;

  const [item] = await database.select({ name: products.name }).from(products).where(eq(products.id, row.itemProductId)).limit(1);
  await database.delete(comboItems).where(eq(comboItems.id, id));

  await logChanges({
    orgId,
    entityType: "combo",
    entityId: row.comboProductId,
    entityName: row.comboName,
    actorUserId,
    changes: [{ field: "composition", oldValue: `${row.quantity}× ${item?.name ?? "item"}`, newValue: null }],
  });
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
/* Recipe — a product's ingredient lines, versioned on every save.     */
/*                                                                     */
/* `recipe_items` (see src/db/schema/inventory.ts) is the pre-         */
/* versioning table its own schema comment describes as "left in       */
/* place, empty, for a later, separately approved cleanup" — nothing   */
/* here reads or writes it. Status, detail and cost all come from      */
/* `recipeVersions` + `recipeVersionItems`, the same pair a SALE       */
/* movement will name once Phase 3.4 consumes stock, so a recipe's     */
/* cost today is provably the same recipe a later sale would have      */
/* charged against.                                                    */
/* ------------------------------------------------------------------ */

export async function createBareRecipe(orgId: string, productId: string, yieldQuantity: number): Promise<void> {
  await assertProductOwned(orgId, productId);
  await db().insert(recipes).values({ orgId, productId, yieldQuantity }).onConflictDoNothing({ target: recipes.productId });
}

/**
 * Every ingredient a recipe line editor might need to show or offer.
 *
 * Includes inactive ingredients rather than filtering them out here: a
 * retired ingredient can still be a line on an existing recipe, and the
 * editor needs its name, unit and rate to render that line even though it
 * should not appear as a choice for a *new* line. `isActive` lets the
 * client draw that distinction instead of the repository silently deciding
 * it by omission.
 */
export interface RecipeIngredientOption {
  readonly id: string;
  readonly name: string;
  readonly baseUnit: BaseUnit;
  readonly costPerBaseUnitMilli: MilliPaise;
  readonly isPackaging: boolean;
  readonly isActive: boolean;
}

export async function listIngredientOptions(orgId: string): Promise<readonly RecipeIngredientOption[]> {
  const rows = await db()
    .select({
      id: ingredients.id,
      name: ingredients.name,
      baseUnit: ingredients.baseUnit,
      costPerBaseUnitMilli: ingredients.costPerBaseUnitMilli,
      isPackaging: ingredients.isPackaging,
      isActive: ingredients.isActive,
    })
    .from(ingredients)
    .where(eq(ingredients.orgId, orgId))
    .orderBy(asc(ingredients.name));

  // Only G, ML and PIECE are ever written to this column (validated at the
  // boundary); the column type is the wider enum used across all of `units`.
  return rows.map((row) => ({ ...row, baseUnit: row.baseUnit as BaseUnit, costPerBaseUnitMilli: row.costPerBaseUnitMilli as MilliPaise }));
}

export interface RecipeLineView {
  readonly ingredientId: string;
  readonly ingredientName: string;
  readonly baseUnit: BaseUnit;
  /** In the ingredient's base unit — recipe_version_items.quantity, unconverted. */
  readonly quantityBase: number;
  readonly cost: Paise;
  /** False when the ingredient behind this line has never had a price recorded — the cost shown is not really zero, it is unknown. */
  readonly priced: boolean;
}

export interface RecipeDetail {
  readonly recipeId: string;
  readonly linked: boolean;
  readonly yieldQuantity: number;
  /** Null until the first version is saved — a bare header consumes and costs nothing. */
  readonly version: number | null;
  readonly lines: readonly RecipeLineView[];
  /** Cost of one full batch. Null, not zero, when there are no lines yet. */
  readonly theoreticalCost: Paise | null;
  /** `theoreticalCost` divided across the batch's yield — what one portion is estimated to cost. */
  readonly costPerPortion: Paise | null;
}

export async function getRecipeDetail(orgId: string, productId: string): Promise<RecipeDetail | null> {
  const [recipe] = await db().select().from(recipes).where(and(eq(recipes.orgId, orgId), eq(recipes.productId, productId))).limit(1);
  if (!recipe) return null;

  if (!recipe.currentVersionId) {
    return { recipeId: recipe.id, linked: true, yieldQuantity: recipe.yieldQuantity, version: null, lines: [], theoreticalCost: null, costPerPortion: null };
  }

  const [[versionRow], rows] = await Promise.all([
    db().select({ version: recipeVersions.version }).from(recipeVersions).where(eq(recipeVersions.id, recipe.currentVersionId)).limit(1),
    db()
      .select({
        ingredientId: recipeVersionItems.ingredientId,
        ingredientName: ingredients.name,
        baseUnit: ingredients.baseUnit,
        quantityBase: recipeVersionItems.quantity,
        costPerBaseUnitMilli: ingredients.costPerBaseUnitMilli,
      })
      .from(recipeVersionItems)
      .innerJoin(ingredients, eq(ingredients.id, recipeVersionItems.ingredientId))
      .where(eq(recipeVersionItems.versionId, recipe.currentVersionId))
      .orderBy(asc(ingredients.name)),
  ]);

  const costed = theoreticalRecipeCost(
    rows.map((row) => ({ ingredientId: row.ingredientId, quantityBase: row.quantityBase, costPerBaseUnitMilli: row.costPerBaseUnitMilli as MilliPaise })),
  );
  const costByIngredient = new Map(costed.lines.map((line) => [line.ingredientId, line]));

  return {
    recipeId: recipe.id,
    linked: true,
    yieldQuantity: recipe.yieldQuantity,
    version: versionRow?.version ?? null,
    lines: rows.map((row) => {
      const costedLine = costByIngredient.get(row.ingredientId);
      return {
        ingredientId: row.ingredientId,
        ingredientName: row.ingredientName,
        baseUnit: row.baseUnit as BaseUnit,
        quantityBase: row.quantityBase,
        cost: costedLine?.cost ?? paise(0),
        priced: costedLine?.priced ?? false,
      };
    }),
    theoreticalCost: costed.total,
    costPerPortion: costed.total === null ? null : scale(costed.total, 1, Math.max(recipe.yieldQuantity, 1)),
  };
}

export interface RecipeLineDraft {
  readonly ingredientId: string;
  /** In the ingredient's base unit — an integer greater than zero. */
  readonly quantityBase: number;
}

export type SaveRecipeVersionResult = { ok: true } | { ok: false; error: string };

/**
 * Records a new state of a recipe. Never edits `recipeVersionItems` for an
 * existing version — a save always writes a fresh `recipeVersions` row,
 * points `recipes.currentVersionId` at it, and marks the previous version
 * superseded. §51's rule for order lines applies here for the same reason:
 * a SALE movement that names a recipe version must never have its cost
 * rewritten by a later recipe change.
 */
export async function saveRecipeVersion(orgId: string, productId: string, lines: readonly RecipeLineDraft[], actorUserId: string | null): Promise<SaveRecipeVersionResult> {
  const ids = lines.map((line) => line.ingredientId);
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: "Each ingredient can only appear once in a recipe." };
  }
  for (const line of lines) {
    if (!Number.isInteger(line.quantityBase) || line.quantityBase <= 0) {
      return { ok: false, error: "Every line needs a whole-number quantity greater than zero." };
    }
  }

  return db().transaction(async (tx) => {
    const [product] = await tx.select({ id: products.id, name: products.name }).from(products).where(and(eq(products.id, productId), eq(products.orgId, orgId))).limit(1);
    if (!product) throw new CrossOrgReference("product");

    const [recipe] = await tx.select().from(recipes).where(and(eq(recipes.orgId, orgId), eq(recipes.productId, productId))).limit(1);
    if (!recipe) return { ok: false, error: "Create the recipe before adding ingredients to it." };

    if (ids.length > 0) {
      const owned = await tx.select({ id: ingredients.id }).from(ingredients).where(and(eq(ingredients.orgId, orgId), inArray(ingredients.id, ids)));
      if (owned.length !== new Set(ids).size) throw new CrossOrgReference("ingredient");
    }

    const [existing] = await tx.select({ n: sql<number>`count(*)::int` }).from(recipeVersions).where(eq(recipeVersions.recipeId, recipe.id));
    const nextVersion = (existing?.n ?? 0) + 1;

    if (recipe.currentVersionId) {
      await tx.update(recipeVersions).set({ supersededAt: new Date() }).where(eq(recipeVersions.id, recipe.currentVersionId));
    }

    const [versionRow] = await tx
      .insert(recipeVersions)
      .values({ orgId, recipeId: recipe.id, version: nextVersion, yieldQuantity: recipe.yieldQuantity, createdBy: actorUserId })
      .returning({ id: recipeVersions.id });
    if (!versionRow) throw new Error("recipe: version insert returned no row");

    if (lines.length > 0) {
      await tx.insert(recipeVersionItems).values(lines.map((line) => ({ orgId, versionId: versionRow.id, ingredientId: line.ingredientId, quantity: line.quantityBase })));
    }

    await tx.update(recipes).set({ currentVersionId: versionRow.id, updatedAt: new Date() }).where(eq(recipes.id, recipe.id));

    await logChanges({
      orgId,
      entityType: "recipe",
      entityId: recipe.id,
      entityName: product.name,
      actorUserId,
      changes: [{ field: "version", oldValue: nextVersion === 1 ? null : nextVersion - 1, newValue: nextVersion }],
    });

    return { ok: true };
  });
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
