/** Organizations, locations, staff and roles. BUILD-PLAN.md §41, §42. */

import { boolean, index, integer, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { ROLES } from "@/domain/permissions";
import { primaryId, priceBasisEnum, timestamps } from "./_shared";

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
