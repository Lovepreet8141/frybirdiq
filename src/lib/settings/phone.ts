/**
 * The outlet's contact number — validation on the way in, a clean absent
 * value on the way out.
 *
 * Deliberately not clever about international formats: a customer-facing
 * number is only worth printing if it is something a person could dial, so
 * this rejects obvious nonsense (letters, no digits, "+" mid-number, too
 * short, longer than an E.164 number can be) and otherwise keeps what the
 * owner typed. It does not reformat, add a country code or guess a region.
 */

const MIN_DIGITS = 7;
/** E.164 caps a full international number at 15 digits. */
const MAX_DIGITS = 15;

export type ContactPhoneResult = { readonly ok: true; readonly value: string } | { readonly ok: false; readonly error: string };

export function parseContactPhone(raw: string): ContactPhoneResult {
  const value = raw.trim().replace(/\s+/g, " ");
  if (!/^\+?[0-9\-\s()]+$/.test(value)) return { ok: false, error: "Enter a contact number — digits, spaces, dashes and brackets only." };
  const digits = value.replace(/\D/g, "").length;
  if (digits < MIN_DIGITS || digits > MAX_DIGITS) return { ok: false, error: `A contact number has ${MIN_DIGITS} to ${MAX_DIGITS} digits.` };
  return { ok: true, value };
}

/**
 * What the customer site reads: the stored number, or `null` when there is
 * none. A blank or unusable stored value is absent, never an empty string
 * masquerading as a number.
 */
export function readStoredPhone(stored: string | null | undefined): string | null {
  if (stored == null) return null;
  const parsed = parseContactPhone(stored);
  return parsed.ok ? parsed.value : null;
}
