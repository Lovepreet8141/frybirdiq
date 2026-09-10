/**
 * Roles and permissions. BUILD-PLAN.md §41.
 *
 * "Never rely only on hiding UI buttons. Authorization must happen
 * server-side." This module is the vocabulary; enforcement lives in the
 * service layer and in Postgres row-level security. Hiding a button uses the
 * same function the server uses, so the two can never drift.
 */

export const ROLES = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "CASHIER",
  "KITCHEN",
  "INVENTORY",
  "ANALYST",
] as const;

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "orders.view",
  "orders.create",
  "orders.update",
  "orders.cancel",
  "orders.refund",
  "orders.discount",
  "kitchen.view",
  "kitchen.update",
  "menu.view",
  "menu.edit",
  "menu.price",
  "inventory.view",
  "inventory.adjust",
  "inventory.waste",
  "purchasing.manage",
  "recipes.view",
  "recipes.edit",
  "customers.view",
  "customers.edit",
  "analytics.view",
  "reports.export",
  "staff.manage",
  "settings.manage",
  "integrations.manage",
  "audit.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * What each role may do.
 *
 * Two deliberate choices worth stating, because both look like omissions:
 *
 * A CASHIER can discount but cannot refund. Refunds move money back out of the
 * business after the sale is closed and are the obvious lever for till fraud,
 * so they need a MANAGER. Discounts happen in front of the customer and
 * blocking them would stall the queue.
 *
 * A MANAGER can edit the menu but not change prices. Marking an item
 * unavailable at 9pm because the chicken ran out is daily business; repricing
 * changes the margin on every future order and belongs to the owner.
 */
const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  OWNER: PERMISSIONS,

  ADMIN: PERMISSIONS.filter((permission) => permission !== "settings.manage"),

  MANAGER: [
    "orders.view",
    "orders.create",
    "orders.update",
    "orders.cancel",
    "orders.refund",
    "orders.discount",
    "kitchen.view",
    "kitchen.update",
    "menu.view",
    "menu.edit",
    "inventory.view",
    "inventory.adjust",
    "inventory.waste",
    "purchasing.manage",
    "recipes.view",
    "customers.view",
    "customers.edit",
    "analytics.view",
    "reports.export",
  ],

  CASHIER: [
    "orders.view",
    "orders.create",
    "orders.update",
    "orders.discount",
    "kitchen.view",
    "menu.view",
    "customers.view",
    "customers.edit",
  ],

  KITCHEN: ["orders.view", "kitchen.view", "kitchen.update", "menu.view", "recipes.view", "inventory.waste"],

  INVENTORY: [
    "inventory.view",
    "inventory.adjust",
    "inventory.waste",
    "purchasing.manage",
    "recipes.view",
    "recipes.edit",
    "menu.view",
  ],

  ANALYST: ["orders.view", "menu.view", "inventory.view", "recipes.view", "analytics.view", "reports.export"],
};

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

/** Whether any of the actor's roles grants the permission. */
export function can(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((role) => ROLE_PERMISSIONS[role].includes(permission));
}

export class Forbidden extends Error {
  constructor(readonly permission: Permission) {
    super(`forbidden: this account cannot ${permission}`);
    this.name = "Forbidden";
  }
}

/** Throws unless the actor holds the permission. Called in the service layer. */
export function authorize(roles: readonly Role[], permission: Permission): void {
  if (!can(roles, permission)) throw new Forbidden(permission);
}
