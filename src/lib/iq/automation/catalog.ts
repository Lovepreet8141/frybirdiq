/**
 * The action catalog — every kind of action the engine may propose or take.
 *
 * DESIGN.md §4 as amended by DESIGN-v2-DELTA.md §4. An action kind that is
 * not listed here does not exist: repositories, the inbox and executors key
 * on `ActionKind`, never on a free string.
 *
 * A3 kinds are listed so the engine can recommend them and hand them to a
 * person. `ExecutableActionKind` excludes them, so an executor for a price
 * change or a refund cannot be typed.
 */
import type { ActionTier } from "../engine";
import { isMoneyDomain, type ActionDomain, type TierFor } from "./tiers";

/** How a completed action is reversed. */
export type UndoKind = "NONE" | "REVERT" | "COMPENSATING";

export type Undo =
  | { readonly kind: "NONE" }
  | { readonly kind: "REVERT" | "COMPENSATING"; readonly windowSeconds: number };

/** An owner decision (hive tasks.json `dec-*`) that must be taken before the kind may be proposed. */
export type BlockingDecision = "dec-5";

export type CatalogEntry<D extends ActionDomain = ActionDomain, T extends ActionTier = ActionTier> = {
  readonly domain: D;
  readonly tier: T;
  readonly undo: Undo;
  readonly blockedBy: BlockingDecision | null;
  readonly summary: string;
};

const HOUR = 3600;
const DAY = 24 * HOUR;

/**
 * Builds one entry. The tier parameter is constrained by the domain, so a
 * money-domain entry below any tier other than A3 is a compile error.
 */
export function defineCatalogEntry<D extends ActionDomain, T extends TierFor<D>>(e: CatalogEntry<D, T>): CatalogEntry<D, T> {
  return e;
}

export const ACTION_CATALOG = {
  // A0 inform
  "brief.publish": defineCatalogEntry({
    domain: "insights",
    tier: "A0",
    undo: { kind: "NONE" },
    blockedBy: null,
    summary: "Publish the daily or weekly brief",
  }),
  "detection.publish": defineCatalogEntry({
    domain: "insights",
    tier: "A0",
    undo: { kind: "NONE" },
    blockedBy: null,
    summary: "Publish a detection",
  }),
  "forecast.publish": defineCatalogEntry({
    domain: "insights",
    tier: "A0",
    undo: { kind: "NONE" },
    blockedBy: null,
    summary: "Publish a forecast",
  }),
  "reconciliation.report": defineCatalogEntry({
    domain: "insights",
    tier: "A0",
    undo: { kind: "NONE" },
    blockedBy: null,
    summary: "Report reconciliation differences; never corrects them",
  }),

  // A1 safe internal
  "purchase_order.create_draft": defineCatalogEntry({
    domain: "purchasing",
    tier: "A1",
    undo: { kind: "REVERT", windowSeconds: DAY },
    blockedBy: null,
    summary: "Create a draft purchase order; nothing is sent to the supplier",
  }),
  "inventory.flag_recount": defineCatalogEntry({
    domain: "inventory",
    tier: "A1",
    undo: { kind: "REVERT", windowSeconds: DAY },
    blockedBy: null,
    summary: "Flag an ingredient for a stock recount",
  }),
  "prep_list.prefill": defineCatalogEntry({
    domain: "prep",
    tier: "A1",
    undo: { kind: "REVERT", windowSeconds: 12 * HOUR },
    blockedBy: null,
    summary: "Pre-fill tomorrow's prep list",
  }),
  "task.open_internal": defineCatalogEntry({
    domain: "internal_tasks",
    tier: "A1",
    undo: { kind: "REVERT", windowSeconds: 7 * DAY },
    blockedBy: null,
    summary: "Open an internal task for staff",
  }),

  // A2 owner approval
  "menu.mark_86": defineCatalogEntry({
    domain: "menu_availability",
    tier: "A2",
    undo: { kind: "COMPENSATING", windowSeconds: DAY },
    blockedBy: null,
    summary: "Mark a menu item unavailable",
  }),
  "customer.winback_message": defineCatalogEntry({
    domain: "customer_messaging",
    tier: "A2",
    undo: { kind: "NONE" },
    blockedBy: "dec-5",
    summary: "Send one consented win-back message to a lapsed customer",
  }),

  // A3 handed to a person, never executed
  "price.change": defineCatalogEntry({
    domain: "prices",
    tier: "A3",
    undo: { kind: "NONE" },
    blockedBy: null,
    summary: "Change a menu price",
  }),
  "tax.change": defineCatalogEntry({
    domain: "tax",
    tier: "A3",
    undo: { kind: "NONE" },
    blockedBy: null,
    summary: "Change a tax rate or HSN/SAC code",
  }),
  "refund.create": defineCatalogEntry({
    domain: "refunds",
    tier: "A3",
    undo: { kind: "NONE" },
    blockedBy: null,
    summary: "Refund an order",
  }),
  "promotion.change_discount": defineCatalogEntry({
    domain: "discounts_cancellations",
    tier: "A3",
    undo: { kind: "NONE" },
    blockedBy: null,
    summary: "Change a promotion's discount",
  }),
  "promotion.extend": defineCatalogEntry({
    domain: "discounts_cancellations",
    tier: "A3",
    undo: { kind: "NONE" },
    blockedBy: null,
    summary: "Extend a promotion's end date",
  }),
  "promotion.stop": defineCatalogEntry({
    domain: "discounts_cancellations",
    tier: "A3",
    undo: { kind: "NONE" },
    blockedBy: null,
    summary: "Stop a running promotion",
  }),
  "purchase_order.send": defineCatalogEntry({
    domain: "supplier_payments",
    tier: "A3",
    undo: { kind: "NONE" },
    blockedBy: null,
    summary: "Send a purchase order to the supplier, committing spend",
  }),
  "data.delete": defineCatalogEntry({
    domain: "data_deletion",
    tier: "A3",
    undo: { kind: "NONE" },
    blockedBy: null,
    summary: "Delete stored data",
  }),
} as const;

type Catalog = typeof ACTION_CATALOG;

export type ActionKind = keyof Catalog;
export type TierOf<K extends ActionKind> = Catalog[K]["tier"];
export type KindsOfTier<T extends ActionTier> = { [K in ActionKind]: TierOf<K> extends T ? K : never }[ActionKind];

/** Kinds the system may execute. A3 kinds are absent by construction. */
export type ExecutableActionKind = Exclude<ActionKind, KindsOfTier<"A3">>;
export type A1ActionKind = KindsOfTier<"A1">;
export type HandoffActionKind = KindsOfTier<"A3">;

export const ACTION_KINDS = Object.keys(ACTION_CATALOG) as ActionKind[];

export function isActionKind(value: string): value is ActionKind {
  return Object.hasOwn(ACTION_CATALOG, value);
}

export function catalogEntry(kind: ActionKind): CatalogEntry {
  return ACTION_CATALOG[kind];
}

export function isExecutableKind(kind: ActionKind): kind is ExecutableActionKind {
  return ACTION_CATALOG[kind].tier !== "A3";
}

/** Runtime backstop for the type-level rule, for rows read back from the database. */
export function tierIsPermitted(domain: ActionDomain, tier: ActionTier): boolean {
  return !isMoneyDomain(domain) || tier === "A3";
}
