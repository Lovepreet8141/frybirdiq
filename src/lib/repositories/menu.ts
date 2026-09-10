import "server-only";

/**
 * The menu, as the customer site sees it.
 *
 * BUILD-PLAN.md §3: "Do not let UI components directly query arbitrary
 * database tables." Pages call this; this calls the database.
 *
 * ## Two sources, one truth
 *
 * When Supabase is configured, the menu comes from the database. When it is
 * not, it comes from `src/db/menu-data.ts` — the same transcription of the
 * printed boards that `seed.ts` writes to the database. The two cannot drift,
 * because there is only one transcription.
 *
 * This is **not mock data**. §70 rule 20 forbids mock data in a production
 * path unless explicitly marked, so: the fallback is explicitly marked, it is
 * the real menu, and `menuSource()` reports which path served the request so
 * the UI can say so out loud rather than pretending to be connected.
 *
 * The fallback exists because the alternative is a site that cannot be built
 * or looked at until a Supabase project exists. It goes away the moment one
 * does.
 */

import { and, asc, eq } from "drizzle-orm";
import { type Paise, fromRupees } from "@/lib/money";
import { isSupabaseConfigured } from "@/lib/env";
import { db } from "@/db";
import { requireOrg } from "./org";
import { categories, modifierGroups, modifiers, productModifierGroups, products, taxRates } from "@/db/schema";
import {
  CATEGORIES,
  CHICKEN_CUTS,
  CHICKEN_HEAT,
  COMBOS,
  SAUCES,
  TAX_RATES,
  type VegClass,
} from "@/db/menu-data";

export interface MenuModifier {
  readonly slug: string;
  readonly name: string;
  readonly priceDelta: Paise;
  readonly isDefault: boolean;
}

export interface MenuModifierGroup {
  readonly slug: string;
  readonly name: string;
  /** 1 means the customer must choose. */
  readonly minSelections: number;
  /** null means unlimited. */
  readonly maxSelections: number | null;
  readonly modifiers: readonly MenuModifier[];
}

export interface MenuProduct {
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  /** The listed price. GST is inside it — see src/lib/pricing. */
  readonly price: Paise;
  readonly veg: VegClass;
  /** 0–5. Drives the heat marks and filtering. */
  readonly spice: number;
  readonly categorySlug: string;
  readonly categoryName: string;
  readonly taxRateBps: number;
  readonly hsnCode: string | null;
  /** The first photograph, or null. Products without one render typographically. */
  readonly image: { readonly url: string; readonly alt: string } | null;
  readonly modifierGroups: readonly MenuModifierGroup[];
}

export interface MenuCategory {
  readonly slug: string;
  readonly name: string;
  readonly products: readonly MenuProduct[];
}

export type MenuSource = "database" | "menu-data";

/** Which path served the menu. The UI says this out loud when it is not the database. */
export function menuSource(): MenuSource {
  return isSupabaseConfigured() ? "database" : "menu-data";
}

const RESTAURANT_RATE = TAX_RATES.find((rate) => rate.isDefault);
const DEFAULT_RATE_BPS = RESTAURANT_RATE?.rateBps ?? 500;
const DEFAULT_HSN = RESTAURANT_RATE?.hsnCode ?? null;

/* ------------------------------------------------------------------ */
/* Built from the transcription                                        */
/* ------------------------------------------------------------------ */

function chickenGroups(cut: (typeof CHICKEN_CUTS)[number]): MenuModifierGroup[] {
  return [
    {
      slug: `${cut.slug}-size`,
      name: "Size",
      minSelections: 1,
      maxSelections: 1,
      modifiers: cut.sizes.map((size, index) => ({
        slug: size.slug,
        name: size.name,
        priceDelta: fromRupees(size.delta),
        isDefault: index === 0,
      })),
    },
    {
      slug: `${cut.slug}-heat`,
      name: "Heat",
      minSelections: 1,
      maxSelections: 1,
      modifiers: CHICKEN_HEAT.map((heat, index) => ({
        slug: heat.slug,
        name: heat.name,
        priceDelta: fromRupees(heat.delta),
        isDefault: index === 0,
      })),
    },
  ];
}

