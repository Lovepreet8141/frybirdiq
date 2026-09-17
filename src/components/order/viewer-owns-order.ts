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
  readonly customerPhone: string | null;
  readonly customerEmail: string | null;
}

export interface SignedInIdentity {
  readonly phone: string | null;
  readonly email: string | null;
}

export interface RememberedIdentity {
  readonly phone: string;
}

export function viewerOwnsOrder(
  order: OrderContact,
  customer: SignedInIdentity | null,
  remembered: RememberedIdentity | null,
): boolean {
  if (order.customerPhone && customer?.phone === order.customerPhone) return true;
  if (order.customerEmail && customer?.email === order.customerEmail) return true;
  if (order.customerPhone && remembered?.phone === order.customerPhone) return true;
  return false;
}
