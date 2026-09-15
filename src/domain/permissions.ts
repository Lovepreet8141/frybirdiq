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
  "RIDER",
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
  "delivery.view",
  /** Mark a delivery done and record the cash taken at the door. */
  "delivery.complete",
  "menu.view",
  "menu.edit",
  "menu.price",
  "menu.publish",
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
  /** The payments ledger — every capture, by whom, by method. Read only. */
  "finance.view",
  /**
   * Writing money into the books: recording an expense, setting a food cost
   * target.
   *
   * Separate from `finance.view` because they are different questions. Reading
   * the till ledger is "may this person see what was taken today"; writing an
   * expense is "may this person change what the P&L says". Those were the same
   * check until now, and the conflation had a visible consequence: ADMIN is
   * deliberately excluded from `finance.view` (see the note below), so an ADMIN
   * — the second most trusted role, holding orders.refund, menu.price and
   * staff.manage — could not record an expense while a MANAGER could.
   *
   * Granted here to exactly the roles that could already write, so this
   * separation changes nobody's access. Whether ADMIN should now be able to
   * record an expense is a real decision and is left open rather than made by
   * a filter default — see PENDING-DECISIONS.md.
   */
  "finance.manage",
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

  // finance.view is deliberately OWNER and MANAGER only — the people who run
  // the till day to day — and was added as an explicit decision, not by
  // letting it fall through this "everything but settings" rule.
  //
  // finance.manage is excluded on purpose too, and for a weaker reason: to hold
  // ADMIN's access exactly where it was when the permission was introduced.
  // Letting it fall through the filter would have handed ADMIN a capability it
  // has never had, as a side effect of a refactor. That is the wrong way for
  // anyone to gain the ability to write into the P&L. PENDING-DECISIONS.md
  // carries the question.
  ADMIN: PERMISSIONS.filter(
    (permission) =>
      permission !== "settings.manage" &&
      permission !== "finance.view" &&
      permission !== "finance.manage",
  ),

  MANAGER: [
    "orders.view",
    "orders.create",
    "orders.update",
    "orders.cancel",
    "orders.refund",
    "orders.discount",
    "kitchen.view",
    "kitchen.update",
    "delivery.view",
    "delivery.complete",
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
    "finance.view",
    "finance.manage",
  ],

  CASHIER: [
    "orders.view",
    "orders.create",
    "orders.update",
    /*
     * A cashier can turn an order down.
     *
     * Saying "we have sold out" is the counter's decision to make, and a shop
     * where only a manager can decline leaves customers waiting for food that
     * is never coming. The blast radius is bounded elsewhere: rejecting an
     * order that has been paid for is refused outright, because that is a
     * refund — which a cashier still cannot do.
     */
    "orders.cancel",
    "orders.discount",
    "kitchen.view",
    "delivery.view",
    "delivery.complete",
    "menu.view",
    "customers.view",
    "customers.edit",
  ],

  KITCHEN: ["orders.view", "kitchen.view", "kitchen.update", "menu.view", "recipes.view", "inventory.waste"],

  /**
   * A rider sees the deliveries and closes them. Nothing else.
   *
   * Deliberately without `orders.update` or `kitchen.update`, which would let
   * them move any ticket in the shop from their phone. `delivery.complete`
   * only acts on an order that is already out for delivery — the narrowest
   * permission that lets someone finish the job they are actually doing.
   */
  RIDER: ["delivery.view", "delivery.complete"],

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
