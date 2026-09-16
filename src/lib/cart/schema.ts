/**
 * What a cart holds.
 *
 * Deliberately only *what* the customer chose — never a price, never a total.
 * §13: "Never trust the client for totals. Server recalculates." The cart
 * lives in a cookie the browser can edit at will, so the only safe thing to
 * put in it is a reference the server can price for itself.
 *
 * If a price ever appears in this schema, the cart has become forgeable.
 *
 * `idempotencyKey` is the one field here that isn't a customer choice — an
 * opaque request-dedup token, not money. Tampering with it is harmless by
 * construction: `withIdempotency` (`src/lib/repositories/idempotency.ts`)
 * rejects a key reused against different order content as a conflict rather
 * than trusting it, the same protection every other field here already
 * relies on.
 */

import { randomUUID } from "node:crypto";
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
  /**
   * This cart's own idempotency key — assigned once, by `writeCart`, the
   * first time a cart gets a line, and carried unchanged by every mutation
   * after that (see `writeCart`'s own comment). Checkout reads it back
   * rather than minting its own, so a reloaded checkout page resubmits the
   * *same* key a lost-response first attempt already used — `withIdempotency`
   * then returns that attempt's real result instead of placing a second
   * order. Cleared for free the moment the cart empties, since `writeCart`
   * deletes the whole cookie rather than writing an empty cart.
   */
  idempotencyKey: z.uuid().optional(),
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
 *
 * JSON rather than a `|` join, because a join has no escape. Joining on a
 * separator makes `{slug: "burger", modifiers: ["a|b"]}` and
 * `{slug: "burger", modifiers: ["a", "b"]}` the same key, and this key decides
 * which line `setQuantity` sets and which line `removeLine` removes — so a
 * collision edits the wrong line, or two lines at once.
 *
 * Real slugs cannot collide: the menu admin constrains them to
 * `[a-z0-9-]+` (`menu-admin/actions.ts`). But this cart is parsed from a
 * cookie the browser can edit, and `cartLineSchema` accepts any string up to
 * 120 characters there — deliberately, because tightening the cookie schema to
 * the slug format would reject any legacy cart whose slug predates that rule
 * and silently empty it. So the ambiguity is removed here, where it costs
 * nothing, rather than at a boundary where narrowing has a blast radius.
 *
 * The format is not persisted anywhere — it is recomputed on every read — so
 * changing it cannot invalidate stored data.
 */
export function lineKey(line: Pick<CartLine, "slug" | "modifiers">): string {
  return JSON.stringify([line.slug, [...line.modifiers].sort()]);
}

/**
 * Assigns a cart its `idempotencyKey` the first time it has a line in it —
 * a no-op once it already has one. Pure and framework-free on purpose: the
 * one place this durability rule lives, so it can be tested directly rather
 * than only indirectly through `writeCart` (which needs a real Next.js
 * request to call `cookies()` at all).
 */
export function ensureCartIdempotencyKey(cart: Cart): Cart {
  if (cart.lines.length === 0 || cart.idempotencyKey) return cart;
  return { ...cart, idempotencyKey: randomUUID() };
}
