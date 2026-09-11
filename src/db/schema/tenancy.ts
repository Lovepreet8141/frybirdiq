/** Organizations, locations, staff and roles. BUILD-PLAN.md §41, §42. */

import { sql } from "drizzle-orm";
import { boolean, index, integer, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { ROLES } from "@/domain/permissions";
import { ZERO_MONEY, money, primaryId, priceBasisEnum, timestamps } from "./_shared";

export const roleEnum = pgEnum("role", ROLES);

export const organizations = pgTable("organizations", {
  id: primaryId(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** 15-character GSTIN. Required on every tax invoice the business issues. */
  gstin: text("gstin"),
  /** Legal name as registered, which is often not the brand name. */
  legalName: text("legal_name"),
  currency: text("currency").notNull().default("INR"),
  /**
   * Whether the prices on the menu board already include GST.
   *
   * The single switch. Flip it here and every price, invoice line and margin
   * calculation follows, because all of them read it through
   * `src/lib/pricing` rather than deciding for themselves.
   *
   * `exclusive` means a ₹99 burger rings up at ₹103.95 and earns ₹99.
   * `inclusive` means it rings up at ₹99 and earns ₹94.29. Getting this wrong
   * misstates revenue by the tax rate on every order ever taken.
   *
   * FRYBIRD is `inclusive`, confirmed against a counter bill: the board price
   * is the final price.
   */
  priceBasis: priceBasisEnum("price_basis").notNull().default("inclusive"),

  /*
   * Loyalty. Zero earn rate means the scheme is off, which is the state a
   * shop that has not decided its economics should ship in.
   */
  /** Share of qualifying spend returned as points. 500 bps is 5%. */
  loyaltyEarnBps: integer("loyalty_earn_bps").notNull().default(0),
  /** What one point is worth when spent. 100 paise is ₹1. */
  loyaltyPointValue: money("loyalty_point_value").notNull().default(ZERO_MONEY),
  /** Points needed before any can be spent. Zero means no minimum. */
  loyaltyMinRedeemPoints: integer("loyalty_min_redeem_points").notNull().default(0),

  /*
   * FRYBIRD REWARDS — the one universal stamp card. A second, independent
   * loyalty mechanic alongside points: visit-based rather than a percentage
   * of spend, and a single card — never a separate one per category. A
   * customer earns both this and points from the same order.
   *
   * Every number here is a business decision, not a constant to bury in
   * code — the FRYBIRD IQ settings screen writes these same columns, so
   * changing the threshold or the reward cap is a settings change, not a
   * deploy.
   */
  /** Whether the stamp card is live. */
  stampRewardEnabled: boolean("stamp_reward_enabled").notNull().default(true),
  /** Stamps needed to unlock a free item. Currently 7. */
  stampsRequired: integer("stamps_required").notNull().default(7),
  /**
   * The qualifying order's spend (food + fees, less any points redeemed —
   * i.e. `grandTotal` less delivery) must exceed this, not merely reach it.
   * ₹200 is 20000 paise. A SQL literal, not `fromRupees("200")` — drizzle-kit
   * diffs defaults through JSON, and JSON.stringify cannot represent a
   * bigint (see `ZERO_MONEY` in `_shared.ts`).
   */
  stampMinOrderValue: money("stamp_min_order_value").notNull().default(sql`20000`),
  /** The most an item can list for and still be a legal free redemption. ₹250 = 25000 paise. */
  stampMaxRewardValue: money("stamp_max_reward_value").notNull().default(sql`25000`),

  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  ...timestamps,
});

export const locations = pgTable(
  "locations",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    /** Decides CGST+SGST versus IGST on every order billed here. */
    state: text("state"),
    /** GST state code, e.g. 06 for Haryana. */
    stateCode: text("state_code"),
    pincode: text("pincode"),
    phone: text("phone"),

    /**
     * Where the outlet is, in microdegrees (degrees × 1e-6).
     *
     * Integers, not floats: these are compared and stored, and an integer
     * removes the "is this the same point?" question entirely. Trigonometry
     * happens on decimal degrees inside src/lib/delivery.
     *
     * Null means the shop has not been placed on the map, and delivery cannot
     * be priced.
     */
    latMicro: integer("lat_micro"),
    lngMicro: integer("lng_micro"),

    /*
     * Delivery pricing. The bands live in `deliveryBands`; no bands means this
     * outlet does not deliver, which is the correct state for a shop that has
     * not decided what it charges and the state it ships in.
     */
    /** Order value at or above which delivery is free. Null means never. */
    deliveryFreeAbove: money("delivery_free_above"),
    /** Straight-line × this ≈ road distance. 13000 bps is 1.3×. */
    deliveryRoadFactorBps: integer("delivery_road_factor_bps").notNull().default(13_000),

    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [unique("locations_org_slug_unique").on(table.orgId, table.slug), index("locations_org_idx").on(table.orgId)],
);

/**
 * A person's membership of an organization, carrying their role.
 *
 * `userId` points at `auth.users` in Supabase, which Drizzle does not manage,
 * so it is an unconstrained uuid rather than a foreign key.
 */
export const memberships = pgTable(
  "memberships",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    role: roleEnum("role").notNull(),
    /** Null means every location in the org. */
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "cascade" }),
    displayName: text("display_name"),
    /** Numeric code for signing in at a shared POS terminal. Stored hashed. */
    posPinHash: text("pos_pin_hash"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("memberships_org_user_role_unique").on(table.orgId, table.userId, table.role),
    index("memberships_user_idx").on(table.userId),
    index("memberships_org_idx").on(table.orgId),
  ],
);

/** Feature flags. §79. */
export const featureFlags = pgTable(
  "feature_flags",
  {
    id: primaryId(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    description: text("description"),
    isEnabled: boolean("is_enabled").notNull().default(false),
    /** 0–100. Lets a flag roll out gradually rather than flipping for everyone. */
    rolloutPercent: integer("rollout_percent").notNull().default(0),
    ...timestamps,
  },
  (table) => [unique("feature_flags_org_key_unique").on(table.orgId, table.key)],
);

/**
 * Distance bands for delivery pricing.
 *
 * Real delivery pricing is banded — free nearby, a flat charge for the middle
 * ring, per-kilometre once it is genuinely far. A single base-plus-per-km
 * formula cannot express "free under 3 km, ₹30 from 3 to 5" without charging
 * per kilometre inside the flat band.
 *
 * A row per band rather than JSON on the location, so the fees stay `bigint`
 * paise columns like every other amount in the schema.
 *
 * Each band runs from the previous band's ceiling to its own. The highest
 * band's ceiling is the delivery limit.
 */
export const deliveryBands = pgTable(
  "delivery_bands",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    /** Inclusive upper bound of this band. */
    upToMetres: integer("up_to_metres").notNull(),
    /** Charged for any distance falling in this band. */
    flatFee: money("flat_fee").notNull().default(ZERO_MONEY),
    /** Added per started km beyond where this band begins. Usually zero. */
    perKmFee: money("per_km_fee").notNull().default(ZERO_MONEY),
    ...timestamps,
  },
  (table) => [
    unique("delivery_bands_location_upto_unique").on(table.locationId, table.upToMetres),
    index("delivery_bands_location_idx").on(table.locationId),
  ],
);
