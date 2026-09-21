/**
 * Whether this browser belongs to the person who placed the order — the only
 * question that decides if their phone/email leave the server on the public
 * `/order/[id]` tracking page. That link is an unguessable UUID but not a
 * secret in the security sense: it gets shared (screenshots, forwarded
 * messages), so "knows the link" cannot be "is the customer". Checked two
 * ways, either sufficient: a signed-in customer whose own phone or email
 * matches this order, or the httpOnly `frybird_contact` checkout cookie this
 * same browser already holds (`src/lib/cart/remembered-contact.ts`) matching
 * this order's phone.
 */

export interface OrderContact {
  /** Needed for a signed cookie, which proves the orders this browser placed, not a phone number. */
  readonly id?: string;
  readonly customerPhone: string | null;
  readonly customerEmail: string | null;
}

export interface SignedInIdentity {
  readonly phone: string | null;
  readonly email: string | null;
}

export interface RememberedIdentity {
  readonly phone: string;
  /** True only when the cookie was verified against COOKIE_SECRET (cookie-sign-1). Absent/false = the legacy unsigned cookie. */
  readonly trusted?: boolean;
  /** The orders this browser placed (only meaningful when `trusted`). */
  readonly orderIds?: readonly string[];
}

/**
 * The phone a remembered-contact cookie may vouch for on this order. A signed cookie proves only the orders it was issued for
 * (an attacker can get a validly signed cookie for a victim's phone by typing it into their own checkout), so it vouches for its
 * phone on those orders alone; the legacy unsigned cookie behaves as before.
 */
export function rememberedPhoneFor(orderId: string, remembered: RememberedIdentity | null): string | null {
  if (!remembered) return null;
  if (remembered.trusted) return remembered.orderIds?.includes(orderId) ? remembered.phone : null;
  return remembered.phone;
}

export function viewerOwnsOrder(
  order: OrderContact,
  customer: SignedInIdentity | null,
  remembered: RememberedIdentity | null,
): boolean {
  if (order.customerPhone && customer?.phone === order.customerPhone) return true;
  if (order.customerEmail && customer?.email === order.customerEmail) return true;
  if (remembered?.trusted) return !!order.id && !!remembered.orderIds?.includes(order.id);
  if (order.customerPhone && remembered?.phone === order.customerPhone) return true;
  return false;
}

/** The name to greet a viewer by on `/order/[id]` — null unless they own the order. */
export function greetingName(customerName: string | null, isOwner: boolean): string | null {
  return isOwner ? customerName : null;
}

interface ReceiptCustomerContact {
  readonly name: string | null;
  readonly phone: string | null;
  readonly address: string | null;
}

/**
 * The receipt's "Billed to" name, phone and delivery address, for a viewer
 * who may not be the customer. A stranger with the order link gets
 * `name: null` — `FrybirdReceipt` already renders that as "Guest" — and
 * `phone: null` / `address: null`, which it already hides (the row and the
 * WhatsApp-to-customer share option). Every other field on the receipt
 * (line items, totals) is unaffected.
 */
export function redactReceiptCustomerForViewer<T extends ReceiptCustomerContact>(customer: T, isOwner: boolean): T {
  return isOwner ? customer : { ...customer, name: null, phone: null, address: null };
}
