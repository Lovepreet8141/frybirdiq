"use server";

import { z } from "zod";
import { toPoint } from "@/lib/delivery";
import { formatDistance } from "@/lib/delivery";
import { formatINR } from "@/lib/money";
import { priceOrder } from "@/lib/pricing";
import { getPricedCart } from "./index";
import { quoteForPin } from "@/lib/repositories/delivery";
import { resolvePricingContext } from "@/lib/repositories/org";

const pinSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export type DeliveryQuoteResult =
  | {
      available: true;
      /** Pre-formatted, so the client never assembles a money string. */
      fee: string;
      distance: string;
      orderTotal: string;
      taxTotal: string;
      waived: boolean;
    }
  | { available: false; reason: string };

/**
 * Quotes delivery to a pin and returns the whole recomputed total.
 *
 * Deliberately returns formatted strings rather than numbers. The client must
 * not add a fee to a subtotal and render the result — that is the client
 * computing money, and it drifts from what the server will actually charge.
 * Every figure shown here was calculated by the same code that writes the
 * order.
 *
 * This is a quote for display. The fee is recomputed from the pin when the
 * order is placed; nothing trusts what the browser was last shown.
 */
export async function quoteDeliveryAction(input: unknown): Promise<DeliveryQuoteResult> {
  const parsed = pinSchema.safeParse(input);
  if (!parsed.success) return { available: false, reason: "That location could not be read." };

  const cart = await getPricedCart();
  if (cart.lines.length === 0) return { available: false, reason: "Your order is empty." };

  const quote = await quoteForPin({
    to: toPoint(parsed.data),
    orderValue: cart.totals.gross,
  });

  if (!quote.available) return { available: false, reason: quote.reason };

  const context = await resolvePricingContext();
  const withFee = priceOrder(
    {
      lines: cart.lines.map((line) => ({
        unitPrice: line.product.price,
        quantity: line.quantity,
        modifierDeltas: line.modifiers.map((modifier) => modifier.priceDelta),
        rateBps: line.product.taxRateBps,
      })),
      fees:
        quote.fee > 0n
          ? [{ label: "Delivery", amount: quote.fee, rateBps: cart.lines[0]?.product.taxRateBps ?? 500 }]
          : [],
    },
    context,
  );

  return {
    available: true,
    fee: formatINR(quote.fee),
    distance: formatDistance(quote.chargeableMetres),
    orderTotal: formatINR(withFee.gross),
    taxTotal: formatINR(withFee.total),
    waived: quote.waived,
  };
}
