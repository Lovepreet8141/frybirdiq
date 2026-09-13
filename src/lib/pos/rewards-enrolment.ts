import { z } from "zod";

/**
 * FRYBIRD REWARDS enrolment at the counter — the pure part.
 *
 * A customer offers their mobile number so the order they are paying for
 * counts toward stamps and points. Everything about *what* it earns is the
 * existing loyalty path (`recordCashPayment` → `awardStampForOrder` and
 * `pointsEarned`, keyed on `orders.customer_id`); this module only decides
 * whether a typed number is a number, so the same rule runs in the keypad
 * (inline error, nothing sent) and again on the server (schema, nothing
 * placed).
 */

/** An Indian mobile: ten digits, first digit 6–9. */
export const INDIAN_MOBILE = /^[6-9]\d{9}$/;

export const counterPhoneSchema = z.string().regex(INDIAN_MOBILE, "Enter a 10-digit mobile number.");

export type ParsedMobile = { readonly ok: true; readonly phone: string } | { readonly ok: false; readonly error: string };

/**
 * Reads what a person typed or pasted as a mobile number.
 *
 * Forgiving about how it was written — spaces, dashes, a `+91` or a leading
 * `0` are how numbers appear on a menu card or a contact — and strict about
 * what it is: exactly ten digits starting 6–9. Anything else is one sentence
 * the keypad shows in place, and the number is never sent.
 */
export function parseMobile(raw: string): ParsedMobile {
  let digits = raw.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+91")) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

  if (digits === "") return { ok: false, error: "Enter the customer's mobile number." };
  if (!/^\d+$/.test(digits)) return { ok: false, error: "A mobile number is digits only." };
  if (digits.length !== 10) return { ok: false, error: `That's ${digits.length} digits — a mobile number has 10.` };
  if (!INDIAN_MOBILE.test(digits)) return { ok: false, error: "An Indian mobile number starts with 6, 7, 8 or 9." };
  return { ok: true, phone: digits };
}

/** One line for the checkout chip: what this customer already has. */
export function rewardsSummary(input: {
  readonly found: boolean;
  readonly rewards: { readonly stampCount: number; readonly stampsRequired: number; readonly availableRewardCount: number } | null;
  readonly points: number | null;
}): string {
  if (!input.found) return "New — enrolled with this order";
  const parts: string[] = [];
  if (input.rewards) {
    parts.push(
      input.rewards.availableRewardCount > 0
        ? `${input.rewards.availableRewardCount} reward${input.rewards.availableRewardCount > 1 ? "s" : ""} ready`
        : `${input.rewards.stampCount}/${input.rewards.stampsRequired} stamps`,
    );
  }
  if (input.points !== null) parts.push(`${input.points} point${input.points === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(" · ") : "No rewards activity yet";
}
