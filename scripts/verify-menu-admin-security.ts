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
import { eq, and } from "drizzle-orm";
import { closeDb, db } from "../src/db/connection";
import { categories, categoryAvailability, modifierGroups, modifiers, organizations, productModifierGroups, products, taxRates, productAvailability, comboItems, recipes, media, priceHistory } from "../src/db/schema";
import {
  ConcurrentModificationError,
  CrossOrgReference,
  addComboItem,
  addModifier,
  createBareRecipe,
  createModifierGroup,
  createProduct,
  duplicateProduct,
  getRecentChanges,
  listPriceHistory,
  moveCategory,
  moveProductToCategory,
  publishCategory,
  publishProduct,
  removeComboItem,
  setAvailabilityRule,
  setCategoryAvailabilityRule,
  setProductActive,
  setProductModifierGroups,
  updateModifier,
  updateProductDetails,
  updateProductPrice,
} from "../src/lib/repositories/menu-admin";
import { deleteMedia } from "../src/lib/repositories/media";
import { getMenu } from "../src/lib/repositories/menu";

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
      createProduct(orgA.id, { name: "x", slug: `x-${suffix}`, description: null, shortDescription: null, categoryId: catB.id, taxRateId: null, spiceLevel: 0, isVegetarian: false, allergens: [], tags: [], sku: null, prepMinutes: null, kdsStation: null, servingInfo: null, productType: "SIMPLE" }),
    );
    await assertRejected("createProduct refuses a tax rate from another org", () =>
      createProduct(orgA.id, { name: "x", slug: `y-${suffix}`, description: null, shortDescription: null, categoryId: null, taxRateId: taxB.id, spiceLevel: 0, isVegetarian: false, allergens: [], tags: [], sku: null, prepMinutes: null, kdsStation: null, servingInfo: null, productType: "SIMPLE" }),
    );
    await assertRejected("updateProductDetails refuses a category from another org", () =>
      updateProductDetails(orgA.id, prodA.id, { name: "A product", slug: prodA.slug, description: null, shortDescription: null, categoryId: catB.id, taxRateId: null, spiceLevel: 0, isVegetarian: false, allergens: [], tags: [], sku: null, prepMinutes: null, kdsStation: null, servingInfo: null, productType: "SIMPLE" }, new Date()),
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

    console.log("\n--- Product lifecycle: create, publish, archive ---");
    const { id: newProductId } = await createProduct(orgA.id, {
      name: "Lifecycle test product",
      slug: `lifecycle-${suffix}`,
      description: null,
      shortDescription: null,
      categoryId: catA.id,
      taxRateId: null,
      spiceLevel: 0,
      isVegetarian: false,
      allergens: [],
      tags: [],
      sku: null,
      prepMinutes: null,
      kdsStation: null,
      servingInfo: "Serves 1",
      productType: "SIMPLE",
    });
    const [created] = await database.select({ status: products.status, servingInfo: products.servingInfo }).from(products).where(eq(products.id, newProductId));
    assert("a newly created product starts as DRAFT", created?.status === "DRAFT");
    assert("servingInfo is stored", created?.servingInfo === "Serves 1");

    await publishProduct(orgA.id, newProductId, null);
    const [published] = await database.select({ status: products.status }).from(products).where(eq(products.id, newProductId));
    assert("publishProduct sets status to PUBLISHED", published?.status === "PUBLISHED");

    await setProductActive(orgA.id, newProductId, false, null);
    const [archived] = await database.select({ isActive: products.isActive }).from(products).where(eq(products.id, newProductId));
    assert("setProductActive(false) archives the product", archived?.isActive === false);

    console.log("\n--- Category assignment: moving a product between categories ---");
    await moveProductToCategory(orgA.id, prodA.id, catA2!.id, null);
    const [movedProduct] = await database.select({ categoryId: products.categoryId }).from(products).where(eq(products.id, prodA.id));
    assert("moveProductToCategory updates the product's category", movedProduct?.categoryId === catA2!.id);
    await moveProductToCategory(orgA.id, prodA.id, catA.id, null); // move it back for the rest of the script

    console.log("\n--- Price history: append-only, never a silent overwrite ---");
    const [prodABeforeReprice] = await database.select({ updatedAt: products.updatedAt }).from(products).where(eq(products.id, prodA.id));
    await updateProductPrice(orgA.id, prodA.id, 12000n as never, prodABeforeReprice!.updatedAt, null);
    const historyAfterFirstReprice = await listPriceHistory(orgA.id, prodA.id);
    assert("a real price change writes exactly one price_history row", historyAfterFirstReprice.length === 1);
    assert("the row records the old and new price", historyAfterFirstReprice[0]?.oldPrice === 10000n && historyAfterFirstReprice[0]?.newPrice === 12000n);
    const [prodAAfterReprice] = await database.select({ basePrice: products.basePrice }).from(products).where(eq(products.id, prodA.id));
    assert("products.basePrice reflects the new price", prodAAfterReprice?.basePrice === 12000n);

    const [prodABeforeSamePrice] = await database.select({ updatedAt: products.updatedAt }).from(products).where(eq(products.id, prodA.id));
    await updateProductPrice(orgA.id, prodA.id, 12000n as never, prodABeforeSamePrice!.updatedAt, null);
    const historyAfterSamePrice = await listPriceHistory(orgA.id, prodA.id);
    assert("saving the same price again writes no new row", historyAfterSamePrice.length === 1);

    const [prodABeforeSecondReprice] = await database.select({ updatedAt: products.updatedAt }).from(products).where(eq(products.id, prodA.id));
    await updateProductPrice(orgA.id, prodA.id, 9500n as never, prodABeforeSecondReprice!.updatedAt, null);
    const historyAfterSecondReprice = await listPriceHistory(orgA.id, prodA.id);
    assert("a second real change appends a second row rather than replacing the first", historyAfterSecondReprice.length === 2);
    assert("listPriceHistory returns rows oldest first", historyAfterSecondReprice[0]?.newPrice === 12000n && historyAfterSecondReprice[1]?.newPrice === 9500n);
    assert("the first row is untouched by the second change", historyAfterSecondReprice[0]?.oldPrice === 10000n);

    console.log("\n--- Duplicate product ---");
    const { id: duplicateId } = await duplicateProduct(orgA.id, newProductId);
    const [duplicated] = await database.select({ name: products.name, status: products.status }).from(products).where(eq(products.id, duplicateId));
    assert("duplicateProduct creates a new DRAFT with a '(copy)' name", duplicated?.status === "DRAFT" && (duplicated?.name ?? "").includes("copy"));

    console.log("\n--- Modifier groups & options ---");
    const { id: newGroupId } = await createModifierGroup(orgA.id, { name: "Sauce choice", slug: `sauce-${suffix}`, description: null, minSelections: 1, maxSelections: 1 });
    await addModifier(orgA.id, newGroupId, { name: "Mayo", slug: `mayo-${suffix}`, priceDelta: 0n as never, isDefault: true, isAvailable: true });
    const [mayoOption] = await database.select({ id: modifiers.id }).from(modifiers).where(and(eq(modifiers.groupId, newGroupId), eq(modifiers.slug, `mayo-${suffix}`)));
    assert("addModifier creates the option", mayoOption !== undefined);
    if (mayoOption) {
      const [mayoBefore] = await database.select({ updatedAt: modifiers.updatedAt }).from(modifiers).where(eq(modifiers.id, mayoOption.id));
      await updateModifier(orgA.id, mayoOption.id, { name: "Mayo (updated)", slug: `mayo-${suffix}`, priceDelta: 1000n as never, isDefault: true, isAvailable: true }, mayoBefore!.updatedAt);
      const [updatedOption] = await database.select({ name: modifiers.name, priceDelta: modifiers.priceDelta, updatedAt: modifiers.updatedAt }).from(modifiers).where(eq(modifiers.id, mayoOption.id));
      assert("updateModifier changes name and price", updatedOption?.name === "Mayo (updated)" && updatedOption?.priceDelta === 1000n);

      console.log("\n--- Optimistic concurrency: a stale expectedUpdatedAt is rejected ---");
      let concurrencyRejected = false;
      try {
        await updateModifier(orgA.id, mayoOption.id, { name: "Mayo (stale write)", slug: `mayo-${suffix}`, priceDelta: 0n as never, isDefault: true, isAvailable: true }, mayoBefore!.updatedAt);
      } catch (error) {
        concurrencyRejected = error instanceof ConcurrentModificationError;
      }
      assert("updateModifier throws ConcurrentModificationError when the version token is stale", concurrencyRejected);
      const [afterStaleAttempt] = await database.select({ name: modifiers.name }).from(modifiers).where(eq(modifiers.id, mayoOption.id));
      assert("the stale write did not change the row", afterStaleAttempt?.name === "Mayo (updated)");
    }
    console.log("\n--- Audit log: modifier group and option lifecycle ---");
    const groupChanges = await getRecentChanges(orgA.id, 200);
    assert("creating the modifier group wrote a create entry", groupChanges.some((c) => c.entityId === newGroupId && c.field === "created"));
    assert("adding the option wrote a create entry", mayoOption !== undefined && groupChanges.some((c) => c.entityId === mayoOption.id && c.field === "created"));
    assert("updating the option wrote a name change entry", mayoOption !== undefined && groupChanges.some((c) => c.entityId === mayoOption.id && c.field === "name" && c.newValue === "Mayo (updated)"));

    await database.delete(modifierGroups).where(eq(modifierGroups.id, newGroupId)); // cascades its modifier

    console.log("\n--- Combo products: explicit productType, not the old comboItems.length heuristic ---");
    const { id: comboProductId } = await createProduct(orgA.id, {
      name: "Audit combo",
      slug: `audit-combo-${suffix}`,
      description: null,
      shortDescription: null,
      categoryId: catA.id,
      taxRateId: null,
      spiceLevel: 0,
      isVegetarian: false,
      allergens: [],
      tags: [],
      sku: null,
      prepMinutes: null,
      kdsStation: null,
      servingInfo: null,
      productType: "COMBO",
    });
    const [comboRow] = await database.select({ productType: products.productType }).from(products).where(eq(products.id, comboProductId));
    assert("a product created with productType COMBO stores it, even with zero combo items", comboRow?.productType === "COMBO");

    await addComboItem(orgA.id, comboProductId, prodA.id, 2, null);
    const [comboItemRow] = await database.select({ id: comboItems.id }).from(comboItems).where(eq(comboItems.comboProductId, comboProductId));
    assert("addComboItem creates the composition row", comboItemRow !== undefined);

    const comboChanges = await getRecentChanges(orgA.id, 200);
    assert("creating the combo product wrote a create entry with entityType combo", comboChanges.some((c) => c.entityId === comboProductId && c.field === "created" && c.entityType === "combo"));
    assert("adding a combo item wrote a composition change entry", comboChanges.some((c) => c.entityId === comboProductId && c.field === "composition" && c.oldValue === null));

    if (comboItemRow) {
      await removeComboItem(orgA.id, comboItemRow.id, null);
      const afterRemoval = await database.select().from(comboItems).where(eq(comboItems.id, comboItemRow.id));
      assert("removeComboItem deletes the composition row", afterRemoval.length === 0);
      const comboChangesAfterRemoval = await getRecentChanges(orgA.id, 200);
      assert("removing a combo item wrote a composition change entry", comboChangesAfterRemoval.some((c) => c.entityId === comboProductId && c.field === "composition" && c.newValue === null));
    }

    console.log("\n--- Scheduled availability ---");
    const backAt = new Date(Date.now() + 60 * 60 * 1000);
    await setAvailabilityRule(orgA.id, prodA.id, { locationId: null, channel: null, status: "SCHEDULED_UNAVAILABLE", unavailableUntil: backAt, reason: "Kitchen issue" }, null);
    const [scheduledRule] = await database.select().from(productAvailability).where(eq(productAvailability.productId, prodA.id));
    assert("a SCHEDULED_UNAVAILABLE rule stores its return time", scheduledRule?.status === "SCHEDULED_UNAVAILABLE" && scheduledRule?.unavailableUntil?.getTime() === backAt.getTime());
    await setAvailabilityRule(orgA.id, prodA.id, { locationId: null, channel: null, status: "AVAILABLE", unavailableUntil: null, reason: null }, null); // reset

    console.log("\n--- Audit log: a real, persisted change record ---");
    const changes = await getRecentChanges(orgA.id, 100);
    assert("publishing the lifecycle product wrote a status change to the audit log", changes.some((c) => c.entityId === newProductId && c.field === "status" && c.newValue === "PUBLISHED"));
    assert("archiving the lifecycle product wrote an active change to the audit log", changes.some((c) => c.entityId === newProductId && c.field === "active" && c.newValue === "false"));
    assert("moving the product's category wrote a category change to the audit log", changes.some((c) => c.entityId === prodA.id && c.field === "category"));

    console.log("\n--- Category publish flow ---");
    await database.update(categories).set({ status: "DRAFT" }).where(eq(categories.id, catA.id)); // force a known starting state
    await publishCategory(orgA.id, catA.id, null);
    const [catAAfterPublish] = await database.select({ status: categories.status }).from(categories).where(eq(categories.id, catA.id));
    assert("publishCategory sets status to PUBLISHED for the caller's own category", catAAfterPublish?.status === "PUBLISHED");

    const [catBBeforeForeignPublish] = await database.select({ status: categories.status }).from(categories).where(eq(categories.id, catB.id));
    await publishCategory(orgA.id, catB.id, null); // catB belongs to orgB — the orgId-scoped WHERE must match nothing
    const [catBAfterForeignPublish] = await database.select({ status: categories.status }).from(categories).where(eq(categories.id, catB.id));
    assert("publishing a category through the wrong org leaves it untouched", catBBeforeForeignPublish?.status === catBAfterForeignPublish?.status);
  } finally {
    console.log("\n--- Cleanup ---");
    await database.delete(priceHistory).where(eq(priceHistory.orgId, orgA.id));
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

}

