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

import { and, asc, eq, inArray } from "drizzle-orm";
import { businessDate } from "@/lib/dates";
import { type RequiredGroupCheck, type ResolvedAvailability, resolveAvailability, resolveWithRequiredGroups } from "@/domain/menu-availability";
import { type Paise, fromRupees } from "@/lib/money";
import { isSupabaseConfigured } from "@/lib/env";
import { db } from "@/db";
import { requireOrg } from "./org";
import { categories, categoryAvailability, locations, modifierGroups, modifiers, productAvailability, productModifierGroups, products, taxRates } from "@/db/schema";
import {
  CATEGORIES,
  CHICKEN_CUTS,
  CHICKEN_HEAT,
  COMBOS,
  SAUCES,
  TAX_RATES,
  type VegClass,
} from "@/db/menu-data";

/** Available everywhere — what a product with no availability row at all is. */
const DEFAULT_AVAILABILITY: ResolvedAvailability = { status: "AVAILABLE", available: true, reason: null, until: null };

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
  /** Stock-keeping code, if one has been set. */
  readonly sku: string | null;
  readonly prepMinutes: number | null;
  readonly kdsStation: string | null;
  /** Free-form labels — "bestseller", "new" — from the product's tags. */
  readonly badges: readonly string[];
  /** Resolved for the channel/location `getMenu` was called with. */
  readonly availability: ResolvedAvailability;
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

export interface ResolvedLineModifiers {
  readonly modifiers: MenuModifier[];
  readonly error: string | null;
}

/**
 * Resolves the modifier slugs a line carries against the product's own
 * groups — the one place that validates a set of chosen modifiers, shared by
 * the customer cart (`src/lib/cart`) and the counter (`src/lib/pos`), so the
 * rule for what counts as a legal selection cannot drift between the two.
 */
