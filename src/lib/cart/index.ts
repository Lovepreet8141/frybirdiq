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
import { type Paise, ZERO, add, formatINR, multiply, subtract } from "@/lib/money";
import { applyPromotion } from "@/lib/promotions";
import { findPromotion } from "@/lib/repositories/promotions";
import { redeem } from "@/lib/loyalty";
import { getLoyaltyConfig, getStampConfig } from "@/lib/loyalty/config";
import { isRewardEligibleItem } from "@/lib/loyalty/stamps";
import { getAvailableStampReward } from "@/lib/repositories/loyalty";
import { getCustomer } from "@/lib/customer";
import { getOrg } from "@/lib/repositories/org";
import { type PricedLine, type PricedOrder, priceLine, priceOrder } from "@/lib/pricing";
import { resolvePricingContext } from "@/lib/repositories/org";
import { type MenuModifier, type MenuProduct, getMenu, resolveLineModifiers } from "@/lib/repositories/menu";
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

export interface AppliedPromotion {
  readonly code: string;
  readonly name: string;
  readonly discount: Paise;
}

export interface AppliedPoints {
  readonly points: number;
  readonly discount: Paise;
  readonly balance: number;
}

/** FRYBIRD REWARDS' free item, applied to this order. */
export interface AppliedStampReward {
  /** Which unlocked reward this order is spending. */
  readonly rewardId: string;
  /** The exact cart line that is free — matching by slug alone would be
   * ambiguous when the same product appears twice with different modifiers. */
  readonly lineKey: string;
  /** The item the customer chose as their free one. */
  readonly productSlug: string;
  /** What it's worth — its own listed price, the amount taken off. */
  readonly discount: Paise;
}

export interface PricedCart {
  readonly lines: readonly PricedCartLine[];
  readonly totals: PricedOrder;
  readonly itemCount: number;
  /** The code that was accepted, if any. */
  readonly promotion: AppliedPromotion | null;
  /** Why a code was refused. Specific, so the customer knows what to do. */
  readonly promotionError: string | null;
  /** Points actually spendable on this order. */
  readonly points: AppliedPoints | null;
  /** Set when the customer chose a valid free item and it was applied. */
  readonly stampReward: AppliedStampReward | null;
  /** Why a chosen free item was refused, if it was. */
  readonly stampRewardError: string | null;
  /** What is left to pay after points. This is the figure that gets charged. */
  readonly payable: Paise;
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

/**
 * Prices a whole cart.
 *
 * The GST basis comes from the organization row, so changing it there changes
 * every figure the customer sees without touching this function.
 */
export async function priceCart(cart: Cart): Promise<PricedCart> {
  const menu = await getMenu();
  const bySlug = new Map(menu.flatMap((category) => category.products).map((product) => [product.slug, product]));

  const resolved: PricedCartLine[] = [];
  const rejected: { slug: string; reason: string }[] = [];
  const context = await resolvePricingContext();

  const forPricing: { unitPrice: Paise; quantity: number; modifierDeltas: Paise[]; rateBps: number; discount?: Paise }[] = [];

  // The index into `resolved`/`forPricing` of the line the customer flagged
  // as their free item, if it survived resolution. Set inside the loop
  // rather than searched for afterward — a rejected earlier line would
  // otherwise throw the two arrays out of step with `cart.lines`.
  let redeemStampIndex = -1;

  for (const line of cart.lines) {
    const product = bySlug.get(line.slug);
    if (!product) {
      rejected.push({ slug: line.slug, reason: "No longer on the menu" });
      continue;
    }

    const { modifiers, error } = resolveLineModifiers(product, line.modifiers);
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

    if (line.redeemStamp && redeemStampIndex === -1) redeemStampIndex = resolved.length - 1;
  }

  // Resolved once, used by both loyalty programs below — a customer earns
  // points and a stamp from the same order.
  const customer = await getCustomer();
  const org = await getOrg();

  /*
   * FRYBIRD REWARDS. The customer chose which line is their free item — see
   * the `redeemStamp` flag on the cart schema — and this validates that
   * choice against the account's actual, server-held state: is there really
   * an unlocked reward, and is the chosen item really within the price cap.
   * Nothing here trusts the browser for the reward's existence or the
   * item's eligibility, only for *which* line was tapped.
   */
  let stampReward: AppliedStampReward | null = null;
  let stampRewardError: string | null = null;

  if (redeemStampIndex >= 0) {
    if (!customer) {
      stampRewardError = "Sign in to redeem your FRYBIRD REWARDS free item.";
    } else if (!org) {
      stampRewardError = "Rewards aren't available right now.";
    } else {
      const stampConfig = await getStampConfig();
      const available = await getAvailableStampReward(customer.id, org.id);

      if (!available) {
        stampRewardError = "You don't have a free item to redeem yet.";
      } else {
        const target = resolved[redeemStampIndex];
        if (!target || !isRewardEligibleItem(target.unitPrice, stampConfig)) {
          stampRewardError = `That item costs more than ${formatINR(stampConfig.maxRewardValue)} — pick something ${formatINR(stampConfig.maxRewardValue)} or under for your free item.`;
        } else {
          const forTarget = forPricing[redeemStampIndex];
          if (forTarget) {
            forTarget.discount = add(forTarget.discount ?? ZERO, target.unitPrice);
            stampReward = { rewardId: available.id, lineKey: target.key, productSlug: target.product.slug, discount: target.unitPrice };
          }
        }
      }
    }
  }

  /*
   * A promotion discounts the food, not the delivery fee — the shop giving
   * away margin on what it sells, not paying a rider's petrol on the
   * customer's behalf. It goes through priceOrder as an order-level discount
   * so it is allocated across lines and taxed correctly.
   */
  const foodValue = add(...forPricing.map((line) => multiply(line.unitPrice, line.quantity)));

  let promotion: AppliedPromotion | null = null;
  let promotionError: string | null = null;

  if (cart.promoCode) {
    const found = org ? await findPromotion(org.id, cart.promoCode) : null;
    const result = applyPromotion({ promotion: found, orderValue: foodValue });
    if (result.ok) {
      promotion = { code: result.code, name: result.name, discount: result.discount };
    } else {
      promotionError = result.message;
    }
  }

  const totals = priceOrder({ lines: forPricing, orderDiscount: promotion?.discount }, context);

  /*
   * Points are tender, not a discount.
   *
   * Redeeming them is closer to handing over cash than to knocking money off a
   * price, so they come off what is payable rather than off the order value —
   * and they can pay for delivery, which a promotion cannot.
   */
  let points: AppliedPoints | null = null;

  if (customer && cart.points && cart.points > 0) {
    const config = await getLoyaltyConfig();
    const redemption = redeem({
      requestedPoints: cart.points,
      balance: customer.points,
      orderTotal: totals.gross,
      config,
    });
    if (redemption.points > 0) {
      points = { points: redemption.points, discount: redemption.discount, balance: customer.points };
    }
  }

  const payable = subtract(totals.gross, points?.discount ?? ZERO);

  return {
    lines: resolved.map((line, index) => ({ ...line, priced: totals.lines[index] ?? line.priced })),
    totals,
    itemCount: resolved.reduce((count, line) => count + line.quantity, 0),
    promotion,
    promotionError,
    points,
    stampReward,
    stampRewardError,
    payable,
    rejected,
  };
}

/** Reads and prices in one step. What pages actually call. */
export async function getPricedCart(): Promise<PricedCart> {
  return priceCart(await readCart());
}

export { type Cart, EMPTY_CART, lineKey };
