/**
 * What we actually say.
 *
 * Composing the message is separate from sending it, so the same text goes out
 * whether a person presses send in WhatsApp today or an API sends it later.
 *
 * Voice per design-system/content.md: plain, short, no exclamation marks.
 */

import { formatINR, type Paise } from "@/lib/money";

export interface OrderMessageInput {
  readonly orderNumber: string;
  readonly invoiceNumber: string | null;
  readonly customerName: string | null;
  readonly total: Paise;
  readonly isDelivery: boolean;
  readonly isPaid: boolean;
  readonly items: readonly { name: string; quantity: number }[];
  /** Absolute link to the order or its invoice. */
  readonly link: string;
}

export function orderMessage(input: OrderMessageInput): string {
  const lines: string[] = [];

  lines.push(`FRYBIRD — order #${input.orderNumber}`);
  if (input.customerName) lines.push(`For ${input.customerName}`);
  lines.push("");

  for (const item of input.items) lines.push(`${item.quantity}x ${item.name}`);

  lines.push("");
  lines.push(`Total ${formatINR(input.total)} (incl. GST)`);

  if (!input.isPaid) {
    lines.push(input.isDelivery ? "Pay the rider on delivery." : "Pay at the counter when you collect.");
  }

  if (input.invoiceNumber) lines.push(`Invoice ${input.invoiceNumber}`);

  lines.push("");
  lines.push(input.link);

  return lines.join("\n");
}
