/**
 * The shop's phone, as something a customer can dial.
 *
 * The number itself is never written in code: it comes from the outlet row
 * (`getStoreContact().phone`). When that is unset — or too short to be a real
 * number — this returns null and every surface omits the call line entirely,
 * rather than telling a customer to call a number that does not exist.
 */

export interface ShopPhone {
  /** As stored, for showing. */
  readonly display: string;
  /** `tel:+91XXXXXXXXXX`, dials from a phone. */
  readonly href: string;
}

export function shopPhone(raw: string | null | undefined): ShopPhone | null {
  const display = raw?.trim();
  if (!display) return null;
  const digits = display.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return { display, href: `tel:+91${digits.slice(-10)}` };
}
