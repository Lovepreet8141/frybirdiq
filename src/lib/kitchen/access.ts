import { type Role, can } from "@/domain/permissions";

/**
 * Who may open kitchen analytics: anyone who can see analytics or the kitchen.
 * The page shows prep durations and product names, no money and no customer
 * data. Existing permissions only; a role with neither (RIDER) is refused.
 */
export function mayViewKitchenAnalytics(roles: readonly Role[]): boolean {
  return can(roles, "analytics.view") || can(roles, "kitchen.view");
}
