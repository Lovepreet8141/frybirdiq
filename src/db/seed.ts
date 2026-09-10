/**
 * Seeds FRYBIRD's real menu.
 *
 *     pnpm db:seed          # refuses if the org already has orders
 *     pnpm db:seed --force  # re-seeds anyway
 *
 * Reads `menu-data.ts`, which is the transcription of the printed boards, and
 * writes it through `fromRupees` so no price is ever typed as a float.
 *
 * This replaces the org's menu — categories, products, modifiers, combos — and
 * leaves orders, customers and inventory untouched. It refuses to run against
 * an org that has taken orders unless forced, because re-seeding under live
 * sales would delete the products those orders point at. Order lines snapshot
 * their own name and price (§51), so history survives either way, but the
 * product rows reports join against would not.
 */

import { eq, inArray } from "drizzle-orm";
import { db } from "./index";
import {
  categories,
  comboItems,
  locations,
  modifierGroups,
  modifiers,
  orders,
  organizations,
  productModifierGroups,
  products,
  taxRates,
} from "./schema";
import { CATEGORIES, CHICKEN_CUTS, CHICKEN_HEAT, COMBOS, SAUCES, TAX_RATES } from "./menu-data";
import { fromRupees } from "@/lib/money";
import { DEFAULT_PRICE_BASIS } from "@/lib/pricing";

const ORG_SLUG = "frybird";

