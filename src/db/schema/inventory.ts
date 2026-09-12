/** Ingredients, recipes, stock, waste, purchasing. BUILD-PLAN.md §24–§28. */

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { products } from "./menu";
import { locations, organizations } from "./tenancy";
import { ZERO_MONEY, money, primaryId, timestamps } from "./_shared";

/** Base units. Everything converts to one of these before it is costed. */
export const unitEnum = pgEnum("unit", ["G", "KG", "ML", "L", "PIECE", "PACK"]);

export type Unit = (typeof unitEnum.enumValues)[number];

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
  /** Food already cooked for an order that was then cancelled or failed — consumed stock that never sold. */
  "CANCELLED_ORDER",
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

    /**
     * Basis points lost after prep, to spoilage and spillage. 300 means 3%.
     *
     * Kept separate from yield because they are different facts about the
     * ingredient and change for different reasons: yield is what the knife
     * takes off and is stable, waste is what the fridge takes and moves with
     * the season. Folding them into one number means a correction to either
     * looks like a correction to the other.
     */
    wasteBps: integer("waste_bps").notNull().default(0),

    /**
     * Usable cost of one base unit in millipaise — thousandths of a paisa.
     *
     * `costPerBaseUnit` above is the same figure rounded to paise, kept for
     * display. Bulk ingredients genuinely cost fractions of a paisa per gram
     * (a 50 kg sack of salt is half a paisa), and rounding that to a whole
     * paisa either zeroes the cost or doubles it. Recipe costing reads this
     * column; nothing but a screen reads the rounded one.
     */
    costPerBaseUnitMilli: bigint("cost_per_base_unit_milli", { mode: "bigint" })
      .notNull()
      .default(ZERO_MONEY),

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
    /** The same rate at full precision (see `ingredients.costPerBaseUnitMilli`) — what actually moved the ingredient's rate. Null on rows written before it existed. */
    costPerBaseUnitMilli: bigint("cost_per_base_unit_milli", { mode: "bigint" }),
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
    /**
     * The order line a SALE movement consumed for. Loose, not an FK — an
     * order line is immutable history (§51) and a movement must outlive any
     * later cleanup of it. Together with `ingredientId` this is what makes
     * consumption idempotent: the partial unique index below refuses a
     * second SALE row for the same line and ingredient, however many times
     * the hook runs.
     */
    orderItemId: uuid("order_item_id"),
    /** The recipe version that decided the quantity — so a later recipe change can never rewrite what this sale cost. */
    recipeVersionId: uuid("recipe_version_id").references((): AnyPgColumn => recipeVersions.id, { onDelete: "set null" }),
    /** Set on a WASTE/RETURN movement that undoes an earlier one (a cooked order cancelled). Never an edit or delete of the original. */
    reversalOfMovementId: uuid("reversal_of_movement_id").references((): AnyPgColumn => inventoryMovements.id, { onDelete: "set null" }),
    actorUserId: uuid("actor_user_id"),
    notes: text("notes"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("inventory_movements_ingredient_idx").on(table.ingredientId, table.occurredAt),
    index("inventory_movements_location_idx").on(table.locationId, table.occurredAt),
    index("inventory_movements_order_idx").on(table.orderId),
    // Consumption is idempotent at the database, not only in code.
    uniqueIndex("inventory_movements_sale_line_unique")
      .on(table.orderItemId, table.ingredientId)
      .where(sql`${table.type} = 'SALE'`),
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
    /** The order whose cancellation caused this waste, when that is the reason. Loose, not an FK. */
    orderId: uuid("order_id"),
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

/**
 * What a product is made of. §25.
 *
 * The header only. What it is made of lives on a version (`recipeVersions`
 * + `recipeVersionItems`); `currentVersionId` says which one prices and
 * consumes today. A version is never edited — a change is a new version —
 * so a SALE movement that names its version can never have its cost
 * rewritten by a later recipe change, the same rule `order_items` follows
 * for prices (§51).
 */
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
    /** Null until the first version is written — a bare header consumes nothing. */
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => recipeVersions.id, { onDelete: "set null" }),
    ...timestamps,
  },
);

/** One immutable state of a recipe. Superseded, never changed. */
export const recipeVersions = pgTable(
  "recipe_versions",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    /** 1, 2, 3… per recipe. */
    version: integer("version").notNull(),
    /** How many portions one run of this version yields — copied here so the header can change without touching history. */
    yieldQuantity: integer("yield_quantity").notNull().default(1),
    notes: text("notes"),
    /** Loose, not an FK — same reasoning as `inventoryMovements.actorUserId`: a staff record leaving must not break history. */
    createdBy: uuid("created_by"),
    /** Set the moment a newer version becomes current. Null on the current one. */
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("recipe_versions_recipe_version_unique").on(table.recipeId, table.version),
    index("recipe_versions_recipe_idx").on(table.recipeId),
  ],
);

/**
 * A version's lines. Immutable with the version.
 *
 * A separate table rather than a `version_id` on `recipeItems`: that table's
 * `(recipe_id, ingredient_id)` uniqueness would forbid two versions of the
 * same recipe both containing chicken, and dropping a constraint is not an
 * additive change. `recipeItems` is left in place, empty, for a later,
 * separately approved cleanup.
 */
export const recipeVersionItems = pgTable(
  "recipe_version_items",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => recipeVersions.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "restrict" }),
    /** In the ingredient's base unit, usable (after yield). 150 g of chicken is quantity 150. */
    quantity: integer("quantity").notNull(),
  },
  (table) => [
    unique("recipe_version_items_unique").on(table.versionId, table.ingredientId),
    index("recipe_version_items_ingredient_idx").on(table.ingredientId),
  ],
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
    /** DRAFT → ORDERED → RECEIVED | CANCELLED. Text, held honest by the check below rather than a new enum. */
    status: text("status").notNull().default("DRAFT"),
    subtotal: money("subtotal").notNull().default(ZERO_MONEY),
    taxTotal: money("tax_total").notNull().default(ZERO_MONEY),
    total: money("total").notNull().default(ZERO_MONEY),
    expectedAt: timestamp("expected_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("purchase_orders_supplier_idx").on(table.supplierId),
    check("purchase_orders_status_check", sql`${table.status} IN ('DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED')`),
  ],
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
