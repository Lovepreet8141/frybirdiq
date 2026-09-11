import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

/**
 * Offers the dips, and optionally a drink, on every product that can take one.
 *
 *     pnpm addons:apply                              # report
 *     pnpm addons:apply --write                      # attach the dips
 *     pnpm addons:apply --write --drink "Coca-Cola 250ml=40,Sprite 250ml=40"
 *
 * The "Add a dip" group already existed with all seven sauces at their real
 * prices and was attached to nothing, so the dips are a linking job rather than
 * a data one.
 *
 * Drinks are not seeded and have no price anywhere in this repository, so this
 * will not invent one. Pass them as name=rupees or the drinks group is skipped
 * — a modifier that defaults to zero would let every customer add a free cola,
 * and nobody would notice until the month's margin came out wrong.
 */

import { and, asc, eq } from "drizzle-orm";

import { closeDb, db, schema } from "@/db/connection";
import { formatINR, fromRupees } from "@/lib/money";

/** Categories that should not be offered add-ons. */
const NO_ADDONS = new Set(["sauces"]);

interface Drink {
  name: string;
  rupees: string;
}

function parseDrinks(argv: string[]): Drink[] {
  const index = argv.indexOf("--drink");
  if (index === -1) return [];
  const raw = argv[index + 1];
  if (!raw) throw new Error('--drink needs a value, e.g. --drink "Coca-Cola 250ml=40"');

  return raw.split(",").map((entry) => {
    const [name, rupees] = entry.split("=").map((part) => part.trim());
    if (!name || !rupees || !/^\d+(\.\d{1,2})?$/.test(rupees)) {
      throw new Error(`Could not read "${entry}". Use the form "Coca-Cola 250ml=40".`);
    }
    return { name, rupees };
  });
}

async function main() {
  const write = process.argv.includes("--write");
  const drinks = parseDrinks(process.argv);

  const org = (await db().select().from(schema.organizations).limit(1))[0];
  if (!org) {
    console.error("No organization found.");
    process.exit(1);
  }

  const categories = await db()
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.orgId, org.id));
  const skipIds = new Set(categories.filter((c) => NO_ADDONS.has(c.slug)).map((c) => c.id));

  const products = await db()
    .select({ id: schema.products.id, slug: schema.products.slug, categoryId: schema.products.categoryId })
    .from(schema.products)
    .where(eq(schema.products.orgId, org.id))
    .orderBy(asc(schema.products.slug));

  const eligible = products.filter((p) => !p.categoryId || !skipIds.has(p.categoryId));

  // ---- dips -------------------------------------------------------------
  const dip = (
    await db()
      .select()
      .from(schema.modifierGroups)
      .where(and(eq(schema.modifierGroups.orgId, org.id), eq(schema.modifierGroups.slug, "add-a-dip")))
  )[0];

  if (!dip) {
    console.error('No "add-a-dip" modifier group. Run pnpm db:seed first.');
    process.exit(1);
  }

  const alreadyLinked = new Set(
    (
      await db()
        .select({ productId: schema.productModifierGroups.productId })
        .from(schema.productModifierGroups)
        .where(eq(schema.productModifierGroups.groupId, dip.id))
    ).map((r) => r.productId),
  );

  const toLink = eligible.filter((p) => !alreadyLinked.has(p.id));
  console.log(`\nDips: ${toLink.length} products to attach (${alreadyLinked.size} already, ${products.length - eligible.length} excluded).`);

  if (write && toLink.length > 0) {
    await db()
      .insert(schema.productModifierGroups)
      .values(toLink.map((p) => ({ orgId: org.id, productId: p.id, groupId: dip.id, position: 50 })));
    console.log(`  attached to ${toLink.length}.`);
  }

  // ---- drinks -----------------------------------------------------------
  if (drinks.length === 0) {
    console.log(
      "\nDrinks: skipped. No drink SKUs or prices exist in this repository, and a\n" +
        "  zero-priced modifier would hand out free colas. Re-run with, for example:\n" +
        '    pnpm addons:apply --write --drink "Coca-Cola 250ml=40,Sprite 250ml=40"',
    );
  } else {
    let group = (
      await db()
        .select()
        .from(schema.modifierGroups)
        .where(and(eq(schema.modifierGroups.orgId, org.id), eq(schema.modifierGroups.slug, "add-a-drink")))
    )[0];

    console.log(`\nDrinks: ${drinks.map((d) => `${d.name} ${formatINR(fromRupees(d.rupees))}`).join(", ")}`);

    if (write) {
      if (!group) {
        group = (
          await db()
            .insert(schema.modifierGroups)
            .values({
              orgId: org.id,
              slug: "add-a-drink",
              name: "Add a drink",
              minSelections: 0,
              maxSelections: null,
            })
            .returning()
        )[0]!;
      }

      // Replace the options rather than appending, so re-running with a new
      // price corrects it instead of listing the drink twice.
      await db().delete(schema.modifiers).where(eq(schema.modifiers.groupId, group.id));
      await db()
        .insert(schema.modifiers)
        .values(
          drinks.map((drink, index) => ({
            orgId: org.id,
            groupId: group!.id,
            slug: drink.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
            name: drink.name,
            priceDelta: fromRupees(drink.rupees),
            isDefault: false,
            position: index,
            isAvailable: true,
          })),
        );

      const linkedDrink = new Set(
        (
          await db()
            .select({ productId: schema.productModifierGroups.productId })
            .from(schema.productModifierGroups)
            .where(eq(schema.productModifierGroups.groupId, group.id))
        ).map((r) => r.productId),
      );
      const drinkLinks = eligible.filter((p) => !linkedDrink.has(p.id));
      if (drinkLinks.length > 0) {
        await db()
          .insert(schema.productModifierGroups)
          .values(drinkLinks.map((p) => ({ orgId: org.id, productId: p.id, groupId: group!.id, position: 60 })));
      }
      console.log(`  attached to ${drinkLinks.length} products.`);
    }
  }

  if (!write) console.log("\nNothing written. Re-run with --write to apply.\n");
  await closeDb();
}

void main();
