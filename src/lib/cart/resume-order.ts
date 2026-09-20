/**
 * Whether a checkout that is refused because an unpaid online order is still
 * open may be sent to that order's page. Only its own customer, signed in: a
 * phone number is not proof of who is asking, and the order id is what opens
 * the page (its name, phone, email and payment state).
 */
export function mayResumePendingOrder(orderCustomerId: string | null, viewerCustomerId: string | null): boolean {
  return orderCustomerId !== null && viewerCustomerId !== null && orderCustomerId === viewerCustomerId;
}
