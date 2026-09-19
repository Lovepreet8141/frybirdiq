/**
 * What a refused ASAP order tells the customer. Worded from the server's
 * `ShopClosedRefusal.opensAtLabel` verbatim — never rebuilt, never a browser clock.
 */

import type { ShopClosedRefusal } from "@/lib/repositories/orders";

export function refusedClosedText(closed: Pick<ShopClosedRefusal, "opensAtLabel">): string {
  return `We're closed, so this order wasn't placed and nothing was charged. We open ${closed.opensAtLabel}. Choose a time to order ahead.`;
}
