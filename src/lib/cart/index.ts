import "server-only";

/**
 * The cart, priced on the server.
 *
 * Reads the cookie, resolves every line against the real menu, validates the
 * modifier selections, and prices the result through `src/lib/pricing` — which
 * reads the organization's GST basis, so the cart shows what the customer will
 * actually pay.
 *
 * Nothing the browser sends is trusted beyond "this product, this many, these
 * options". Everything else is computed here.
 */

import { cookies } from "next/headers";
import { type Paise, add } from "@/lib/money";
import { type PricedLine, type PricedOrder, priceLine, priceOrder, pricingContext } from "@/lib/pricing";
import { DEFAULT_PRICE_BASIS } from "@/lib/pricing";
import { type MenuModifier, type MenuProduct, getMenu } from "@/lib/repositories/menu";
import { type Cart, EMPTY_CART, cartSchema, lineKey } from "./schema";

export const CART_COOKIE = "frybird_cart";

/**
 * Reads and validates the cart cookie.
 *
 * A cookie that fails to parse is treated as an empty cart rather than an
 * error. It is attacker-controlled input; the correct response to junk is to
 * ignore it, not to break the page.
 */
export async function readCart(): Promise<Cart> {
  const raw = (await cookies()).get(CART_COOKIE)?.value;
  if (!raw) return EMPTY_CART;

  try {
    const parsed = cartSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_CART;
  } catch {
    return EMPTY_CART;
  }
}

export async function writeCart(cart: Cart): Promise<void> {
  const store = await cookies();
  if (cart.lines.length === 0) {
    store.delete(CART_COOKIE);
    return;
  }
  store.set(CART_COOKIE, JSON.stringify(cart), {
    httpOnly: false, // read by the client only to show a count; never trusted.
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export interface PricedCartLine {
  readonly key: string;
  readonly product: MenuProduct;
  readonly quantity: number;
  readonly modifiers: readonly MenuModifier[];
  /** Listed price of one unit including its modifiers. */
  readonly unitPrice: Paise;
  readonly priced: PricedLine;
}

export interface PricedCart {
  readonly lines: readonly PricedCartLine[];
  readonly totals: PricedOrder;
  readonly itemCount: number;
  /**
   * Lines that could not be honoured — a product pulled from the menu, or a
   * modifier that no longer exists.
   *
   * Surfaced rather than silently dropped. A cart that quietly loses an item
   * between the menu and checkout is how a customer ends up with the wrong
   * order and no idea why.
   */
  readonly rejected: readonly { slug: string; reason: string }[];
}

/** Resolves the modifier slugs a line carries against the product's own groups. */
function resolveModifiers(
  product: MenuProduct,
  selected: readonly string[],
): { modifiers: MenuModifier[]; error: string | null } {
  const modifiers: MenuModifier[] = [];

  for (const group of product.modifierGroups) {
    const chosen = group.modifiers.filter((modifier) => selected.includes(modifier.slug));

    if (chosen.length < group.minSelections) {
      // Fall back to the group's default rather than rejecting the line, so a
      // link shared without options still resolves to something orderable.
      const fallback = group.modifiers.find((modifier) => modifier.isDefault) ?? group.modifiers[0];
      if (!fallback) return { modifiers: [], error: `${group.name} has no options` };
      modifiers.push(fallback);
      continue;
    }

    if (group.maxSelections !== null && chosen.length > group.maxSelections) {
      return { modifiers: [], error: `Too many choices for ${group.name}` };
    }

    modifiers.push(...chosen);
  }

  return { modifiers, error: null };
}

/**
 * Prices a whole cart.
 *
 * The GST basis comes from the organization. Until Supabase exists there is no
 * organization row to read, so the confirmed default is used — the same value
 * the seed writes. See src/lib/pricing.
 */
export async function priceCart(cart: Cart): Promise<PricedCart> {
  const menu = await getMenu();
  const bySlug = new Map(menu.flatMap((category) => category.products).map((product) => [product.slug, product]));

  const resolved: PricedCartLine[] = [];
  const rejected: { slug: string; reason: string }[] = [];
  const context = pricingContext({ priceBasis: DEFAULT_PRICE_BASIS });

  const forPricing: { unitPrice: Paise; quantity: number; modifierDeltas: Paise[]; rateBps: number }[] = [];

  for (const line of cart.lines) {
    const product = bySlug.get(line.slug);
    if (!product) {
      rejected.push({ slug: line.slug, reason: "No longer on the menu" });
      continue;
    }

    const { modifiers, error } = resolveModifiers(product, line.modifiers);
    if (error) {
      rejected.push({ slug: line.slug, reason: error });
      continue;
    }

    const deltas = modifiers.map((modifier) => modifier.priceDelta);
    const unitPrice = add(product.price, ...deltas);

    forPricing.push({
      unitPrice: product.price,
      quantity: line.quantity,
      modifierDeltas: deltas,
      rateBps: product.taxRateBps,
    });

    resolved.push({
      key: lineKey(line),
      product,
      quantity: line.quantity,
      modifiers,
      unitPrice,
      // Replaced below with the line from the order-level pricing pass, so a
      // future order-level discount is allocated consistently.
      priced: priceLine({ unitPrice: product.price, quantity: line.quantity, modifierDeltas: deltas, rateBps: product.taxRateBps }, context),
    });
  }

  const totals = priceOrder({ lines: forPricing }, context);

  return {
    lines: resolved.map((line, index) => ({ ...line, priced: totals.lines[index] ?? line.priced })),
    totals,
    itemCount: resolved.reduce((count, line) => count + line.quantity, 0),
    rejected,
  };
}

/** Reads and prices in one step. What pages actually call. */
export async function getPricedCart(): Promise<PricedCart> {
  return priceCart(await readCart());
}

export { type Cart, EMPTY_CART, lineKey };
