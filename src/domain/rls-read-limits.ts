/**
 * Who may READ each sensitive table straight from the database (p0-7, defect 2).
 *
 * The app reads through Drizzle as `postgres`, which bypasses row-level
 * security, so none of this affects a page or an action. It governs the other
 * door: a signed-in staff member holding the public anon key and calling
 * PostgREST or Realtime directly. Migration 0001 gave every table a
 * "member of the org" read policy that never looked at the role, so a CASHIER,
 * KITCHEN or RIDER login could read customers, payments, refunds and the
 * ledger. Migration 0042 adds one RESTRICTIVE select policy per table below;
 * a restrictive policy is ANDed with the existing permissive one, so nothing
 * existing changes and the undo is dropping them.
 *
 * The role lists are derived from `src/domain/permissions.ts` (a table is
 * readable by every role holding ANY of its permissions), and the migration's
 * SQL is generated from this file by `scripts/gen-rls-read-policies.ts`. A
 * test fails if the two ever disagree, so a permission change cannot leave a
 * stale policy behind.
 *
 * Deliberately NOT here: menu and configuration tables (products, categories,
 * product_availability, modifiers, tax_rates, locations, feature_flags, ...):
 * the browser's Realtime menu subscription reads products and
 * product_availability, and they carry nothing private.
 */

import { type Permission, type Role, ROLES, permissionsFor } from "./permissions";

/** Table -> the permissions that may read it (any one of them). */
export const READ_LIMITS: Readonly<Record<string, readonly Permission[]>> = {
  // The money and the books.
  accounts: ["finance.view"],
  expenses: ["finance.view"],
  expense_categories: ["finance.view"],
  recurring_expenses: ["finance.view"],
  targets: ["finance.view"],
  payments: ["finance.view"],
  refunds: ["finance.view", "orders.refund"],
  cash_sessions: ["finance.view"],
  cash_handovers: ["finance.view"],
  // Personal data about customers.
  customers: ["customers.view"],
  addresses: ["customers.view"],
  loyalty_accounts: ["customers.view"],
  loyalty_transactions: ["customers.view"],
  loyalty_stamp_events: ["customers.view"],
  // Orders: every screen that shows live orders (POS, orders board, kitchen, riders) subscribes to order_events.
  orders: ["orders.view", "orders.create", "kitchen.view", "delivery.view"],
  order_items: ["orders.view", "orders.create", "kitchen.view", "delivery.view"],
  order_item_modifiers: ["orders.view", "orders.create", "kitchen.view", "delivery.view"],
  order_events: ["orders.view", "orders.create", "kitchen.view", "delivery.view"],
  order_ratings: ["orders.view"],
  print_jobs: ["orders.view", "orders.create", "kitchen.view"],
  // The owner's analytics and assistant.
  analytics_events: ["analytics.view"],
  ai_conversations: ["analytics.view"],
  // Stock, buying and recipes (costs are business-sensitive).
  purchase_orders: ["purchasing.manage", "inventory.view"],
  purchase_order_items: ["purchasing.manage", "inventory.view"],
  ingredient_prices: ["purchasing.manage", "inventory.view"],
  inventory_items: ["inventory.view", "purchasing.manage"],
  inventory_movements: ["inventory.view", "purchasing.manage"],
  waste_entries: ["inventory.view", "inventory.waste"],
  recipes: ["recipes.view"],
  recipe_items: ["recipes.view"],
  recipe_versions: ["recipes.view"],
  recipe_version_items: ["recipes.view"],
  // Menu history (who changed a price, when).
  menu_audit_log: ["menu.view"],
  price_history: ["menu.view"],
  // Wiring and devices.
  integrations: ["integrations.manage"],
  pos_devices: ["integrations.manage", "settings.manage"],
  printers: ["integrations.manage", "settings.manage"],
};

