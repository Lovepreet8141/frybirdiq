/**
 * Action risk tiers and the domains an action touches.
 *
 * hive/org/INTELLIGENCE-ENGINE.md §4, DESIGN.md §4 as amended by
 * DESIGN-v2-DELTA.md §4.
 *
 * - A0 inform — publishes an insight; runs without approval.
 * - A1 safe internal — reversible, internal; runs automatically only under an
 *   enabled auto policy (`policy.ts`), otherwise it waits for approval like A2.
 * - A2 owner approval — one tap in the approval inbox; the request expires.
 * - A3 never automated — handed to a person; there is no executor for it.
 *
 * Money data is read-only to the engine. An action in a money domain is A3,
 * and that is checked by the compiler: `TierFor<D>` is `"A3"` for every money
 * domain, so a catalog entry that puts a refund at A2 does not typecheck.
 */
import type { ActionTier } from "../engine";

export const MONEY_DOMAINS = [
  "payments",
  "refunds",
  "settlements",
  "invoices",
  "invoice_numbering",
  "order_money",
  "prices",
  "tax",
  "expenses",
  "loyalty_balances",
  "loyalty_issue_expiry",
  "delivery_fees_zones",
  "cash_float",
  "discounts_cancellations",
  "cod_payment_toggles",
  "supplier_payments",
  "payroll",
  "customer_bulk_messaging",
  "data_deletion",
] as const;
export type MoneyDomain = (typeof MONEY_DOMAINS)[number];

/** Domains the engine may act in. None of them moves, prices or deletes money data. */
export const OPERATIONAL_DOMAINS = [
  "insights",
  "purchasing",
  "inventory",
  "prep",
  "internal_tasks",
  "menu_availability",
  "customer_messaging",
] as const;
export type OperationalDomain = (typeof OPERATIONAL_DOMAINS)[number];

export type ActionDomain = MoneyDomain | OperationalDomain;

/** The tiers an action in domain `D` may take: only A3 for money. */
export type TierFor<D extends ActionDomain> = D extends MoneyDomain ? "A3" : ActionTier;

const MONEY_DOMAIN_SET: ReadonlySet<string> = new Set(MONEY_DOMAINS);

export function isMoneyDomain(domain: string): domain is MoneyDomain {
  return MONEY_DOMAIN_SET.has(domain);
}

export const TIER_ORDER: readonly ActionTier[] = ["A0", "A1", "A2", "A3"];

/** Whether the system may ever run an action of this tier itself. */
export function isExecutableTier(tier: ActionTier): tier is "A0" | "A1" | "A2" {
  return tier !== "A3";
}

/**
 * Whether a person must approve before execution, before any auto policy is
 * considered. A1 answers true here: automatic A1 is the exception granted by
 * `evaluateAutoPolicy`, not the default.
 */
export function requiresApprovalByDefault(tier: ActionTier): boolean {
  return tier === "A1" || tier === "A2";
}