/**
 * Channel visibility, end to end through the real `getMenu()` — which
 * always resolves the one real "frybird" org (`requireOrg()`'s hardcoded
 * `ORG_SLUG`), so this cannot run against a throwaway org the way the rest
 * of this script does. It picks a real category, temporarily hides it from
 * one channel, and confirms the actual customer/POS read path reflects
 * that — then removes the row it added, whether the checks pass or fail.
 */
async function verifyCategoryChannelVisibility() {
  const database = db();
  const [org] = await database.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, "frybird")).limit(1);
  if (!org) {
    console.log("\n--- Category channel visibility ---\nSKIPPED — no 'frybird' organization found.");
    return;
  }

  const rows = await database
    .select({ categoryId: categories.id, categorySlug: categories.slug })
    .from(categories)
    .innerJoin(products, eq(products.categoryId, categories.id))
    .where(and(eq(categories.orgId, org.id), eq(categories.status, "PUBLISHED"), eq(products.status, "PUBLISHED"), eq(products.isActive, true)))
    .limit(1);
  const target = rows[0];
  if (!target) {
    console.log("\n--- Category channel visibility ---\nSKIPPED — no published category with a published product to test against.");
    return;
  }

  console.log(`\n--- Category channel visibility (against the real menu: "${target.categorySlug}") ---`);
  try {
    const before = await getMenu("ONLINE");
    assert("the target category is visible on the website before the test", before.some((c) => c.slug === target.categorySlug));

    await setCategoryAvailabilityRule(org.id, target.categoryId, { channel: "ONLINE", status: "TEMPORARILY_UNAVAILABLE", unavailableUntil: null, reason: "audit test" }, null);

    const onlineAfterHide = await getMenu("ONLINE");
    assert("hiding a category from ONLINE removes it from the website's menu", !onlineAfterHide.some((c) => c.slug === target.categorySlug));

    const dineInAfterHide = await getMenu("DINE_IN");
    assert("the same category is still visible at the counter — the hide was channel-specific", dineInAfterHide.some((c) => c.slug === target.categorySlug));

    const [rule] = await database.select({ id: categoryAvailability.id }).from(categoryAvailability).where(and(eq(categoryAvailability.categoryId, target.categoryId), eq(categoryAvailability.channel, "ONLINE"))).limit(1);
    if (rule) await database.delete(categoryAvailability).where(eq(categoryAvailability.id, rule.id));

    const onlineAfterRestore = await getMenu("ONLINE");
    assert("removing the rule restores the category on the website", onlineAfterRestore.some((c) => c.slug === target.categorySlug));
  } finally {
    // Belt-and-braces: remove any rule this test left behind even if an assertion above threw.
    await database.delete(categoryAvailability).where(and(eq(categoryAvailability.categoryId, target.categoryId), eq(categoryAvailability.channel, "ONLINE")));
  }
}

main()
  .then(verifyCategoryChannelVisibility)
  .then(async () => {
    console.log(ok ? "\nALL PASS" : "\nSOME FAILED");
    if (!ok) process.exitCode = 1;
    await closeDb();
  })
  .catch(async (error) => {
    console.error(error);
    await closeDb();
    process.exitCode = 1;
  });
