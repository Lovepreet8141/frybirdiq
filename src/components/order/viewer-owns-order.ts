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
