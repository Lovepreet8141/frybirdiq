/** Categories, products, variants, modifiers, combos, tax. BUILD-PLAN.md §11, §12, §23, §58. */

import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { locations, organizations } from "./tenancy";
import { ZERO_MONEY, money, primaryId, timestamps } from "./_shared";

/**
 * Draft vs published, for the Menu Manager. §"draft/publish" in the Menu
 * Manager spec.
 *
 * Deliberately simple: a new category/product/modifier group can be
 * prepared as a draft and reviewed before it reaches `getMenu()`. Editing an
 * item that is already PUBLISHED takes effect immediately on save, the same
 * as every other admin form in this app — this is not a staging/versioning
 * system for live edits.
 */
export const menuItemStatusEnum = pgEnum("menu_item_status", ["DRAFT", "PUBLISHED"]);

/**
 * What "available" means for a product right now.
 *
 * Distinct from `isActive` (permanently on the menu or not) and from a
 * boolean "in stock" — see `productAvailability` below for why staff choose
 * one of these explicitly rather than the system inferring one. Never derive
 * SOLD_OUT_TODAY or any other value from inventory counts that do not exist
 * yet; only a person sets these.
 */
export const productAvailabilityStatusEnum = pgEnum("product_availability_status", [
  "AVAILABLE",
  "TEMPORARILY_UNAVAILABLE",
  "SOLD_OUT_TODAY",
  "SCHEDULED_UNAVAILABLE",
]);

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
    /** Existing categories default PUBLISHED so nothing already live disappears. */
    status: menuItemStatusEnum("status").notNull().default("PUBLISHED"),
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

    /** 0–5, where 0 is not spicy. Drives the heat selector and AI filtering. */
    spiceLevel: integer("spice_level").notNull().default(0),
    isVegetarian: boolean("is_vegetarian").notNull().default(false),
    /** Restaurant-managed. §33: allergen answers must be grounded in this. */
    allergens: jsonb("allergens").$type<string[]>().notNull().default([]),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    nutrition: jsonb("nutrition").$type<Record<string, number>>(),
    images: jsonb("images").$type<{ url: string; alt: string; focalPoint?: [number, number] }[]>().notNull().default([]),
    seo: jsonb("seo").$type<{ title?: string; description?: string }>(),

    /** Stock-keeping code for the counter and reporting. Optional — not every item needs one. */
    sku: text("sku"),
    /** Kitchen prep time in minutes. Feeds order ETAs and, later, the KDS. */
    prepMinutes: integer("prep_minutes"),
    /** Which kitchen station makes this — fry, grill, assembly. Read by the KDS once it exists; unused today. */
    kdsStation: text("kds_station"),

    isActive: boolean("is_active").notNull().default(true),
    position: integer("position").notNull().default(0),
    /** Existing products default PUBLISHED so nothing already live disappears. */
    status: menuItemStatusEnum("status").notNull().default("PUBLISHED"),
    ...timestamps,
  },
  (table) => [
    unique("products_org_slug_unique").on(table.orgId, table.slug),
    index("products_org_idx").on(table.orgId),
    index("products_category_idx").on(table.categoryId),
  ],
);

/**
 * Per-location, per-channel availability.
 *
 * A product can be off at one location without touching the menu everyone
 * else sees, and — separately — off on one channel without being off at the
 * counter: "sold out for delivery" is not the same fact as "sold out",
 * because the kitchen may still be happy to serve it dine-in. `locationId`
 * and `channel` are both nullable: null means "every location" / "every
 * channel", so a single wildcard row can 86 a product everywhere without one
 * row per location per channel. `channel` is loose `text`, not the closed
 * `OrderChannel` enum, matching `productChannelPrices.channel` — an
 * aggregator or a kiosk gets a channel value the day it is real, with no
 * migration needed then either.
 *
 * `status` is never inferred from stock counts — see `products.sku`'s
 * comment and BUILD-PLAN's "do not invent inventory quantities": a human
 * sets SOLD_OUT_TODAY, and it is the repository layer's job to expire it at
 * the next business-date rollover, not a number computed from real stock
 * that does not exist yet.
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
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "cascade" }),
    /** An `OrderChannel` value, or null for every channel. */
    channel: text("channel"),
    status: productAvailabilityStatusEnum("status").notNull().default("AVAILABLE"),
    /** For SCHEDULED_UNAVAILABLE — "back at 8pm". Ignored by every other status. */
    unavailableUntil: timestamp("unavailable_until", { withTimezone: true }),
    /** Shown to staff and, for SOLD_OUT_TODAY, to the customer. Never required. */
    reason: text("reason"),
    ...timestamps,
  },
  (table) => [
    unique("product_availability_unique").on(table.productId, table.locationId, table.channel),
    index("product_availability_product_idx").on(table.productId),
  ],
);

/**
 * Uploaded media — product photos, category banners.
 *
 * One row per file, one file in storage: every place that needs a photo
 * picks from this table rather than uploading its own copy, which is what
 * makes "upload once, reuse everywhere" true instead of aspirational. The
 * actual bytes live in Supabase Storage; this row is the catalogue entry.
 */
export const media = pgTable(
  "media",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    alt: text("alt").notNull().default(""),
    width: integer("width"),
    height: integer("height"),
    uploadedBy: uuid("uploaded_by"),
    ...timestamps,
  },
  (table) => [index("media_org_idx").on(table.orgId)],
);

/**
 * Price per order channel.
 *
 * Empty for now: FRYBIRD charges one price across dine-in, counter and the
 * website, so a product's `basePrice` applies everywhere. The table stays
 * because online orders may later need their own price to absorb delivery
 * packaging, and because reporting already groups by channel — but nothing
 * seeds it, and an absent row means "use the base price".
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
    /** An `OrderChannel` value. */
    channel: text("channel").notNull(),
    price: money("price").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("product_channel_prices_unique").on(table.productId, table.channel),
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
    /**
     * Stable identity, independent of the display name.
     *
     * Carts reference modifiers by slug. Deriving that slug from the name
     * means renaming "8 pc" to "8 pieces" silently invalidates every saved
     * cart — the modifier is dropped at pricing time and the customer is
     * undercharged with no error anywhere.
     */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** §12: required selection, min and max quantity. */
    minSelections: integer("min_selections").notNull().default(0),
    maxSelections: integer("max_selections"),
    position: integer("position").notNull().default(0),
    /** Existing groups default PUBLISHED. Individual modifiers inherit their group's state — no separate column. */
    status: menuItemStatusEnum("status").notNull().default("PUBLISHED"),
    ...timestamps,
  },
  (table) => [
    unique("modifier_groups_org_slug_unique").on(table.orgId, table.slug),
    index("modifier_groups_org_idx").on(table.orgId),
  ],
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
    /** Stable identity. See `modifierGroups.slug`. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** Added to the line price. Can be zero, or negative for a removal. */
    priceDelta: money("price_delta").notNull().default(ZERO_MONEY),
    isDefault: boolean("is_default").notNull().default(false),
    isAvailable: boolean("is_available").notNull().default(true),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    unique("modifiers_group_slug_unique").on(table.groupId, table.slug),
    index("modifiers_group_idx").on(table.groupId),
  ],
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
