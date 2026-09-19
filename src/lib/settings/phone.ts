/**
 * The outlet's contact number — the ONE rule for what can be saved and what
 * can be dialled, used by both sides.
 *
 * Write side (`parseContactPhone`, the settings form) and read side
 * (`readStoredPhone` here, `shopPhone` in `@/lib/contact/phone`) all go through
 * the same parse, so a number that saves can always be shown and dialled, and
 * the `tel:` link is built from the parse — never by truncating digits.
 *
 * The shop is in Ambala, India, so only numbers that dial correctly from India
 * are accepted (digits counted after stripping spaces, dashes and brackets):
 *   - 10 digits (mobile, or landline with area code)        -> tel:+91<10 digits>
 *   - 11 digits starting 0 (trunk prefix)                   -> tel:+91<10 digits after the 0>
 *   - 12 digits starting 91, with or without a leading "+"  -> tel:+91<10 digits>
 *   - 11 digits starting 1800 (toll-free)                   -> tel:<the 11 digits>
 * The 10-digit national number must not itself start with 0 (no Indian
 * number does). A leading "+" is only valid on the 91 form. Everything else
 * (7-9 digits, other lengths, non-India international) is rejected.
 *
 * What the owner typed is stored as typed (whitespace collapsed); it is not
 * reformatted. Legacy stored values that fail this rule read as absent.
 */

export const CONTACT_PHONE_ERROR = "Enter a 10-digit Indian number — mobile, or landline with the area code (for example 0172 255 0123).";

export type ContactPhoneResult =
  | { readonly ok: true; readonly value: string; readonly href: string }
  | { readonly ok: false; readonly error: string };

export function parseContactPhone(raw: string): ContactPhoneResult {
  const value = raw.trim().replace(/\s+/g, " ");
  if (!/^\+?[0-9\-\s()]+$/.test(value)) return { ok: false, error: "Enter a contact number — digits, spaces, dashes and brackets only." };
  const digits = value.replace(/\D/g, "");
  const plus = value.startsWith("+");
  const national = (ten: string): ContactPhoneResult =>
    /^[1-9]/.test(ten) ? { ok: true, value, href: `tel:+91${ten}` } : { ok: false, error: CONTACT_PHONE_ERROR };

  if (digits.length === 12 && digits.startsWith("91")) return national(digits.slice(2));
  if (plus) return { ok: false, error: CONTACT_PHONE_ERROR };
  if (digits.length === 10) return national(digits);
  if (digits.length === 11 && digits.startsWith("0")) return national(digits.slice(1));
  if (digits.length === 11 && digits.startsWith("1800")) return { ok: true, value, href: `tel:${digits}` };
  return { ok: false, error: CONTACT_PHONE_ERROR };
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
