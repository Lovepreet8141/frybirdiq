import { type Paise, ZERO, compare, formatINR, fromRupees } from "@/lib/money";

/**
 * What is left to give back, or why the typed amount can't be sent yet.
 *
 * `remaining` is `captured − (RESERVED + SUCCEEDED)` (ref-2 design §1) — the
 * caller subtracts before calling this, so a refund already in flight
 * (RESERVED) is excluded the same as one that already succeeded. Blank
 * input reads as "everything that's left" (`remaining`), matching the
 * dialog's placeholder and its existing empty-input contract.
 *
 * A separate module from `refund-dialog.tsx` on purpose: that file imports
 * `refundPaymentAction`, a "use server" action whose module graph is
 * `server-only`-guarded and only resolves under Next's own runtime, so a
 * test importing the component directly fails outside Next even for pure
 * logic like this.
 */
export function readAmount(input: string, remaining: Paise): { value: Paise; error: string | null } {
  const trimmed = input.trim();
  if (trimmed === "") return { value: remaining, error: null };

  let parsed: Paise;
  try {
    parsed = fromRupees(trimmed);
  } catch {
    return { value: remaining, error: "Enter a valid amount." };
  }
  if (compare(parsed, ZERO) <= 0) return { value: remaining, error: "Enter an amount greater than zero." };
  if (compare(parsed, remaining) > 0) return { value: remaining, error: `Can't refund more than ${formatINR(remaining)}.` };
  return { value: parsed, error: null };
}