/** Child tables with no org_id of their own: they reach the org through a parent row (same rule as their existing policy). */
export const CHILD_READ_LIMITS: Readonly<Record<string, { readonly parent: string; readonly fk: string; readonly permissions: readonly Permission[] }>> = {
  ai_messages: { parent: "ai_conversations", fk: "conversation_id", permissions: ["analytics.view"] },
  ai_tool_calls: { parent: "ai_conversations", fk: "conversation_id", permissions: ["analytics.view"] },
};

/**
 * Every memberships column a login may read through the database. `pos_pin_hash`
 * is deliberately absent: the app never reads it through PostgREST, and a short
 * PIN hash read there could be brute-forced offline (p0-7 review, both reviewers).
 * A new column is unreadable until it is added here, and a test forces the choice.
 */
export const MEMBERSHIPS_READABLE_COLUMNS: readonly string[] = ["id", "org_id", "user_id", "role", "location_id", "display_name", "is_active", "created_at", "updated_at"];

/**
 * `orders` columns a signed-in login may read through PostgREST (0055, orders-column-limits). Customer contact fields are
 * deliberately absent: a row policy cannot limit columns, and no client path reads `orders` (the app uses Drizzle, which
 * bypasses grants; Realtime subscribes to order_events). A new column is unreadable until added here; a test forces the choice.
 */
export const ORDERS_READABLE_COLUMNS: readonly string[] = "id, org_id, location_id, order_number, status, channel, fulfilment, customer_id, table_label, subtotal, discount_total, taxable_total, cgst_total, sgst_total, igst_total, tax_total, delivery_fee, packaging_fee, tip_amount, grand_total, promotion_code, placed_at, accepted_at, ready_at, completed_at, scheduled_for, created_at, updated_at, delivery_distance_metres, points_redeemed, points_earned, invoice_number, invoiced_at, cancellation_reason, estimated_ready_at, business_date, stamp_reward_discount, stamp_reward_id, stamp_reward_product_slug, table_id, rider_id, rider_assigned_at".split(", ");

/** The `orders` columns that hold customer contact details and stay closed to every client login. */
export const ORDERS_CONTACT_COLUMNS: readonly string[] = ["customer_name", "customer_phone", "delivery_address", "delivery_lat_micro", "delivery_lng_micro", "notes"];

/** Memberships hold every login's role and a PIN hash: staff managers read them all, everyone else reads only their own row. */
export const MEMBERSHIPS_READ: readonly Permission[] = ["staff.manage"];

/** The roles that hold any of the permissions, in the order of `ROLES`. */
export function rolesHoldingAny(permissions: readonly Permission[]): readonly Role[] {
  return ROLES.filter((role) => permissions.some((permission) => permissionsFor(role).includes(permission)));
}

const array = (roles: readonly Role[]) => `ARRAY[${roles.map((role) => `'${role}'`).join(", ")}]`;
const policyName = (table: string) => `${table}_role_read`;

/** The whole of migration 0042's policy section, generated so it cannot drift from the permissions table. */
export function generateReadLimitStatements(): readonly string[] {
  const statements = Object.entries(READ_LIMITS).map(
    ([table, permissions]) =>
      `CREATE POLICY ${policyName(table)} ON ${table}\n  AS RESTRICTIVE FOR SELECT TO authenticated\n  USING (auth_has_role(org_id, ${array(rolesHoldingAny(permissions))}));`,
  );
  for (const [table, child] of Object.entries(CHILD_READ_LIMITS)) {
    statements.push(
      `CREATE POLICY ${policyName(table)} ON ${table}\n  AS RESTRICTIVE FOR SELECT TO authenticated\n  USING (EXISTS (SELECT 1 FROM ${child.parent} p WHERE p.id = ${table}.${child.fk} AND auth_has_role(p.org_id, ${array(rolesHoldingAny(child.permissions))})));`,
    );
  }
  statements.push(
    `CREATE POLICY memberships_role_read ON memberships\n  AS RESTRICTIVE FOR SELECT TO authenticated\n  USING (user_id = auth.uid() OR auth_has_role(org_id, ${array(rolesHoldingAny(MEMBERSHIPS_READ))}));`,
  );
  // Column-level: the table-level SELECT is replaced by a grant of every column except pos_pin_hash.
  statements.push("REVOKE SELECT ON memberships FROM authenticated;");
  statements.push(`GRANT SELECT (${MEMBERSHIPS_READABLE_COLUMNS.join(", ")}) ON memberships TO authenticated;`);
  return statements;
}

