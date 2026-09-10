import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

/**
 * Attaches the product photographs to the menu.
 *
 *     pnpm images:import          # report what would change
 *     pnpm images:import --write  # apply
 *
 * The mapping is the one the FRYBIRD WordPress theme ships, keyed to this
 * database's slugs rather than the theme's display names — four items are
 * named differently here ("Wings" against "Chicken Wings"), and matching on a
 * display name would silently skip them.
 *
 * Two rules are enforced rather than trusted:
 *
 * A photograph of meat never goes on a product marked vegetarian. The theme
 * puts the same chicken rice bowl on all three bowls, two of which are
 * vegetarian here. In this market that is not a cosmetic error — someone
 * ordering paneer and being shown chicken has been misled about something they
 * may care about a great deal. Those two are skipped and reported.
 *
 * A photo is never invented for a product the theme has no photo for.
 */

import { asc, eq } from "drizzle-orm";

import { closeDb, db, schema } from "@/db/connection";

/** DB slug → image file (without extension), from the theme's own importer. */
const MAPPING: Readonly<Record<string, string>> = {
  "og-frybird-classic": "burger-og-classic",
  "thunder-burger": "burger-thunder",
  "nashville-bomb": "burger-nashville-bomb",
  "the-chipotle-burger": "burger-chipotle",
  "peri-inferno": "burger-peri-inferno",
  "paneer-champ": "burger-paneer-champ",
  "aloo-tikki-maharaja": "burger-aloo-tikki",
  "cheese-volcano": "burger-cheese-volcano",

  "solo-combo": "combo-solo",
  "frybird-combo": "combo-frybird",
  "boss-combo": "combo-boss",

  // The theme uses one smash photo for all four. Kept, because they are the
  // same build with a different sauce — but the Double is a single patty in
  // this shot, which is worth a real photograph eventually.
  "og-smash": "smash-hero",
  "nashville-smash": "smash-hero",
  "chipotle-smash": "smash-hero",
  "double-smash": "smash-hero",

  "popcorn-chicken": "box-popcorn",
  "chicken-wings": "box-wings",
  "chicken-tenders": "box-tenders",
  "popcorn-party-box": "box-popcorn",
  "wings-party-box": "box-wings",
  "tenders-boss-box": "box-tenders",

  "the-og-wrap": "wrap-og",
  "the-thunder-wrap": "wrap-thunder",
  "nashville-fire-wrap": "wrap-nashville-fire",
  "chipotle-crunch-wrap": "wrap-chipotle-crunch",
  "crispy-paneer-wrap": "wrap-crispy-paneer",
  "aloo-chatpata-wrap": "wrap-aloo-chatpata",

  "og-salt-fries": "fries-og-salt",
  "peri-peri-fries": "fries-peri-peri",
  "garlic-parmesan-fries": "fries-garlic-parmesan",
  "chilli-cheese-fries": "fries-chilli-cheese",
  "nachos-loaded-fries": "fries-nachos-loaded",
  "frybird-loaded-fries": "fries-frybird-loaded",

  "classic-mac-and-cheese": "mac-classic",
  "paneer-mac-and-cheese": "mac-paneer",
  "chicken-mac-and-cheese": "mac-chicken",
  "nashville-chicken-mac-and-cheese": "mac-nashville",
  "chicken-loaded-mac-and-fries": "mac-loaded-fries",
  "og-mac-smash": "mac-og-smash",

  // The theme puts this same chicken bowl on all three. The two vegetarian
  // bowls are listed here deliberately so the guard below rejects them by
  // rule and says so, rather than them quietly going missing.
  "frybird-rice-bowl": "bowl-rice",
  "classic-rice-bowl": "bowl-rice",
  "paneer-rice-bowl": "bowl-rice",

  "signature-mayo": "sauce-signature-mayo",
  "green-sauce": "sauce-green",
  "garlic-sauce": "sauce-garlic",
  "garlic-parmesan": "sauce-garlic-parmesan",
  "peri-peri-mayo": "sauce-peri-mayo",
  "chipotle-sauce": "sauce-chipotle",
  "cheese-sauce": "sauce-cheese",
};

/**
 * Photos that show meat. Checked against the vegetarian flag before writing,
 * so a future edit to the mapping cannot quietly put chicken on a paneer dish.
 */
const CONTAINS_MEAT = new Set([
  "bowl-rice",
  "box-popcorn",
  "box-tenders",
  "box-wings",
  "burger-chipotle",
  "burger-nashville-bomb",
  "burger-og-classic",
  "burger-peri-inferno",
  "burger-thunder",
  "combo-boss",
  "combo-frybird",
  "fries-frybird-loaded",
  "mac-chicken",
  "mac-loaded-fries",
  "mac-nashville",
  "mac-og-smash",
  "smash-hero",
  "wrap-chipotle-crunch",
  "wrap-nashville-fire",
  "wrap-og",
  "wrap-thunder",
]);

async function main() {
  const write = process.argv.includes("--write");

  const products = await db()
    .select({
      id: schema.products.id,
      slug: schema.products.slug,
      name: schema.products.name,
      isVegetarian: schema.products.isVegetarian,
      images: schema.products.images,
    })
    .from(schema.products)
    .orderBy(asc(schema.products.slug));

  let attached = 0;
  const skippedVeg: string[] = [];
  const noPhoto: string[] = [];

  for (const product of products) {
    const image = MAPPING[product.slug];

    if (!image) {
      noPhoto.push(product.slug);
      continue;
    }

    if (product.isVegetarian && CONTAINS_MEAT.has(image)) {
      skippedVeg.push(`${product.slug} (would have shown ${image})`);
      continue;
    }

    const value = [
      {
        url: `/products/${image}.webp`,
        // Alt describes the photograph for someone who cannot see it, which
        // means the dish — not "image of" and not the file name.
        alt: `${product.name}, photographed against a plain background`,
      },
    ];

    if (write) {
      await db()
        .update(schema.products)
        .set({ images: value, updatedAt: new Date() })
        .where(eq(schema.products.id, product.id));
    }
    attached += 1;
  }

  console.log(`\n${write ? "Attached" : "Would attach"} ${attached} photos to ${products.length} products.\n`);

  if (skippedVeg.length > 0) {
    console.log("Skipped — a meat photo on a vegetarian product:");
    for (const line of skippedVeg) console.log(`  ${line}`);
    console.log();
  }
  if (noPhoto.length > 0) {
    console.log(`No photo in the theme for ${noPhoto.length}:`);
    for (const slug of noPhoto) console.log(`  ${slug}`);
    console.log();
  }
  if (!write) console.log("Nothing written. Re-run with --write to apply.\n");

  await closeDb();
}

void main();
