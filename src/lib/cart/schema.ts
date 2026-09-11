/**
 * What a cart holds.
 *
 * Deliberately only *what* the customer chose — never a price, never a total.
 * §13: "Never trust the client for totals. Server recalculates." The cart
 * lives in a cookie the browser can edit at will, so the only safe thing to
 * put in it is a reference the server can price for itself.
 *
 * If a price ever appears in this schema, the cart has become forgeable.
 */

import { z } from "zod";

/** One line. `modifiers` are modifier slugs within the product's own groups. */
export const cartLineSchema = z.object({
  slug: z.string().min(1).max(120),
  quantity: z.number().int().min(1).max(50),
  modifiers: z.array(z.string().min(1).max(120)).max(20).default([]),
  /**
   * "Make this my FRYBIRD REWARDS free item." An intent, not a discount —
   * the server decides whether it is honoured (an available reward, an
   * eligible price) the same way it decides everything else about the
   * cart. See `priceCart` in ./index.
   */
  redeemStamp: z.boolean().default(false),
});

export const cartSchema = z.object({
  // A cart is capped so a hostile cookie cannot make the server price ten
  // thousand lines on every render.
  lines: z.array(cartLineSchema).max(50).default([]),
  /**
   * A code the customer typed, not a discount they claimed.
   *
   * The server looks it up and decides what it is worth. Putting the amount
   * here would make the discount forgeable, which is the same reason no price
   * appears in this schema.
   */
  promoCode: z.string().max(40).optional(),
  /** Points the customer asked to spend. Capped and priced on the server. */
  points: z.number().int().min(0).max(1_000_000).optional(),
});

export type CartLine = z.infer<typeof cartLineSchema>;
export type Cart = z.infer<typeof cartSchema>;

export const EMPTY_CART: Cart = { lines: [] };

/**
 * Identity of a line, for merging.
 *
 * Two of the same burger are one line of quantity two; the same wings at
 * different heat are two lines. Modifiers are sorted so selection order does
 * not create a duplicate line.
 */
export function lineKey(line: Pick<CartLine, "slug" | "modifiers">): string {
  return [line.slug, ...[...line.modifiers].sort()].join("|");
}