async function seed() {
  const force = process.argv.includes("--force");
  const database = db();

  // ---- Organization -------------------------------------------------------
  // GSTIN and legal name are left null. They are real registration details and
  // inventing a placeholder that later reaches a printed invoice is worse than
  // an empty field. §33.
  const [org] = await database
    .insert(organizations)
    .values({
      name: "FRYBIRD",
      slug: ORG_SLUG,
      currency: "INR",
      timezone: "Asia/Kolkata",
      // The single switch. Flipping this one value moves every price, invoice
      // line and margin figure, because all of them read it through
      // src/lib/pricing. See the open questions checklist in README.md.
      priceBasis: DEFAULT_PRICE_BASIS,
    })
    .onConflictDoUpdate({
      target: organizations.slug,
      // Deliberately does not overwrite priceBasis: once the owner has set it
      // from a real counter bill, a re-seed must not quietly reset it.
      set: { name: "FRYBIRD", updatedAt: new Date() },
    })
    .returning();

  if (!org) throw new Error("seed: could not create the FRYBIRD organization");

  const existingOrders = await database.select({ id: orders.id }).from(orders).where(eq(orders.orgId, org.id)).limit(1);
  if (existingOrders.length > 0 && !force) {
    throw new Error(
      "seed: this organization has already taken orders. Re-seeding would delete the products those orders report against. Pass --force if that is what you want.",
    );
  }

  // ---- Location -----------------------------------------------------------
  // Haryana is state code 06. This decides CGST+SGST versus IGST on every
  // order billed here, so it is not decoration.
  const [location] = await database
    .insert(locations)
    .values({
      orgId: org.id,
      name: "Sector 9",
      slug: "sector-9",
      addressLine1: "Sector 9",
      city: "Ambala City",
      state: "Haryana",
      stateCode: "06",
    })
    .onConflictDoUpdate({
      target: [locations.orgId, locations.slug],
      set: { name: "Sector 9", city: "Ambala City", state: "Haryana", stateCode: "06", updatedAt: new Date() },
    })
    .returning();

  if (!location) throw new Error("seed: could not create the Sector 9 location");

  // ---- Clear the existing menu -------------------------------------------
  // Products cascade to their modifier links and combo rows. Order lines hold
  // their own snapshot and are not touched.
  const previous = await database.select({ id: products.id }).from(products).where(eq(products.orgId, org.id));
  if (previous.length > 0) {
    await database.delete(products).where(inArray(products.id, previous.map((row) => row.id)));
  }
  await database.delete(modifierGroups).where(eq(modifierGroups.orgId, org.id));
  await database.delete(categories).where(eq(categories.orgId, org.id));

  // ---- Tax rates ----------------------------------------------------------
  const taxRateIds = new Map<string, string>();
  for (const rate of TAX_RATES) {
    const [row] = await database
      .insert(taxRates)
      .values({
        orgId: org.id,
        name: rate.name,
        rateBps: rate.rateBps,
        hsnCode: rate.hsnCode,
        isDefault: rate.isDefault,
      })
      .returning();
    if (row) taxRateIds.set(rate.slug, row.id);
  }
  const defaultTaxRateId = taxRateIds.get("restaurant-5");

  // ---- Categories and products -------------------------------------------
  const productIds = new Map<string, string>();
  let position = 0;

  for (const category of CATEGORIES) {
    const [categoryRow] = await database
      .insert(categories)
      .values({ orgId: org.id, name: category.name, slug: category.slug, position: position++ })
      .returning();
    if (!categoryRow) continue;

    let itemPosition = 0;
    for (const product of category.products) {
      const [row] = await database
        .insert(products)
        .values({
          orgId: org.id,
          categoryId: categoryRow.id,
          name: product.name,
          slug: product.slug,
          description: product.description,
          basePrice: fromRupees(product.price),
          taxRateId: defaultTaxRateId,
          spiceLevel: product.spice ?? 0,
          isVegetarian: product.veg === "VEG",
          position: itemPosition++,
        })
        .returning();
      if (row) productIds.set(product.slug, row.id);
    }
  }

  // ---- Chicken: three products, two modifier groups each ------------------
  const [chickenCategory] = await database
    .insert(categories)
    .values({ orgId: org.id, name: "Chicken", slug: "chicken", position: position++ })
    .returning();

  for (const cut of CHICKEN_CUTS) {
    const [product] = await database
      .insert(products)
      .values({
        orgId: org.id,
        categoryId: chickenCategory?.id,
        name: cut.name,
        slug: cut.slug,
        basePrice: fromRupees(cut.basePrice),
        taxRateId: defaultTaxRateId,
        isVegetarian: false,
        spiceLevel: 1,
      })
      .returning();
    if (!product) continue;
    productIds.set(cut.slug, product.id);

    // Size and heat are both required, exactly one each — a customer cannot
    // order "wings" without saying how many and how hot.
    const [sizeGroup] = await database
      .insert(modifierGroups)
      .values({ orgId: org.id, name: `${cut.name} size`, minSelections: 1, maxSelections: 1, position: 0 })
      .returning();

    const [heatGroup] = await database
      .insert(modifierGroups)
      .values({ orgId: org.id, name: `${cut.name} heat`, minSelections: 1, maxSelections: 1, position: 1 })
      .returning();

    if (sizeGroup) {
      await database.insert(modifiers).values(
        cut.sizes.map((size, index) => ({
          orgId: org.id,
          groupId: sizeGroup.id,
          name: size.name,
          priceDelta: fromRupees(size.delta),
          isDefault: index === 0,
          position: index,
        })),
      );
      await database.insert(productModifierGroups).values({ productId: product.id, groupId: sizeGroup.id, position: 0 });
    }

    if (heatGroup) {
      await database.insert(modifiers).values(
        CHICKEN_HEAT.map((heat, index) => ({
          orgId: org.id,
          groupId: heatGroup.id,
          name: heat.name,
          priceDelta: fromRupees(heat.delta),
          isDefault: index === 0,
          position: index,
        })),
      );
      await database.insert(productModifierGroups).values({ productId: product.id, groupId: heatGroup.id, position: 1 });
    }
  }

  // ---- Sauces: sold on their own and offered as dips ----------------------
  const [sauceCategory] = await database
    .insert(categories)
    .values({ orgId: org.id, name: "Sauces", slug: "sauces", position: position++ })
    .returning();

  const [dipGroup] = await database
    .insert(modifierGroups)
    .values({ orgId: org.id, name: "Add a dip", minSelections: 0, maxSelections: null, position: 0 })
    .returning();

  for (const [index, sauce] of SAUCES.entries()) {
    const [row] = await database
      .insert(products)
      .values({
        orgId: org.id,
        categoryId: sauceCategory?.id,
        name: sauce.name,
        slug: sauce.slug,
        basePrice: fromRupees(sauce.price),
        taxRateId: defaultTaxRateId,
        isVegetarian: true,
        position: index,
      })
      .returning();
    if (row) productIds.set(sauce.slug, row.id);

    if (dipGroup) {
      await database.insert(modifiers).values({
        orgId: org.id,
        groupId: dipGroup.id,
        name: sauce.name,
        priceDelta: fromRupees(sauce.price),
        position: index,
      });
    }
  }

  // ---- Combos and party boxes --------------------------------------------
  const [comboCategory] = await database
    .insert(categories)
    .values({ orgId: org.id, name: "Combos & Party Boxes", slug: "combos", position: position++ })
    .returning();

  for (const [index, combo] of COMBOS.entries()) {
    const [row] = await database
      .insert(products)
      .values({
        orgId: org.id,
        categoryId: comboCategory?.id,
        name: combo.name,
        slug: combo.slug,
        description: combo.description,
        basePrice: fromRupees(combo.price),
        taxRateId: defaultTaxRateId,
        isVegetarian: combo.veg === "VEG",
        position: index,
      })
      .returning();
    if (!row) continue;

    // Components are linked where the product exists. Cola and "2 drinks" have
    // no product to point at yet, so they are simply absent — the combo still
    // sells at the right price, and food cost will be short by the drink until
    // drink SKUs exist.
    const components = combo.components
      .map((slug) => productIds.get(slug))
      .filter((id): id is string => Boolean(id));

    if (components.length > 0) {
      await database.insert(comboItems).values(
        components.map((productId, componentIndex) => ({
          comboProductId: row.id,
          productId,
          quantity: 1,
          position: componentIndex,
        })),
      );
    }
  }

  // ---- Report -------------------------------------------------------------
  const seeded = await database.select({ id: products.id }).from(products).where(eq(products.orgId, org.id));
  const seededCategories = await database
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.orgId, org.id));

  console.log(`Seeded FRYBIRD · Sector 9, Ambala City`);
  console.log(`  ${seededCategories.length} categories`);
  console.log(`  ${seeded.length} products`);
  console.log(`  ${CHICKEN_CUTS.length} chicken cuts with size and heat modifiers`);
  console.log(`  ${SAUCES.length} sauces, also offered as dips`);
  console.log(`  ${COMBOS.length} combos and party boxes`);
  console.log("");
  console.log(`  Price basis: ${org.priceBasis} — the single switch, on the organization.`);
  console.log("");
  console.log("Drinks are not seeded, and several figures are still open.");
  console.log('See the "Open questions" checklist in README.md.');
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
