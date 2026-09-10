/** Ingredients, recipes, stock, waste, purchasing. BUILD-PLAN.md §24–§28. */

import { boolean, index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { products } from "./menu";
import { locations, organizations } from "./tenancy";
import { ZERO_MONEY, money, primaryId, timestamps } from "./_shared";

/** Base units. Everything converts to one of these before it is costed. */
export const unitEnum = pgEnum("unit", ["G", "KG", "ML", "L", "PIECE", "PACK"]);

export const movementTypeEnum = pgEnum("movement_type", [
  "PURCHASE",
  "SALE",
  "WASTE",
  "ADJUSTMENT",
  "TRANSFER",
  "RETURN",
]);

export const wasteReasonEnum = pgEnum("waste_reason", [
  "EXPIRED",
  "OVERPRODUCTION",
  "PREPARATION",
  "DAMAGED",
  "CUSTOMER_RETURN",
  "QUALITY",
]);

export const suppliers = pgTable(
  "suppliers",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    gstin: text("gstin"),
    address: text("address"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [index("suppliers_org_idx").on(table.orgId)],
);

export const ingredients = pgTable(
  "ingredients",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sku: text("sku"),
    /** The unit a recipe measures this in. */
    baseUnit: unitEnum("base_unit").notNull(),

    /**
     * Cost of one base unit, in paise, after yield.
     *
     * A 1 kg chicken pack at ₹280 that yields 80% after trimming costs 35 paise
     * per usable gram, not 28. Costing a recipe on the purchase price
     * understates food cost on every product that uses it.
     */
    costPerBaseUnit: money("cost_per_base_unit").notNull().default(ZERO_MONEY),
    /** Basis points. 8000 means 80% of what is bought is usable. */
    yieldBps: integer("yield_bps").notNull().default(10_000),

    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    /** True for cups, boxes and bags — costed into a product, never eaten. */
    isPackaging: boolean("is_packaging").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [unique("ingredients_org_name_unique").on(table.orgId, table.name), index("ingredients_org_idx").on(table.orgId)],
);

/**
 * Every recorded price for an ingredient.
 *
 * Appended on each purchase rather than overwriting the cost, so "why did food
 * cost increase?" (§35) can be answered with dates instead of a guess.
 */
export const ingredientPrices = pgTable(
  "ingredient_prices",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    /** As purchased: "10 kg for ₹2,800" is quantity 10, unit KG, cost 280000. */
    purchaseQuantity: integer("purchase_quantity").notNull(),
    purchaseUnit: unitEnum("purchase_unit").notNull(),
    purchaseCost: money("purchase_cost").notNull(),
    /** Derived and stored, so a report never recomputes from a moved target. */
    costPerBaseUnit: money("cost_per_base_unit").notNull(),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [index("ingredient_prices_ingredient_idx").on(table.ingredientId, table.effectiveFrom)],
);

/** Stock on hand, per ingredient per location. §42. */
export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    /** In base units. A running total of movements, never set directly. */
    quantityOnHand: integer("quantity_on_hand").notNull().default(0),
    reorderThreshold: integer("reorder_threshold"),
    ...timestamps,
  },
  (table) => [unique("inventory_items_unique").on(table.ingredientId, table.locationId)],
);

/**
 * Every change in stock.
 *
 * §24: "Never directly mutate stock without recording the movement." The
 * balance on `inventory_items` is a cache of this table; the movement is the
 * fact. Actual-versus-theoretical variance (§36) is only computable because
 * SALE movements are written from recipes alongside the counted ones.
 */
export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "restrict" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    type: movementTypeEnum("type").notNull(),
    /** Signed, in base units. Negative takes stock out. */
    quantity: integer("quantity").notNull(),
    /** Value of the movement at the cost in force when it happened. */
    costPerBaseUnit: money("cost_per_base_unit").notNull().default(ZERO_MONEY),
    totalCost: money("total_cost").notNull().default(ZERO_MONEY),
    orderId: uuid("order_id"),
    actorUserId: uuid("actor_user_id"),
    notes: text("notes"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("inventory_movements_ingredient_idx").on(table.ingredientId, table.occurredAt),
    index("inventory_movements_location_idx").on(table.locationId, table.occurredAt),
    index("inventory_movements_order_idx").on(table.orderId),
  ],
);

export const wasteEntries = pgTable(
  "waste_entries",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "restrict" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    movementId: uuid("movement_id").references(() => inventoryMovements.id, { onDelete: "set null" }),
    quantity: integer("quantity").notNull(),
    unit: unitEnum("unit").notNull(),
    reason: wasteReasonEnum("reason").notNull(),
    cost: money("cost").notNull().default(ZERO_MONEY),
    actorUserId: uuid("actor_user_id"),
    notes: text("notes"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [index("waste_entries_location_idx").on(table.locationId, table.occurredAt)],
);

/** What a product is made of. §25. */
export const recipes = pgTable(
  "recipes",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" })
      .unique(),
    /** How many portions one run of the recipe yields. */
    yieldQuantity: integer("yield_quantity").notNull().default(1),
    notes: text("notes"),
    ...timestamps,
  },
);

export const recipeItems = pgTable(
  "recipe_items",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "restrict" }),
    /** In the ingredient's base unit. 150 g of chicken is quantity 150. */
    quantity: integer("quantity").notNull(),
    ...timestamps,
  },
  (table) => [unique("recipe_items_unique").on(table.recipeId, table.ingredientId)],
);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    reference: text("reference"),
    status: text("status").notNull().default("DRAFT"),
    subtotal: money("subtotal").notNull().default(ZERO_MONEY),
    taxTotal: money("tax_total").notNull().default(ZERO_MONEY),
    total: money("total").notNull().default(ZERO_MONEY),
    expectedAt: timestamp("expected_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("purchase_orders_supplier_idx").on(table.supplierId)],
);

export const purchaseOrderItems = pgTable(
  "purchase_order_items",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    unit: unitEnum("unit").notNull(),
    unitCost: money("unit_cost").notNull(),
    lineTotal: money("line_total").notNull(),
    receivedQuantity: integer("received_quantity"),
  },
  (table) => [index("purchase_order_items_po_idx").on(table.purchaseOrderId)],
);
