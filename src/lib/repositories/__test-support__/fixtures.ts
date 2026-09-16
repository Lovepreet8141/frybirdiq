/**
 * Fixtures for the persistence/orchestration integration suite
 * (`pnpm test:integration`, `vitest.integration.config.mts`).
 *
 * Every fixture lives under one fresh organization per test file, created
 * in `beforeAll` and deleted in `afterAll` — `deleteTestOrg` relies on the
 * same `onDelete: "cascade"` on `org_id` every schema file already declares
 * for tenant data, so one delete removes everything a test file created
 * without hand-listing every table. Never used against anything but the
 * local `supabase start` stack — `vitest.integration.setup.ts` refuses to
 * load at all otherwise.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  categories,
  customers,
  ingredients,
  locations,
  memberships,
  organizations,
  products,
  recipeVersionItems,
  recipeVersions,
  recipes,
  taxRates,
} from "@/db/schema";
import { paise } from "@/lib/money";

export interface TestOrg {
  readonly orgId: string;
  readonly locationId: string;
  readonly slug: string;
}

/**
 * A fresh org + one location, isolated from every other test file by a
 * random slug by default.
 *
 * `opts.slug` exists for exactly one reason: `src/lib/repositories/org.ts`'s
 * `requireOrg()` resolves the acting org by the hardcoded slug `"frybird"`
 * (`ORG_SLUG`) rather than trusting a caller-supplied `orgId` — the
 * current, honest reflection of this being a single-tenant deployment.
 * `placeOrder`/`placeCounterOrder` call it internally, so a test that
 * exercises either has no choice but to create its one org under that
 * exact slug. Safe here only because this database is the local,
 * `supabase start` stack and each test FILE gets its own fresh org.
 */
export async function createTestOrg(opts: { readonly slug?: string } = {}): Promise<TestOrg> {
  const slug = opts.slug ?? `test-${randomUUID()}`;
  const [org] = await db().insert(organizations).values({ name: `Integration Test ${slug}`, slug }).returning({ id: organizations.id });
  if (!org) throw new Error("fixtures: organization insert returned no row");

  const [location] = await db()
    .insert(locations)
    .values({ orgId: org.id, name: "Test Location", slug: "main" })
    .returning({ id: locations.id });
  if (!location) throw new Error("fixtures: location insert returned no row");

  return { orgId: org.id, locationId: location.id, slug };
}

/** Cascades: deleting the organization row removes every fixture and every row a test wrote under it. */
export async function deleteTestOrg(orgId: string): Promise<void> {
  await db().delete(organizations).where(eq(organizations.id, orgId));
}

export interface TestTaxRate {
  readonly id: string;
  readonly rateBps: number;
}

/** 5% GST, the real rate FRYBIRD's own menu uses, so priced totals in tests look like real bills. */
export async function createTestTaxRate(orgId: string, rateBps = 500): Promise<TestTaxRate> {
  const [rate] = await db().insert(taxRates).values({ orgId, name: `GST ${rateBps / 100}%`, rateBps, isDefault: true }).returning({ id: taxRates.id });
  if (!rate) throw new Error("fixtures: tax rate insert returned no row");
  return { id: rate.id, rateBps };
}

export interface TestProduct {
  readonly id: string;
  readonly slug: string;
  readonly basePriceRupees: string;
}

/** A single PUBLISHED, active product — enough for placeCounterOrder/placeOrder to price and consume. */
export async function createTestProduct(
  orgId: string,
  opts: { readonly taxRateId?: string; readonly basePriceRupees?: string; readonly name?: string } = {},
): Promise<TestProduct> {
  const slug = `test-product-${randomUUID()}`;
  const [category] = await db()
    .insert(categories)
    .values({ orgId, name: "Test Category", slug: `test-category-${randomUUID()}`, status: "PUBLISHED" })
    .returning({ id: categories.id });
  if (!category) throw new Error("fixtures: category insert returned no row");

  const basePriceRupees = opts.basePriceRupees ?? "99";
  const [product] = await db()
    .insert(products)
    .values({
      orgId,
      categoryId: category.id,
      name: opts.name ?? "Test Product",
      slug,
      basePrice: rupeesToPaise(basePriceRupees),
      taxRateId: opts.taxRateId,
      status: "PUBLISHED",
      isActive: true,
    })
    .returning({ id: products.id });
  if (!product) throw new Error("fixtures: product insert returned no row");

  return { id: product.id, slug, basePriceRupees };
}

export interface TestIngredient {
  readonly id: string;
}

/** One ingredient with a known cost, so consumption's SALE movement has a real, checkable totalCost. */
export async function createTestIngredient(orgId: string, costPerBaseUnitPaise = 1n): Promise<TestIngredient> {
  const [ingredient] = await db()
    .insert(ingredients)
    .values({
      orgId,
      name: `Test Ingredient ${randomUUID()}`,
      baseUnit: "G",
      costPerBaseUnit: paise(costPerBaseUnitPaise),
      costPerBaseUnitMilli: costPerBaseUnitPaise * 1000n,
    })
    .returning({ id: ingredients.id });
  if (!ingredient) throw new Error("fixtures: ingredient insert returned no row");
  return { id: ingredient.id };
}

/**
 * Links a product to a one-line recipe (recipes → recipeVersions →
 * recipeVersionItems, matching menu-admin's own versioning shape) so
 * recordConsumption has something real to consume.
 */
export async function createTestRecipe(orgId: string, productId: string, ingredientId: string, quantityBase: number): Promise<void> {
  const [recipe] = await db().insert(recipes).values({ orgId, productId, yieldQuantity: 1 }).returning({ id: recipes.id });
  if (!recipe) throw new Error("fixtures: recipe insert returned no row");

  const [version] = await db()
    .insert(recipeVersions)
    .values({ orgId, recipeId: recipe.id, version: 1, yieldQuantity: 1 })
    .returning({ id: recipeVersions.id });
  if (!version) throw new Error("fixtures: recipe version insert returned no row");

  await db().insert(recipeVersionItems).values({ orgId, versionId: version.id, ingredientId, quantity: quantityBase });
  await db().update(recipes).set({ currentVersionId: version.id }).where(eq(recipes.id, recipe.id));
}

export interface TestCustomer {
  readonly id: string;
  readonly phone: string;
}

export async function createTestCustomer(orgId: string): Promise<TestCustomer> {
  const phone = `9${Math.floor(100000000 + Math.random() * 899999999)}`;
  const [customer] = await db().insert(customers).values({ orgId, phone, name: "Test Customer" }).returning({ id: customers.id });
  if (!customer) throw new Error("fixtures: customer insert returned no row");
  return { id: customer.id, phone };
}

/** A membership row — the one thing `staff.orgId`-style authorization checks ultimately read. Not exercised by these tests (they call repository functions directly, already past that layer), kept for completeness/future use. */
export async function createTestStaffMembership(orgId: string, userId: string, role: "OWNER" | "ADMIN" | "MANAGER" | "CASHIER" | "KITCHEN" | "RIDER" | "INVENTORY" | "ANALYST" = "OWNER"): Promise<void> {
  await db().insert(memberships).values({ orgId, userId, role, isActive: true });
}

function rupeesToPaise(rupees: string): bigint {
  const [whole, fraction = ""] = rupees.split(".");
  const paiseFraction = (fraction + "00").slice(0, 2);
  return BigInt(whole || "0") * 100n + BigInt(paiseFraction || "0");
}
