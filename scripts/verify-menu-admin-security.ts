/**
 * Regression check for the Menu Manager's cross-organization ownership
 * guards and its two now-transactional writes — against the real database,
 * the same pattern as `scripts/verify-rewards-ledger.ts` (no DB test
 * harness exists in this codebase; this is the closest thing to an
 * automated test for repository-layer invariants only a real database can
 * prove).
 *
 *     pnpm exec tsx --conditions=react-server scripts/verify-menu-admin-security.ts
 *
 * Creates two throwaway organizations (never the real "frybird" org) with
 * minimal rows under each, attempts writes that reference the *other* org's
 * ids, asserts every one is rejected and leaves no trace, then asserts the
 * same operations succeed when the ids actually belong to the caller's own
 * org. Deletes everything it made whether it passes or fails.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../src/db/connection";
import { categories, modifierGroups, modifiers, organizations, productModifierGroups, products, taxRates, productAvailability, comboItems, recipes, media } from "../src/db/schema";
import {
  CrossOrgReference,
  addComboItem,
  addModifier,
  createBareRecipe,
  createProduct,
  moveCategory,
  setAvailabilityRule,
  setProductModifierGroups,
  updateProductDetails,
} from "../src/lib/repositories/menu-admin";
import { deleteMedia } from "../src/lib/repositories/media";

let ok = true;
function assert(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) ok = false;
}
async function assertRejected(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    assert(label, false);
  } catch (error) {
    assert(label, error instanceof CrossOrgReference);
  }
}

async function main() {
  const database = db();
  const suffix = randomUUID().slice(0, 8);

  const [orgA] = await database.insert(organizations).values({ name: `Audit Org A ${suffix}`, slug: `audit-org-a-${suffix}` }).returning();
  const [orgB] = await database.insert(organizations).values({ name: `Audit Org B ${suffix}`, slug: `audit-org-b-${suffix}` }).returning();
  if (!orgA || !orgB) throw new Error("Could not create test organizations.");

  const [catA] = await database.insert(categories).values({ orgId: orgA.id, name: "A category", slug: `a-cat-${suffix}`, position: 0 }).returning();
  const [catA2] = await database.insert(categories).values({ orgId: orgA.id, name: "A category 2", slug: `a-cat2-${suffix}`, position: 1 }).returning();
  const [catA3] = await database.insert(categories).values({ orgId: orgA.id, name: "A category 3", slug: `a-cat3-${suffix}`, position: 2 }).returning();
  const [catB] = await database.insert(categories).values({ orgId: orgB.id, name: "B category", slug: `b-cat-${suffix}` }).returning();
  const [taxB] = await database.insert(taxRates).values({ orgId: orgB.id, name: "B rate", rateBps: 500 }).returning();
  const [prodA] = await database.insert(products).values({ orgId: orgA.id, categoryId: catA!.id, name: "A product", slug: `a-prod-${suffix}`, basePrice: 10000n }).returning();
  const [prodB] = await database.insert(products).values({ orgId: orgB.id, categoryId: catB!.id, name: "B product", slug: `b-prod-${suffix}`, basePrice: 10000n }).returning();
  const [groupA] = await database.insert(modifierGroups).values({ orgId: orgA.id, name: "A group", slug: `a-group-${suffix}` }).returning();
  const [groupB] = await database.insert(modifierGroups).values({ orgId: orgB.id, name: "B group", slug: `b-group-${suffix}` }).returning();
  if (!catA || !catB || !taxB || !prodA || !prodB || !groupA || !groupB) throw new Error("Fixture setup failed.");

  try {
    console.log("\n--- Cross-org rejection: category/tax rate on product create+update ---");
    await assertRejected("createProduct refuses a category from another org", () =>
      createProduct(orgA.id, { name: "x", slug: `x-${suffix}`, description: null, shortDescription: null, categoryId: catB.id, taxRateId: null, spiceLevel: 0, isVegetarian: false, allergens: [], tags: [], sku: null, prepMinutes: null, kdsStation: null }),
    );
    await assertRejected("createProduct refuses a tax rate from another org", () =>
      createProduct(orgA.id, { name: "x", slug: `y-${suffix}`, description: null, shortDescription: null, categoryId: null, taxRateId: taxB.id, spiceLevel: 0, isVegetarian: false, allergens: [], tags: [], sku: null, prepMinutes: null, kdsStation: null }),
    );
    await assertRejected("updateProductDetails refuses a category from another org", () =>
      updateProductDetails(orgA.id, prodA.id, { name: "A product", slug: prodA.slug, description: null, shortDescription: null, categoryId: catB.id, taxRateId: null, spiceLevel: 0, isVegetarian: false, allergens: [], tags: [], sku: null, prepMinutes: null, kdsStation: null }),
    );
    const [unchanged] = await database.select({ categoryId: products.categoryId }).from(products).where(eq(products.id, prodA.id));
    assert("the rejected update left the product's real category untouched", unchanged?.categoryId === catA.id);

    console.log("\n--- Cross-org rejection: setProductModifierGroups ---");
    await assertRejected("setProductModifierGroups refuses a modifier group from another org", () => setProductModifierGroups(orgA.id, prodA.id, [groupB.id]));
    const linksAfterReject = await database.select().from(productModifierGroups).where(eq(productModifierGroups.productId, prodA.id));
    assert("no productModifierGroups row was created by the rejected call", linksAfterReject.length === 0);

    console.log("\n--- Cross-org rejection: setAvailabilityRule ---");
    await assertRejected("setAvailabilityRule refuses a product from another org", () => setAvailabilityRule(orgA.id, prodB.id, { locationId: null, channel: null, status: "SOLD_OUT_TODAY", unavailableUntil: null, reason: "audit" }));
    const rulesAfterReject = await database.select().from(productAvailability).where(eq(productAvailability.productId, prodB.id));
    assert("no availability row was created against the foreign product", rulesAfterReject.length === 0);

    console.log("\n--- Cross-org rejection: addComboItem, addModifier, createBareRecipe ---");
    await assertRejected("addComboItem refuses bundling a product from another org", () => addComboItem(orgA.id, prodA.id, prodB.id, 1));
    const comboAfterReject = await database.select().from(comboItems).where(eq(comboItems.comboProductId, prodA.id));
    assert("no combo item row was created against the foreign product", comboAfterReject.length === 0);

    await assertRejected("addModifier refuses a modifier group from another org", () => addModifier(orgA.id, groupB.id, { name: "x", slug: `x-${suffix}`, priceDelta: 0n as never, isDefault: false, isAvailable: true }));
    const modifiersAfterReject = await database.select().from(modifiers).where(eq(modifiers.groupId, groupB.id));
    assert("no modifier row was created against the foreign group", modifiersAfterReject.length === 0);

    await assertRejected("createBareRecipe refuses a product from another org", () => createBareRecipe(orgA.id, prodB.id, 1));
    const recipesAfterReject = await database.select().from(recipes).where(eq(recipes.productId, prodB.id));
    assert("no recipe row was created against the foreign product", recipesAfterReject.length === 0);

    console.log("\n--- Positive control: the same operations succeed within one's own org ---");
    await setProductModifierGroups(orgA.id, prodA.id, [groupA.id]);
    const ownGroupLinks = await database.select().from(productModifierGroups).where(eq(productModifierGroups.productId, prodA.id));
    assert("setProductModifierGroups succeeds for the caller's own group", ownGroupLinks.length === 1 && ownGroupLinks[0]?.groupId === groupA.id);

    await setAvailabilityRule(orgA.id, prodA.id, { locationId: null, channel: null, status: "TEMPORARILY_UNAVAILABLE", unavailableUntil: null, reason: "audit-own" });
    const ownRule = await database.select().from(productAvailability).where(eq(productAvailability.productId, prodA.id));
    assert("setAvailabilityRule succeeds for the caller's own product", ownRule.length === 1 && ownRule[0]?.status === "TEMPORARILY_UNAVAILABLE");

    console.log("\n--- moveCategory: atomic swap, and refuses a foreign category id ---");
    await moveCategory(orgA.id, catA2!.id, "up"); // swap catA (pos 0) and catA2 (pos 1)
    const afterSwap = await database.select({ id: categories.id, position: categories.position }).from(categories).where(eq(categories.orgId, orgA.id));
    const posOf = (id: string) => afterSwap.find((c) => c.id === id)?.position;
    assert("catA and catA2 swapped positions", posOf(catA.id) === 1 && posOf(catA2!.id) === 0);
    assert("catA3 (not involved in the swap) kept its position", posOf(catA3!.id) === 2);
    assert("no two categories in this org share a position after the swap", new Set(afterSwap.map((c) => c.position)).size === afterSwap.length);

    const [catBBefore] = await database.select({ position: categories.position }).from(categories).where(eq(categories.id, catB.id));
    await moveCategory(orgA.id, catB.id, "up"); // catB does not belong to orgA — must no-op
    const [catBAfter] = await database.select({ position: categories.position }).from(categories).where(eq(categories.id, catB.id));
    assert("moveCategory does not touch a category from another org", catBBefore?.position === catBAfter?.position);

    console.log("\n--- deleteMedia: refuses while a product still references the photo ---");
    const photoUrl = `https://example.supabase.co/storage/v1/object/public/media/${orgA.id}/audit-${suffix}.jpg`;
    const [mediaRow] = await database.insert(media).values({ orgId: orgA.id, url: photoUrl, alt: "audit" }).returning();
    if (!mediaRow) throw new Error("Could not create test media row.");
    await database.update(products).set({ images: [{ url: photoUrl, alt: "audit" }] }).where(eq(products.id, prodA.id));

    const refusedDelete = await deleteMedia(orgA.id, mediaRow.id);
    assert("deleteMedia refuses while the product still references the photo", refusedDelete.ok === false);
    const [stillThere] = await database.select({ id: media.id }).from(media).where(eq(media.id, mediaRow.id));
    assert("the media row survives the refused delete", stillThere !== undefined);

    await database.update(products).set({ images: [] }).where(eq(products.id, prodA.id));
    const allowedDelete = await deleteMedia(orgA.id, mediaRow.id);
    assert("deleteMedia succeeds once nothing references the photo", allowedDelete.ok === true);
  } finally {
    console.log("\n--- Cleanup ---");
    await database.delete(productAvailability).where(eq(productAvailability.orgId, orgA.id));
    await database.delete(productModifierGroups).where(eq(productModifierGroups.productId, prodA.id));
    await database.delete(comboItems).where(eq(comboItems.comboProductId, prodA.id));
    await database.delete(recipes).where(eq(recipes.orgId, orgB.id));
    await database.delete(modifiers).where(eq(modifiers.orgId, orgA.id));
    await database.delete(modifiers).where(eq(modifiers.orgId, orgB.id));
    await database.delete(modifierGroups).where(eq(modifierGroups.orgId, orgA.id));
    await database.delete(modifierGroups).where(eq(modifierGroups.orgId, orgB.id));
    await database.delete(media).where(eq(media.orgId, orgA.id));
    await database.delete(products).where(eq(products.orgId, orgA.id));
    await database.delete(products).where(eq(products.orgId, orgB.id));
    await database.delete(categories).where(eq(categories.orgId, orgA.id));
    await database.delete(categories).where(eq(categories.orgId, orgB.id));
    await database.delete(taxRates).where(eq(taxRates.orgId, orgB.id));
    await database.delete(organizations).where(eq(organizations.id, orgA.id));
    await database.delete(organizations).where(eq(organizations.id, orgB.id));
    console.log("Test data removed.");
  }

  console.log(ok ? "\nALL PASS" : "\nSOME FAILED");
  if (!ok) process.exitCode = 1;
}

main()
  .then(async () => {
    await closeDb();
  })
  .catch(async (error) => {
    console.error(error);
    await closeDb();
    process.exitCode = 1;
  });
