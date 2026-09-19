import { businessDate } from "@/lib/dates";

/**
 * The IST business days whose daily facts a SUCCEEDED refund changes.
 *
 * - The order's own day: sales, statuses and part refunds are keyed on
 *   `orders.created_at`, and a full refund takes the order out of that day's
 *   sale set.
 * - The day the money went back: `refunds_amount` counts SUCCEEDED refunds on
 *   the day of `finalized_at` (an-3).
 *
 * Never the day the refund was reserved. A refund reserved at 23:59 and
 * finalized at 00:05 belongs to the second day only. Deduplicated; empty is
 * impossible, since the order's day is always present.
 */
export function refundFactsDays(input: { readonly orderCreatedAt: Date; readonly finalizedAt: Date | null }): string[] {
  const days = [businessDate(input.orderCreatedAt)];
  if (input.finalizedAt !== null) days.push(businessDate(input.finalizedAt));
  return [...new Set(days)];
}
