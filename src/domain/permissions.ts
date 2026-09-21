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
  /**
   * Choosing which rider takes a delivery (roadmap 6.3), and reassigning it.
   * OWNER, ADMIN and MANAGER. Deliberately not RIDER: a rider cannot hand
   * themselves the deliveries they would like, and not CASHIER (a cashier can
   * still close any delivery at the counter, `delivery.complete`).
   */
  "delivery.assign",
  /**
   * A rider taking an unassigned delivery for themselves ("Take it", rider-offer).
   * RIDER; OWNER and ADMIN hold it by the rules above but the take itself also
   * requires an active RIDER membership, so they assign instead. Not MANAGER or CASHIER.
   */
  "delivery.take",
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
  /**
   * Creating or editing a promotion — a discount that applies to every
   * qualifying order until it's turned off, not one order in front of a
   * cashier. Was gated on `settings.manage` ("the closest existing
   * permission to 'decides prices'"); this is that dedicated permission.
   *
   * Granted to OWNER and MANAGER — decided 2026-09-15. Run as a day-to-day
   * marketing tool a manager can operate without waiting on the owner,
   * rather than folded into the OWNER/ADMIN tier `menu.price` and
   * `menu.publish` sit in. Deliberately not ADMIN, even though ADMIN
   * outranks MANAGER almost everywhere else in this table — the decision
   * was specifically that promotions belong with the operational role that
   * already runs `orders.discount`, not with the administrative one.
   */
  "promotions.manage",
  "analytics.view",
  "reports.export",
  /** The payments ledger — every capture, by whom, by method. Read only. */
  "finance.view",
  /**
   * Writing money into the books: recording an expense, setting a food cost
   * target. Separate from `finance.view` on purpose — reading the till ledger
   * ("may this person see what was taken today") and writing an expense
   * ("may this person change what the P&L says") are different questions.
   */
  "finance.manage",
  /**
   * Approving an IQ action the engine proposed but may not run on its own
   * (tier A2) — the human "yes" an AUTOMATION record carries as its
   * approvalRef. OWNER only (hive/reviews/iq-0/DESIGN-v2-DELTA.md §4): an
   * approval acts on the business as a whole, so it sits with the person who
   * answers for it, not with whoever holds the most other permissions.
   */
  "iq.approve",
  /**
   * Turning an IQ auto policy on or off, or changing its limits — deciding
   * which actions run with no human approval at all. Strictly wider than
   * `iq.approve`, since a policy approves every future action of its kind in
   * advance. OWNER only, for the same reason.
   */
  "iq.autopolicy.manage",
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
  // finance.manage falls through on purpose, unlike finance.view above: ADMIN
  // already holds orders.refund, the highest-trust money action in this table,
  // so being unable to record that money was spent was an accident of
  // finance.manage not existing yet, not a boundary anyone intended. Decided
  // 2026-09-15 — nobody's access regresses, this only adds.
  //
  // promotions.manage is excluded here on purpose, unlike finance.manage above
  // — decided 2026-09-15 to sit with OWNER/MANAGER (see the permission's own
  // doc comment), not the OWNER/ADMIN tier menu.price and menu.publish use.
  //
  // iq.approve and iq.autopolicy.manage are excluded because both are OWNER
  // only (hive/reviews/iq-0/DESIGN-v2-DELTA.md §4). Without this line they
  // would fall through to ADMIN like every other new permission does.
  ADMIN: PERMISSIONS.filter(
    (permission) =>
      permission !== "settings.manage" &&
      permission !== "finance.view" &&
      permission !== "promotions.manage" &&
      permission !== "iq.approve" &&
      permission !== "iq.autopolicy.manage",
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
    "delivery.assign",
    "menu.view",
    "menu.edit",
    "inventory.view",
    "inventory.adjust",
    "inventory.waste",
    "purchasing.manage",
    "recipes.view",
    "customers.view",
    "customers.edit",
    "promotions.manage",
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
    /*
     * A one-person counter is also the kitchen at slow hours — the same
     * person rings up the order and calls it done on the KDS. Withholding
     * kitchen.update forced a second login for a step one person is already
     * doing. Owner-approved (roadmap 6): CASHIER can update ticket status,
     * but nothing here hands them the rest of the kitchen — recipes stay
     * out of reach.
     */
    "kitchen.update",
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
  RIDER: ["delivery.view", "delivery.complete", "delivery.take"],

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

/**
 * Whether someone holding `actorRoles` may grant `targetRole` to another
 * account.
 *
 * `staff.manage` says "may touch the roster" and nothing about which roles
 * that person may hand out — unchecked, it would let an ADMIN mint a fresh
 * OWNER over their own head. The rule: never grant a role that can do
 * something the granter cannot already do themselves.
 *
 * Checked against the real permission sets `permissionsFor` returns, never a
 * second, hand-maintained rank, so it can never drift from what a role
 * actually unlocks — and a quirk like `finance.view` being MANAGER-and-OWNER
 * only (deliberately not ADMIN, see the comment above `ROLE_PERMISSIONS`) is
 * honoured rather than special-cased away: an ADMIN genuinely cannot grant
 * MANAGER, because MANAGER can see money ADMIN itself cannot.
 */
export function canGrantRole(actorRoles: readonly Role[], targetRole: Role): boolean {
  const granted = new Set(actorRoles.flatMap((role) => permissionsFor(role)));
  return permissionsFor(targetRole).every((permission) => granted.has(permission));
}

/**
 * Whether these roles are limited to the deliveries assigned to them (roadmap
 * 6.3). A rider is: they hold `delivery.complete` but not `orders.update`. Anyone
 * who can update orders at the counter (OWNER, ADMIN, MANAGER, CASHIER) sees and
 * may close every delivery, as before. The same "rider, not counter" test the
 * cash-at-the-door path uses, kept in one place.
 */
export function seesOnlyOwnDeliveries(roles: readonly Role[]): boolean {
  return !can(roles, "orders.update");
}

/**
 * Who may open the orders board (/app/orders). It lists every open order with
 * customer names, phones and delivery addresses, so it is for the counter and the
 * kitchen (`orders.view` or `kitchen.view`), not for a rider, who has their own
 * scoped Deliveries page. The page used to require only a signed-in staff member,
 * so a rider who typed the address saw every delivery in the shop (found in the
 * rider-assignment review).
 */
export function mayOpenOrdersBoard(roles: readonly Role[]): boolean {
  return can(roles, "orders.view") || can(roles, "kitchen.view");
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
