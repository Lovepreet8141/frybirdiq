/**
 * The till's arithmetic and words (roadmap 5.1-5.3). Pure: paise in, paise and
 * sentences out. Every figure is a sum over stored rows that the repository
 * counted; nothing here reads a database or a clock, and no money is ever a
 * float (`src/lib/money` does the sums).
 */

import { type Paise, ZERO, abs, add, formatINR, fromRupees, isNegative, isZero, paise, subtract } from "@/lib/money";

/** What the drawer should hold: the float, plus cash taken in the session, minus cash paid back out of it. */
export function expectedCash(input: { readonly openingFloat: Paise; readonly cashTaken: Paise; readonly cashRefunded: Paise }): Paise {
  return subtract(add(input.openingFloat, input.cashTaken), input.cashRefunded);
}

/** counted - expected: negative is short, positive is over, zero is exact. */
export function varianceOf(counted: Paise, expected: Paise): Paise {
  return subtract(counted, expected);
}

/** "Exact", "₹20 short", "₹20 over": the variance in the words a person says, never a bare signed number. */
export function varianceWords(variance: Paise): string {
  if (isZero(variance)) return "Exact";
  return `${formatINR(abs(variance))} ${isNegative(variance) ? "short" : "over"}`;
}

/** A counted or float amount typed as rupees: digits with up to two decimals, zero allowed, never negative. */
export type AmountParse = { readonly ok: true; readonly value: Paise } | { readonly ok: false; readonly error: string };

export const MAX_CASH_AMOUNT = fromRupees("10000000");

export function parseCashAmount(text: string, label: string): AmountParse {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return { ok: false, error: `Enter ${label} like 2000 or 2000.50.` };
  const value = fromRupees(trimmed);
  if (value > MAX_CASH_AMOUNT) return { ok: false, error: `That ${label} is too large to be right.` };
  return { ok: true, value };
}

/** Sums a list of paise amounts (bigint), never through a float. */
export function sumPaise(amounts: readonly Paise[]): Paise {
  return amounts.length === 0 ? ZERO : add(...amounts);
}

export { paise };
