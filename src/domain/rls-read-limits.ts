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