function buildFromTranscription(): MenuCategory[] {
  const plain: MenuCategory[] = CATEGORIES.map((category) => ({
    slug: category.slug,
    name: category.name,
    products: category.products.map((product) => ({
      slug: product.slug,
      name: product.name,
      description: product.description ?? null,
      price: fromRupees(product.price),
      veg: product.veg,
      spice: product.spice ?? 0,
      categorySlug: category.slug,
      categoryName: category.name,
      taxRateBps: DEFAULT_RATE_BPS,
      hsnCode: DEFAULT_HSN,
      // This branch runs only when the database is unreachable. Photos live in
      // the database, so there are none here — the card is built to look
      // finished without one, which is exactly what this fallback needs.
      image: null,
      modifierGroups: [],
    })),
  }));

  const chicken: MenuCategory = {
    slug: "chicken",
    name: "Chicken",
    products: CHICKEN_CUTS.map((cut) => ({
      slug: cut.slug,
      name: cut.name,
      description: null,
      price: fromRupees(cut.basePrice),
      veg: "NON_VEG" as const,
      spice: 1,
      categorySlug: "chicken",
      categoryName: "Chicken",
      taxRateBps: DEFAULT_RATE_BPS,
      hsnCode: DEFAULT_HSN,
      image: null,
      modifierGroups: chickenGroups(cut),
    })),
  };

  const combos: MenuCategory = {
    slug: "combos",
    name: "Combos & Party Boxes",
    products: COMBOS.map((combo) => ({
      slug: combo.slug,
      name: combo.name,
      description: combo.description ?? null,
      price: fromRupees(combo.price),
      veg: combo.veg,
      spice: 0,
      categorySlug: "combos",
      categoryName: "Combos & Party Boxes",
      taxRateBps: DEFAULT_RATE_BPS,
      hsnCode: DEFAULT_HSN,
      image: null,
      modifierGroups: [],
    })),
  };

  const sauces: MenuCategory = {
    slug: "sauces",
    name: "Sauces",
    products: SAUCES.map((sauce) => ({
      slug: sauce.slug,
      name: sauce.name,
      description: null,
      price: fromRupees(sauce.price),
      veg: sauce.veg,
      spice: 0,
      categorySlug: "sauces",
      categoryName: "Sauces",
      taxRateBps: DEFAULT_RATE_BPS,
      hsnCode: DEFAULT_HSN,
      image: null,
      modifierGroups: [],
    })),
  };

  // Chicken sits after the burgers and before the sides, which is roughly how
  // the printed boards read.
  return [...plain.slice(0, 3), chicken, ...plain.slice(3), combos, sauces];
}

/* ------------------------------------------------------------------ */
/* Read from the database                                              */
/* ------------------------------------------------------------------ */

/**
 * UNTESTED AGAINST A LIVE DATABASE.
 *
 * There is no Supabase project yet, so this path has never executed. It is
 * written to match the schema and the seed, and it is the first thing to
 * verify once keys exist.
 */
