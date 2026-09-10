"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orderItems, orders } from "@/db/schema";
import { paise } from "@/lib/money";
import { orderMessage } from "./messages";
import { whatsappLinkProvider } from "./whatsapp-link";

export type ShareResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Builds the WhatsApp link for an order.
 *
 * Composed on the server from the stored order, not from whatever the page
 * happened to be showing — a message quoting a total is a statement about
 * money and should come from the row, not the DOM.
 */
export async function whatsappOrderLink(input: { orderId: string }): Promise<ShareResult> {
  const database = db();
  const [order] = await database.select().from(orders).where(eq(orders.id, input.orderId)).limit(1);
  if (!order) return { ok: false, error: "That order does not exist." };
  if (!order.customerPhone) return { ok: false, error: "There is no phone number on this order." };

  const items = await database.select().from(orderItems).where(eq(orderItems.orderId, order.id));

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

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
