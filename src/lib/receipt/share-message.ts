import type { FulfilmentType } from "@/domain/order-status";

/**
 * The text that accompanies the invoice image when a customer shares it —
 * separate from `src/lib/notifications/messages.ts`'s `orderMessage`, which
 * is a full order summary for the pre-existing wa.me text link. This is a
 * short thank-you, keyed on `orders.fulfilment` (the authoritative field —
 * never inferred from the message itself), because the invoice image is
 * already the summary.
 */
export function channelThankYouMessage(fulfilment: FulfilmentType): string {
  switch (fulfilment) {
    case "DINE_IN":
      return "Thank you for dining with FRYBIRD! 🍗\nWe hope you enjoyed your meal.\nWe look forward to serving you again!";
    case "TAKEAWAY":
      return "Thanks for choosing FRYBIRD! 🍗\nWe hope you enjoyed your meal.\nSee you again soon!";
    case "DELIVERY":
      return "Your FRYBIRD order has been delivered! 🍗\nWe hope you enjoyed your meal.\nThank you for ordering with us — we look forward to serving you again!";
  }
}
