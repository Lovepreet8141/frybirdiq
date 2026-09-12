/**
 * Cash at the counter: what was handed over, and what goes back.
 *
 * Pure money arithmetic, so the rules a cashier relies on — "is this
 * enough", "what's the change", "which notes are they likely holding" —
 * are tested without a screen. The server re-derives the same figures
 * from the persisted order; nothing here is trusted for the sale itself.
 */

import { type Paise, ZERO, fromRupees, subtract } from "@/lib/money";

const RUPEES = /^\d{1,7}(\.\d{1,2})?$/;

/** "500" or "499.50" → paise. Anything else — blank, negative, letters — is null. */
export function parseTender(raw: string): Paise | null {
  const trimmed = raw.trim();
  if (!RUPEES.test(trimmed)) return null;
  return fromRupees(trimmed);
}

/** What goes back to the customer, or null when they haven't handed over enough. */
export function changeDue(total: Paise, tendered: Paise): Paise | null {
  if (tendered < total) return null;
  return subtract(tendered, total);
}

/**
 * The amounts a customer is likely to hand over: the exact total, then the
 * next ₹50, ₹100 and ₹500 boundaries above it, without repeats. At most
 * four, so the buttons stay big enough to hit with wet hands.
 */
export function quickTenders(total: Paise): readonly Paise[] {
  if (total <= ZERO) return [];
  const steps = [5000n, 10000n, 50000n];
  const candidates = new Set<bigint>([total]);
  for (const step of steps) {
    const rounded = ((total + step - 1n) / step) * step;
    if (rounded > total) candidates.add(rounded);
  }
  return [...candidates].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, 4) as Paise[];
}