async function readFromDatabase(): Promise<MenuCategory[]> {
  const database = db();
  // Scoped explicitly. The app connects as `postgres`, which bypasses
  // row-level security, so this filter is the tenant boundary — not a
  // secondary check on top of one. See ./org.
  const org = await requireOrg();

  const rows = await database
    .select({
      productSlug: products.slug,
      images: products.images,
      productName: products.name,
      description: products.description,
      price: products.basePrice,
      isVegetarian: products.isVegetarian,
      spiceLevel: products.spiceLevel,
      categorySlug: categories.slug,
      categoryName: categories.name,
      categoryPosition: categories.position,
      productPosition: products.position,
      taxRateId: products.taxRateId,
      rateBps: taxRates.rateBps,
      hsnCode: taxRates.hsnCode,
    })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .leftJoin(taxRates, eq(products.taxRateId, taxRates.id))
    .where(and(eq(products.orgId, org.id), eq(products.isActive, true)))
    .orderBy(asc(categories.position), asc(products.position));

  const groupRows = await database
    .select({
      productSlug: products.slug,
      groupId: modifierGroups.id,
      groupSlug: modifierGroups.slug,
      groupName: modifierGroups.name,
      minSelections: modifierGroups.minSelections,
      maxSelections: modifierGroups.maxSelections,
      groupPosition: productModifierGroups.position,
      modifierId: modifiers.id,
      modifierSlug: modifiers.slug,
      modifierName: modifiers.name,
      priceDelta: modifiers.priceDelta,
      isDefault: modifiers.isDefault,
      modifierPosition: modifiers.position,
    })
    .from(productModifierGroups)
    .innerJoin(products, eq(productModifierGroups.productId, products.id))
    .innerJoin(modifierGroups, eq(productModifierGroups.groupId, modifierGroups.id))
    .innerJoin(modifiers, eq(modifiers.groupId, modifierGroups.id))
    .where(and(eq(products.orgId, org.id), eq(modifiers.isAvailable, true)))
    .orderBy(asc(productModifierGroups.position), asc(modifiers.position));

  const groupsByProduct = new Map<string, Map<string, MenuModifierGroup>>();
  for (const row of groupRows) {
    const forProduct = groupsByProduct.get(row.productSlug) ?? new Map();
    const existing = forProduct.get(row.groupId);
    const modifier: MenuModifier = {
      slug: row.modifierSlug,
      name: row.modifierName,
      priceDelta: row.priceDelta as Paise,
      isDefault: row.isDefault,
    };
    forProduct.set(row.groupId, {
      slug: row.groupSlug,
      name: row.groupName,
      minSelections: row.minSelections,
      maxSelections: row.maxSelections,
      modifiers: [...(existing?.modifiers ?? []), modifier],
    });
    groupsByProduct.set(row.productSlug, forProduct);
  }

  const byCategory = new Map<string, MenuCategory>();
  for (const row of rows) {
    const product: MenuProduct = {
      slug: row.productSlug,
      name: row.productName,
      description: row.description,
      price: row.price as Paise,
      veg: row.isVegetarian ? "VEG" : "NON_VEG",
      spice: row.spiceLevel,
      categorySlug: row.categorySlug,
      categoryName: row.categoryName,
      taxRateBps: row.rateBps ?? DEFAULT_RATE_BPS,
      /*
       * Only fall back when the product has no tax rate at all. A rate that
       * exists and carries no HSN is a deliberate state — a zero-rated line
       * has nothing to classify — and substituting the seeded default there
       * stamps a classification code onto a line that was never taxed.
       */
      hsnCode: row.taxRateId === null ? DEFAULT_HSN : row.hsnCode,
      // Only the first. A card shows one photo, and carrying the rest into
      // every menu render is bytes nothing on screen will use.
      image: row.images?.[0] ? { url: row.images[0].url, alt: row.images[0].alt } : null,
      modifierGroups: [...(groupsByProduct.get(row.productSlug)?.values() ?? [])],
    };

    const category = byCategory.get(row.categorySlug);
    byCategory.set(row.categorySlug, {
      slug: row.categorySlug,
      name: row.categoryName,
      products: [...(category?.products ?? []), product],
    });
  }

  return [...byCategory.values()];
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function getMenu(): Promise<readonly MenuCategory[]> {
  return isSupabaseConfigured() ? readFromDatabase() : buildFromTranscription();
}

export async function getProduct(slug: string): Promise<MenuProduct | null> {
  const menu = await getMenu();
  for (const category of menu) {
    const found = category.products.find((product) => product.slug === slug);
    if (found) return found;
  }
  return null;
}

/** Every product, flattened. Used by search and by the signature row. */
export async function getAllProducts(): Promise<readonly MenuProduct[]> {
  const menu = await getMenu();
  return menu.flatMap((category) => category.products);
}