/** The undo of the column grant: put the table-level SELECT back. */
export const RESTORE_MEMBERSHIPS_GRANT = ["REVOKE SELECT (" + MEMBERSHIPS_READABLE_COLUMNS.join(", ") + ") ON memberships FROM authenticated;", "GRANT SELECT ON memberships TO authenticated;"] as const;

/** Every policy the migration creates, for the undo script and the tests. */
export function readLimitPolicies(): readonly { readonly table: string; readonly policy: string }[] {
  return [...Object.keys(READ_LIMITS), ...Object.keys(CHILD_READ_LIMITS), "memberships"].map((table) => ({ table, policy: policyName(table) }));
}

/** Tables whose read policy already names roles (earlier migrations); not restated here. */
export const ALREADY_ROLE_AWARE: readonly string[] = [
  "audit_logs",
  "suppliers",
  "ingredients",
  "iq_actions",
  "iq_daily_facts",
  "iq_daily_trust",
  "iq_insights",
  "iq_intraday_facts",
  "iq_recommendations",
];

/**
 * Tables every active member may read, on purpose. Anything not restricted,
 * not already role-aware and not listed here fails the schema test, so a new
 * table has to be decided about rather than shipping open by default.
 */
export const OPEN_TO_MEMBERS_ON_PURPOSE: Readonly<Record<string, string>> = {
  categories: "menu: the customer site shows it; nothing private",
  category_availability: "menu availability",
  combo_items: "menu",
  delivery_bands: "public delivery pricing",
  feature_flags: "which features are on; read by the app shell",
  locations: "the shop's own address and hours, public on the site",
  loyalty_rewards: "the public rewards menu",
  media: "menu images, public",
  modifier_groups: "menu",
  modifiers: "menu",
  organizations: "the business's own profile; GSTIN is printed on every bill",
  product_availability: "menu; Realtime menu changes read it",
  product_modifier_groups: "menu",
  products: "menu; Realtime menu changes read it",
  promotions: "discount rules shown at the counter",
  receipt_designs: "how the bill looks",
  tables: "the dining floor",
  tax_rates: "public GST rates",
  closed_dates: "planned closures, shown on the site",
};

/**
 * Tables added after 0042, restricted in migration 0051 the same way (each new
 * table had to be decided about: the schema test fails otherwise).
 */
export const READ_LIMITS_0047: Readonly<Record<string, readonly Permission[]>> = {
  // Holds customers' phone numbers and message text: only the roles that may see customers.
  notification_outbox: ["customers.view"],
  // Which kitchen lines are done: the screens that show live orders.
  kitchen_line_status: ["orders.view", "orders.create", "kitchen.view", "delivery.view"],
  kitchen_order_pack: ["orders.view", "orders.create", "kitchen.view", "delivery.view"],
};

/**
 * Tables whose rows a login may read when they are its OWN, or when it holds the permission: the roster of hours.
 * (A rider, kitchen or analyst login reading through the database sees its own shifts and breaks; only `staff.manage`
 * roles see everyone's clock times, break times and correction reasons. The app already gates hours the same way.)
 */
export const OWN_ROW_LIMITS_0047: Readonly<Record<string, { readonly own: string; readonly permissions: readonly Permission[] }>> = {
  shifts: { own: "user_id = auth.uid()", permissions: ["staff.manage"] },
  shift_breaks: { own: "EXISTS (SELECT 1 FROM shifts s WHERE s.id = shift_breaks.shift_id AND s.user_id = auth.uid())", permissions: ["staff.manage"] },
};

