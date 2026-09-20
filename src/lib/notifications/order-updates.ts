/**
 * Order-status messages (roadmap 7.2). Pure: status and stored facts in,
 * words out. The old `orderMessage` is the manual "share my invoice" text;
 * this is what the outbox sends when an order moves.
 *
 * The payment line is decided by what is actually owed and how, not by
 * "unpaid": an order awaiting an online payment must never be told to pay at
 * the counter (notify-copy-1 in messages.ts says exactly that).
 */

import { formatINR, type Paise } from "@/lib/money";
import type { FulfilmentType, OrderStatus } from "@/domain/order-status";

export const NOTIFIABLE_STATUSES = ["ACCEPTED", "READY", "OUT_FOR_DELIVERY"] as const;
export type NotifiableStatus = (typeof NOTIFIABLE_STATUSES)[number];

export function isNotifiableStatus(status: OrderStatus): status is NotifiableStatus {
  return (NOTIFIABLE_STATUSES as readonly string[]).includes(status);
}

/** PAID: settled. COLLECT: cash at the counter or the door. ONLINE_PENDING: an online payment not yet captured. */
export type PaymentPosition = "PAID" | "COLLECT" | "ONLINE_PENDING";

export interface OrderUpdateInput {
  readonly status: OrderStatus;
  readonly orderNumber: string;
  readonly customerName: string | null;
  readonly fulfilment: FulfilmentType;
  readonly payment: PaymentPosition;
  readonly total: Paise;
  /** Absolute link to the order. */
  readonly link: string;
}

export interface OrderUpdateMessage {
  /** Template name a WhatsApp Business account would have approved. */
  readonly template: "order_accepted" | "order_ready" | "order_out_for_delivery";
  readonly body: string;
}

function headline(input: OrderUpdateInput): { template: OrderUpdateMessage["template"]; text: string } | null {
  switch (input.status) {
    case "ACCEPTED":
      return { template: "order_accepted", text: `We have accepted order #${input.orderNumber} and the kitchen is on it.` };
    case "READY":
      return {
        template: "order_ready",
        text:
          input.fulfilment === "DELIVERY"
            ? `Order #${input.orderNumber} is cooked and waiting for a rider.`
            : input.fulfilment === "DINE_IN"
              ? `Order #${input.orderNumber} is ready. It is on its way to your table.`
              : `Order #${input.orderNumber} is ready to collect.`,
      };
    case "OUT_FOR_DELIVERY":
      // Only a delivery order can be out for delivery.
      if (input.fulfilment !== "DELIVERY") return null;
      return { template: "order_out_for_delivery", text: `Order #${input.orderNumber} is out for delivery.` };
    default:
      return null;
  }
}

function paymentLine(input: OrderUpdateInput): string | null {
  if (input.payment === "PAID") return null;
  if (input.payment === "ONLINE_PENDING") return "We are still waiting for your online payment.";
  return input.fulfilment === "DELIVERY" ? "Pay the rider on delivery." : "Pay at the counter when you collect.";
}

export function orderUpdateMessage(input: OrderUpdateInput): OrderUpdateMessage | null {
  const head = headline(input);
  if (!head) return null;

  const lines = ["FRYBIRD", input.customerName ? `Hi ${input.customerName}, ${head.text}` : head.text, `Total ${formatINR(input.total)} (incl. GST)`];
  const pay = paymentLine(input);
  if (pay) lines.push(pay);
  lines.push("", input.link);
  return { template: head.template, body: lines.join("\n") };
}
