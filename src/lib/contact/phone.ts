/**
 * The shop's phone, as something a customer can dial.
 *
 * The number itself is never written in code: it comes from the outlet row
 * (`getStoreContact().phone`). When that is unset — or is not a number that
 * passes the contact-phone rule — this returns null and every surface omits
 * the call line entirely, rather than telling a customer to call a number
 * that does not exist.
 *
 * The rule, and the `tel:` link, come from `parseContactPhone`
 * (`@/lib/settings/phone`) — the same parse the settings form saves with.
 * There is no second copy of the digit rules here.
 */

import { parseContactPhone } from "@/lib/settings/phone";

export interface ShopPhone {
  /** As stored, for showing. */
  readonly display: string;
  /** `tel:` link built from the parse (`tel:+91XXXXXXXXXX`, or `tel:1800…` toll-free). */
  readonly href: string;
}

export function shopPhone(raw: string | null | undefined): ShopPhone | null {
  if (raw == null) return null;
  const parsed = parseContactPhone(raw);
  return parsed.ok ? { display: parsed.value, href: parsed.href } : null;
}
