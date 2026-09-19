"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orderItems, orders } from "@/db/schema";
import { viewerOwnsOrder } from "@/components/order/viewer-owns-order";
import { readRememberedContact } from "@/lib/cart/remembered-contact";
import { getCustomer } from "@/lib/customer";
import { paise } from "@/lib/money";
import { getOrg } from "@/lib/repositories/org";
import { orderMessage } from "./messages";
import { whatsappLinkProvider } from "./whatsapp-link";

export type ShareResult = { ok: true; url: string } | { ok: false; error: string };

const DENIED: ShareResult = { ok: false, error: "You can only share your own order." };

/**
 * Builds the WhatsApp link for an order.
 *
 * Composed on the server from the stored order, not from whatever the page
 * happened to be showing — a message quoting a total is a statement about
 * money and should come from the row, not the DOM.
 *
 * The link embeds the customer's phone, and this action is reachable by any
 * anonymous visitor (the receipt page is public), so the caller must own the
 * order by the same rule the page uses to reveal that phone. A missing order
 * and someone else's order return the same denial: no phone, and no way to
 * tell which order ids exist.
 */
export async function whatsappOrderLink(input: { orderId: string }): Promise<ShareResult> {
  const org = await getOrg();
  if (!org) return DENIED;

  const database = db();
  const [order] = await database
    .select()
    .from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.orgId, org.id)))
    .limit(1);
  if (!order) return DENIED;

  const [customer, remembered] = await Promise.all([getCustomer(), readRememberedContact()]);
  // Phone only, exactly as the invoice page decides it: orders carry no email.
  if (!viewerOwnsOrder({ customerPhone: order.customerPhone, customerEmail: null }, customer, remembered)) return DENIED;

  if (!order.customerPhone) return { ok: false, error: "There is no phone number on this order." };

  const items = await database.select().from(orderItems).where(eq(orderItems.orderId, order.id));

  /*
   * The link a customer opens. In production this must be the real domain: a
   * message containing localhost is a message with a link that works on
   * nobody's phone, and it would look like it had sent correctly.
   */
  const base = process.env.SITE_URL?.replace(/\/$/, "");
  if (!base) {
    return {
      ok: false,
      error:
        process.env.NODE_ENV === "production"
          ? "SITE_URL is not set, so the message would contain a link to nowhere."
          : "Set SITE_URL in .env.local to include an order link.",
    };
  }

  const message = orderMessage({
    orderNumber: order.orderNumber,
    invoiceNumber: order.invoiceNumber,
    customerName: order.customerName,
    total: paise(order.grandTotal),
    isDelivery: order.fulfilment === "DELIVERY",
    isPaid: order.status === "PAID" || order.status === "COMPLETED",
    items: items.map((item) => ({ name: item.productName, quantity: item.quantity })),
    link: `${base}/order/${order.id}`,
  });

  const result = await whatsappLinkProvider.sendWhatsapp({ to: order.customerPhone, message });
  if (!result.ok || !result.url) return { ok: false, error: result.error ?? "That link could not be built." };

  return { ok: true, url: result.url };
}