export function resolveLineModifiers(
  product: MenuProduct,
  selected: readonly string[],
): ResolvedLineModifiers {
  const modifiers: MenuModifier[] = [];

  for (const group of product.modifierGroups) {
    const chosen = group.modifiers.filter((modifier) => selected.includes(modifier.slug));

    if (chosen.length < group.minSelections) {
      // Fall back to the group's default rather than rejecting the line, so a
      // link shared without options — or a tap-to-add with none chosen yet —
      // still resolves to something orderable.
      const fallback = group.modifiers.find((modifier) => modifier.isDefault) ?? group.modifiers[0];
      if (!fallback) return { modifiers: [], error: `${group.name} has no options` };
      modifiers.push(fallback);
      continue;
    }

    if (group.maxSelections !== null && chosen.length > group.maxSelections) {
      return { modifiers: [], error: `Too many choices for ${group.name}` };
    }

    modifiers.push(...chosen);
  }

  return { modifiers, error: null };
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

/**
 * Fields this fallback has no source for. There is no admin database to have
 * drafted or 86'd anything here, so everything is simply published and
 * available.
 */
const TRANSCRIPTION_DEFAULTS = {
  sku: null,
  prepMinutes: null,
  kdsStation: null,
  badges: [] as readonly string[],
  availability: DEFAULT_AVAILABILITY,
};

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
      ...TRANSCRIPTION_DEFAULTS,
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
      ...TRANSCRIPTION_DEFAULTS,
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
      ...TRANSCRIPTION_DEFAULTS,
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
      ...TRANSCRIPTION_DEFAULTS,
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
async function readFromDatabase(channel: string | null): Promise<MenuCategory[]> {
  const database = db();
  // Scoped explicitly. The app connects as `postgres`, which bypasses
  // row-level security, so this filter is the tenant boundary — not a
  // secondary check on top of one. See ./org.
  const org = await requireOrg();
  // Single-store today: the one location this org has, used to resolve
  // location-scoped availability rows. A second location would need this
  // to become a parameter, same as everywhere else this pattern appears.
  const [location] = await database.select({ id: locations.id }).from(locations).where(eq(locations.orgId, org.id)).limit(1);
  const locationId = location?.id ?? null;

  const rows = await database
    .select({
      productId: products.id,
      productSlug: products.slug,
      images: products.images,
      productName: products.name,
      description: products.description,
      price: products.basePrice,
      isVegetarian: products.isVegetarian,
      spiceLevel: products.spiceLevel,
      tags: products.tags,
      sku: products.sku,
      prepMinutes: products.prepMinutes,
      kdsStation: products.kdsStation,
      categoryId: categories.id,
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
    .where(
      and(
        eq(products.orgId, org.id),
        eq(products.isActive, true),
        eq(products.status, "PUBLISHED"),
        eq(categories.status, "PUBLISHED"),
      ),
    )
    .orderBy(asc(categories.position), asc(products.position));

  // Deliberately not filtered to `isAvailable = true` here — a group whose
  // every option is currently unavailable must still be visible to the
  // resolution pass below so a *required* group finding itself with zero
  // available options can mark the whole product unavailable, instead of
  // silently vanishing from the product and letting a mandatory choice go
  // unenforced at cart time. Unavailable options are filtered out only when
  // building what the customer actually sees, further down.
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
      isAvailable: modifiers.isAvailable,
      modifierPosition: modifiers.position,
    })
    .from(productModifierGroups)
    .innerJoin(products, eq(productModifierGroups.productId, products.id))
    .innerJoin(modifierGroups, eq(productModifierGroups.groupId, modifierGroups.id))
    .innerJoin(modifiers, eq(modifiers.groupId, modifierGroups.id))
    .where(and(eq(products.orgId, org.id), eq(modifierGroups.status, "PUBLISHED")))
    .orderBy(asc(productModifierGroups.position), asc(modifiers.position));

  const productIds = rows.map((row) => row.productId);
  const availabilityRows =
    productIds.length === 0
      ? []
      : await database.select().from(productAvailability).where(and(eq(productAvailability.orgId, org.id), inArray(productAvailability.productId, productIds)));

  const availabilityByProduct = new Map<string, typeof availabilityRows>();
  for (const row of availabilityRows) {
    const existing = availabilityByProduct.get(row.productId) ?? [];
    existing.push(row);
    availabilityByProduct.set(row.productId, existing);
  }

  const today = businessDate();
  function resolveForProduct(productId: string): ResolvedAvailability {
    const productRows = availabilityByProduct.get(productId);
    if (!productRows || productRows.length === 0) return DEFAULT_AVAILABILITY;

    return resolveAvailability(
      productRows.map((row) => ({
        locationId: row.locationId,
        channel: row.channel,
        status: row.status,
        unavailableUntil: row.unavailableUntil,
        reason: row.reason,
        // A row's own last-updated date is when its status was set — the
        // only thing that makes a stale SOLD_OUT_TODAY expire.
        setOnBusinessDate: businessDate(row.updatedAt),
      })),
      { locationId, channel, now: new Date(), today },
    );
  }

  // Category visibility per channel — "hide Combos from Kiosk" without
  // touching every product in it. Resolved with the same domain function as
  // product availability; a category with no rows is visible everywhere.
  const categoryIds = [...new Set(rows.map((row) => row.categoryId))];
  const categoryAvailabilityRows =
    categoryIds.length === 0
      ? []
      : await database.select().from(categoryAvailability).where(and(eq(categoryAvailability.orgId, org.id), inArray(categoryAvailability.categoryId, categoryIds)));

  const categoryAvailabilityById = new Map<string, typeof categoryAvailabilityRows>();
  for (const row of categoryAvailabilityRows) {
    const existing = categoryAvailabilityById.get(row.categoryId) ?? [];
    existing.push(row);
    categoryAvailabilityById.set(row.categoryId, existing);
  }

  const hiddenCategoryIds = new Set<string>();
  for (const categoryId of categoryIds) {
    const categoryRows = categoryAvailabilityById.get(categoryId);
    if (!categoryRows || categoryRows.length === 0) continue;
    const resolved = resolveAvailability(
      categoryRows.map((row) => ({
        locationId: null,
        channel: row.channel,
        status: row.status,
        unavailableUntil: row.unavailableUntil,
        reason: row.reason,
        setOnBusinessDate: businessDate(row.updatedAt),
      })),
      { locationId: null, channel, now: new Date(), today },
    );
    if (!resolved.available) hiddenCategoryIds.add(categoryId);
  }

  // Two views built from the same rows: `groupsByProduct` is what the
  // customer is actually offered (unavailable options dropped), while
  // `requiredChecksByProduct` counts available options per group — including
  // groups left with zero — so a required group that's been fully 86'd can
  // still be detected below even though it now contributes no options to
  // the first view.
  const groupsByProduct = new Map<string, Map<string, MenuModifierGroup>>();
  const requiredChecksByProduct = new Map<string, Map<string, RequiredGroupCheck>>();
  for (const row of groupRows) {
    const forProduct = groupsByProduct.get(row.productSlug) ?? new Map();
    const existing = forProduct.get(row.groupId);
    const modifiers = existing?.modifiers ?? [];
    if (row.isAvailable) {
      modifiers.push({ slug: row.modifierSlug, name: row.modifierName, priceDelta: row.priceDelta as Paise, isDefault: row.isDefault });
    }
    forProduct.set(row.groupId, { slug: row.groupSlug, name: row.groupName, minSelections: row.minSelections, maxSelections: row.maxSelections, modifiers });
    groupsByProduct.set(row.productSlug, forProduct);

    const checksForProduct = requiredChecksByProduct.get(row.productSlug) ?? new Map();
    const existingCheck = checksForProduct.get(row.groupId) ?? { name: row.groupName, minSelections: row.minSelections, availableCount: 0 };
    checksForProduct.set(row.groupId, { ...existingCheck, availableCount: existingCheck.availableCount + (row.isAvailable ? 1 : 0) });
    requiredChecksByProduct.set(row.productSlug, checksForProduct);
  }

  const byCategory = new Map<string, MenuCategory>();
  for (const row of rows) {
    if (hiddenCategoryIds.has(row.categoryId)) continue;

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
      sku: row.sku,
      prepMinutes: row.prepMinutes,
      kdsStation: row.kdsStation,
      badges: row.tags,
      availability: resolveWithRequiredGroups(resolveForProduct(row.productId), [...(requiredChecksByProduct.get(row.productSlug)?.values() ?? [])]),
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

/**
 * The menu, filtered to what is actually orderable on `channel`.
 *
 * `channel` should be an `OrderChannel` value ("DINE_IN", "TAKEAWAY",
 * "ONLINE") for a real ordering surface, or `null` when there is no channel
 * context (the transcription fallback, or an admin preview that wants to see
 * a product regardless of channel-specific 86ing). Availability rows scoped
 * to a *different* channel never match — see `src/domain/menu-availability`.
 */
export async function getMenu(channel: string | null = null): Promise<readonly MenuCategory[]> {
  return isSupabaseConfigured() ? readFromDatabase(channel) : buildFromTranscription();
}

export async function getProduct(slug: string, channel: string | null = null): Promise<MenuProduct | null> {
  const menu = await getMenu(channel);
  for (const category of menu) {
    const found = category.products.find((product) => product.slug === slug);
    if (found) return found;
  }
  return null;
}

/** Every product, flattened. Used by search and by the signature row. */
export async function getAllProducts(channel: string | null = null): Promise<readonly MenuProduct[]> {
  const menu = await getMenu(channel);
  return menu.flatMap((category) => category.products);
}
