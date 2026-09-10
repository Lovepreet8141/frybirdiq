/** Categories, products, variants, modifiers, combos, tax. BUILD-PLAN.md §11, §12, §23, §58. */

import { boolean, index, integer, jsonb, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { locations, organizations } from "./tenancy";
import { ZERO_MONEY, money, primaryId, timestamps } from "./_shared";

/** How a listed price relates to tax. See `lib/tax/gst`. */
export const priceBasisEnum = pgEnum("price_basis", ["exclusive", "inclusive"]);

/**
 * A GST rate with its HSN/SAC code.
 *
 * Rates live on their own rows rather than as a number on the product so that
 * a rate change is one edit, and so a receipt can name the code it charged
 * under. Restaurant service and a bottled soft drink are taxed differently;
 * the menu is the only thing that knows which a product is.
 */
export const taxRates = pgTable(
  "tax_rates",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Basis points. 5% is 500. */
    rateBps: integer("rate_bps").notNull(),
    /** HSN for goods, SAC for services. Printed on the invoice line. */
    hsnCode: text("hsn_code"),
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps,
  },
  (table) => [index("tax_rates_org_idx").on(table.orgId)],
);

export const categories = pgTable(
  "categories",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    position: integer("position").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [unique("categories_org_slug_unique").on(table.orgId, table.slug), index("categories_org_idx").on(table.orgId)],
);

export const products = pgTable(
  "products",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    shortDescription: text("short_description"),
    /** Menu descriptors in Devanagari. Never used in headlines. */
    nameHi: text("name_hi"),

    /** The default listed price in paise. Channel prices override it. */
    basePrice: money("base_price").notNull(),
    taxRateId: uuid("tax_rate_id").references(() => taxRates.id, { onDelete: "set null" }),
    priceBasis: priceBasisEnum("price_basis").notNull().default("exclusive"),

    /** 0–5, where 0 is not spicy. Drives the heat selector and AI filtering. */
    spiceLevel: integer("spice_level").notNull().default(0),
    isVegetarian: boolean("is_vegetarian").notNull().default(false),
    /** Restaurant-managed. §33: allergen answers must be grounded in this. */
    allergens: jsonb("allergens").$type<string[]>().notNull().default([]),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    nutrition: jsonb("nutrition").$type<Record<string, number>>(),
    images: jsonb("images").$type<{ url: string; alt: string; focalPoint?: [number, number] }[]>().notNull().default([]),
    seo: jsonb("seo").$type<{ title?: string; description?: string }>(),

    isActive: boolean("is_active").notNull().default(true),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    unique("products_org_slug_unique").on(table.orgId, table.slug),
    index("products_org_idx").on(table.orgId),
    index("products_category_idx").on(table.categoryId),
  ],
);

/**
 * Per-location availability and price.
 *
 * Separate from the product so a location can 86 an item at 9pm without
 * touching the menu everyone else sees, and so a second outlet can price
 * differently later without a schema change.
 */
export const productAvailability = pgTable(
  "product_availability",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    isAvailable: boolean("is_available").notNull().default(true),
    priceOverride: money("price_override"),
    ...timestamps,
  },
  (table) => [unique("product_availability_unique").on(table.productId, table.locationId)],
);

/**
 * Price per order source.
 *
 * An aggregator listing is marked up to absorb commission, so the same burger
 * genuinely has a different price on Zomato than at the counter. Without this
 * table, per-channel margin is unanswerable.
 */
export const productChannelPrices = pgTable(
  "product_channel_prices",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** An `OrderSource` value. */
    source: text("source").notNull(),
    price: money("price").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("product_channel_prices_unique").on(table.productId, table.source),
    index("product_channel_prices_product_idx").on(table.productId),
  ],
);

export const modifierGroups = pgTable(
  "modifier_groups",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    /** §12: required selection, min and max quantity. */
    minSelections: integer("min_selections").notNull().default(0),
    maxSelections: integer("max_selections"),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (table) => [index("modifier_groups_org_idx").on(table.orgId)],
);

export const modifiers = pgTable(
  "modifiers",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => modifierGroups.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Added to the line price. Can be zero, or negative for a removal. */
    priceDelta: money("price_delta").notNull().default(ZERO_MONEY),
    isDefault: boolean("is_default").notNull().default(false),
    isAvailable: boolean("is_available").notNull().default(true),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (table) => [index("modifiers_group_idx").on(table.groupId)],
);

/** Which modifier groups a product offers, and in what order. */
export const productModifierGroups = pgTable(
  "product_modifier_groups",
  {
    id: primaryId(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => modifierGroups.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (table) => [unique("product_modifier_groups_unique").on(table.productId, table.groupId)],
);

/** A product that bundles other products at a set price. §12. */
export const comboItems = pgTable(
  "combo_items",
  {
    id: primaryId(),
    comboProductId: uuid("combo_product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(1),
    position: integer("position").notNull().default(0),
  },
  (table) => [index("combo_items_combo_idx").on(table.comboProductId)],
);