/** Every table of migration 0051 with the permissions that read all of its rows. */
export const permissionsReadingAll0047 = (table: string): readonly Permission[] => READ_LIMITS_0047[table] ?? OWN_ROW_LIMITS_0047[table]?.permissions ?? [];

/** Statements of migration 0051, generated from `READ_LIMITS_0047`, `OWN_ROW_LIMITS_0047` and the permissions table. */
export function generateReadLimitStatements0047(): readonly string[] {
  return [
    ...Object.entries(READ_LIMITS_0047).map(
      ([table, permissions]) =>
        `CREATE POLICY ${policyName(table)} ON ${table}\n  AS RESTRICTIVE FOR SELECT TO authenticated\n  USING (auth_has_role(org_id, ${array(rolesHoldingAny(permissions))}));`,
    ),
    ...Object.entries(OWN_ROW_LIMITS_0047).map(
      ([table, limit]) =>
        `CREATE POLICY ${policyName(table)} ON ${table}\n  AS RESTRICTIVE FOR SELECT TO authenticated\n  USING (auth_has_role(org_id, ${array(rolesHoldingAny(limit.permissions))}) OR ${limit.own});`,
    ),
  ];
}

export const policies0047 = (): readonly { readonly table: string; readonly policy: string }[] => [...Object.keys(READ_LIMITS_0047), ...Object.keys(OWN_ROW_LIMITS_0047)].map((table) => ({ table, policy: policyName(table) }));


/**
 * rider-rls-scope (migration 0052): a rider-only login reads only the deliveries assigned to it, at the database
 * level. "Rider-only" = holds RIDER and no role that reads orders for its work (any of these permissions), so
 * a person who is a rider AND works the counter or the kitchen is not narrowed. Generated from the permissions
 * table, like 0042, so a permission change cannot leave a stale role list.
 */
export const ORDER_READER_PERMISSIONS: readonly Permission[] = ["orders.view", "orders.create", "kitchen.view"];

/** Tables that hold an order_id and are scoped through it (order_item_modifiers goes through order_items). */
export const RIDER_SCOPED_BY_ORDER = ["order_items", "order_events", "kitchen_line_status", "kitchen_order_pack"] as const;

export function generateRiderScopeStatements(): readonly string[] {
  const readers = array(rolesHoldingAny(ORDER_READER_PERMISSIONS));
  const own = (orderIdExpr: string) => `EXISTS (SELECT 1 FROM orders o WHERE o.id = ${orderIdExpr} AND o.rider_id = auth.uid())`;
  const policy = (table: string, using: string) => `CREATE POLICY ${table}_rider_scope ON ${table}\n  AS RESTRICTIVE FOR SELECT TO authenticated\n  USING (NOT auth_is_rider_scoped(org_id) OR ${using});`;
  return [
    `CREATE OR REPLACE FUNCTION auth_is_rider_scoped(target_org uuid)\nRETURNS boolean\nLANGUAGE sql\nSTABLE\nSECURITY DEFINER\nSET search_path = public\nAS $$\n  SELECT EXISTS (\n    SELECT 1 FROM memberships\n    WHERE user_id = auth.uid() AND org_id = target_org AND is_active AND role = 'RIDER'\n  )\n  AND NOT auth_has_role(target_org, ${readers})\n$$;`,
    policy("orders", "rider_id = auth.uid()"),
    ...RIDER_SCOPED_BY_ORDER.map((table) => policy(table, own(`${table}.order_id`))),
    policy("order_item_modifiers", `EXISTS (SELECT 1 FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.id = order_item_modifiers.order_item_id AND o.rider_id = auth.uid())`),
  ];
}

export const riderScopePolicies = (): readonly { readonly table: string; readonly policy: string }[] =>
  ["orders", ...RIDER_SCOPED_BY_ORDER, "order_item_modifiers"].map((table) => ({ table, policy: `${table}_rider_scope` }));
