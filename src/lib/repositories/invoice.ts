import "server-only";

/** Everything a tax invoice or a customer receipt needs, gathered in one read. */

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { locations, orderItemModifiers, orderItems, orders, organizations, payments } from "@/db/schema";
import { type Paise, paise } from "@/lib/money";
import type { OrderChannel } from "@/domain/order-channel";
import type { FulfilmentType, OrderStatus } from "@/domain/order-status";

export interface InvoiceLine {
  readonly name: string;
  readonly modifiers: string[];
  readonly hsnCode: string | null;
  readonly quantity: number;
  readonly unitPrice: Paise;
  readonly taxable: Paise;
  readonly rateBps: number;
  readonly cgst: Paise;
  readonly sgst: Paise;
  readonly total: Paise;
}

export interface Invoice {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly orgId: string;
  /** Null for a guest order — nothing loyalty-related can be read without one. */
  readonly customerId: string | null;
  /** Null until the order is paid. */
  readonly invoiceNumber: string | null;
  readonly invoicedAt: Date | null;
  readonly placedAt: Date | null;
  readonly status: OrderStatus;
  readonly channel: OrderChannel;
  readonly fulfilment: FulfilmentType;
  /** Set only for a "choose a time" order; null means ASAP. */
  readonly scheduledFor: Date | null;
  /** What the customer typed in at checkout, if anything — printed as the discount's label when set. */
  readonly promotionCode: string | null;
  /** The FRYBIRD REWARDS free item this order redeemed, if any — separate from `discountTotal`. */
  readonly stampRewardDiscount: Paise;
  /** Points this order earned, written once at payment capture. 0 until then, or if the order never qualifies. */
  readonly pointsEarned: number;

  readonly payment: {
    readonly method: string;
    readonly status: string;
    readonly reference: string | null;
  } | null;

  readonly seller: {
    readonly name: string;
    readonly legalName: string | null;
    /** Null means this cannot legally be called a tax invoice. */
    readonly gstin: string | null;
    readonly address: string;
    readonly state: string | null;
    readonly stateCode: string | null;
    readonly phone: string | null;
  };

  readonly customer: {
    readonly name: string | null;
    readonly phone: string | null;
    readonly address: string | null;
  };

  readonly lines: readonly InvoiceLine[];
  /** Menu value before any discount, excludes delivery. */
  readonly subtotal: Paise;
  readonly discountTotal: Paise;
  readonly deliveryFee: Paise;
  readonly taxable: Paise;
  readonly cgst: Paise;
  readonly sgst: Paise;
  readonly igst: Paise;
  readonly tax: Paise;
  readonly total: Paise;
  readonly pointsRedeemed: number;
}

export async function getInvoice(orderId: string): Promise<Invoice | null> {
  const database = db();

  const [order] = await database.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return null;

  const [org] = await database.select().from(organizations).where(eq(organizations.id, order.orgId)).limit(1);
  const [location] = await database.select().from(locations).where(eq(locations.id, order.locationId)).limit(1);
  const items = await database.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  const mods = await database.select().from(orderItemModifiers).where(eq(orderItemModifiers.orgId, order.orgId));

  // Captured beats pending, same rule the order-tracking page reads by —
  // once money has arrived that is the payment, whatever else was attempted.
  const paymentRows = await database.select().from(payments).where(eq(payments.orderId, order.id)).orderBy(desc(payments.createdAt));
  const paymentRow = paymentRows.find((row) => row.status === "CAPTURED") ?? paymentRows[0] ?? null;

  // Tax is split evenly per line the same way it was charged; the order-level
  // totals remain the authority, and the lines sum to them.
  const lines: InvoiceLine[] = items.map((item) => {
    const lineTax = paise(item.lineTax);
    const half = lineTax / 2n;
    return {
      name: item.productName,
      modifiers: mods.filter((mod) => mod.orderItemId === item.id).map((mod) => mod.modifierName),
      hsnCode: item.hsnCode,
      quantity: item.quantity,
      unitPrice: paise(item.unitPrice),
      taxable: paise(item.lineTaxable),
      rateBps: item.taxRateBps,
      cgst: (lineTax - half) as Paise,
      sgst: half as Paise,
      total: paise(item.lineTotal),
    };
  });

  const address = [location?.addressLine1, location?.addressLine2, location?.city, location?.state]
    .filter(Boolean)
    .join(", ");

  const deliveryAddress =
    order.fulfilment === "DELIVERY" && order.deliveryAddress
      ? [order.deliveryAddress.line1, order.deliveryAddress.landmark].filter(Boolean).join(", ")
      : null;

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    orgId: order.orgId,
    customerId: order.customerId,
    invoiceNumber: order.invoiceNumber,
    invoicedAt: order.invoicedAt,
    placedAt: order.placedAt,
    status: order.status,
    channel: order.channel,
    fulfilment: order.fulfilment,
    scheduledFor: order.scheduledFor,
    promotionCode: order.promotionCode,
    stampRewardDiscount: paise(order.stampRewardDiscount),
    pointsEarned: order.pointsEarned,
    payment: paymentRow ? { method: paymentRow.method, status: paymentRow.status, reference: paymentRow.providerPaymentId } : null,
    seller: {
      name: org?.name ?? "FRYBIRD",
      legalName: org?.legalName ?? null,
      gstin: org?.gstin ?? null,
      address,
      state: location?.state ?? null,
      stateCode: location?.stateCode ?? null,
      phone: location?.phone ?? null,
    },
    customer: {
      name: order.customerName,
      phone: order.customerPhone,
      address: deliveryAddress,
    },
    lines,
    subtotal: paise(order.subtotal),
    discountTotal: paise(order.discountTotal),
    deliveryFee: paise(order.deliveryFee),
    taxable: paise(order.taxableTotal),
    cgst: paise(order.cgstTotal),
    sgst: paise(order.sgstTotal),
    igst: paise(order.igstTotal),
    tax: paise(order.taxTotal),
    total: paise(order.grandTotal),
    pointsRedeemed: order.pointsRedeemed,
  };
}
