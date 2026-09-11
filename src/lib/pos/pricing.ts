import "server-only";

/**
 * Prices an order being built at the counter.
 *
 * The counter equivalent of `src/lib/cart`'s `priceCart` — same menu
 * resolution, the same `priceOrder` pass — without the customer-site
 * concerns that do not exist here yet: there is no promo code, no points
 * redemption, and no FRYBIRD REWARDS stamp redemption, because the POS has
 * no customer lookup to attach an order to a loyalty account in the first
 * place (a separate, not-yet-built piece — see BUILD-PLAN.md's Phase 4
 * "customer lookup" item). Once that exists, this is the function that
 * would grow a `customerId` and call the same
 * `getAvailableStampReward`/`isRewardEligibleItem` pair `priceCart` already
 * uses — not a parallel implementation of the same rule.
 *
 * Kept as its own function rather than adding a "skip the customer bits"
 * flag to `priceCart`, which would be a second switch on top of the one
 * `src/lib/pricing` already owns.
 */

import { type CartLine, lineKey } from "@/lib/cart/schema";
import { type Paise, add } from "@/lib/money";
import { type PricedLine, type PricedOrder, priceOrder } from "@/lib/pricing";
import { type MenuModifier, type MenuProduct, getMenu, resolveLineModifiers } from "@/lib/repositories/menu";
import { resolvePricingContext } from "@/lib/repositories/org";

export interface PricedDraftLine {
  readonly key: string;
  readonly product: MenuProduct;
  readonly quantity: number;
  readonly modifiers: readonly MenuModifier[];
  /** Listed price of one unit including its modifiers. */
  readonly unitPrice: Paise;
  readonly priced: PricedLine;
}

export interface PricedDraft {
  readonly lines: readonly PricedDraftLine[];
  readonly totals: PricedOrder;
  readonly itemCount: number;
  /**
   * Lines that could not be honoured — a product pulled from the menu since
   * it was tapped, or a modifier that no longer exists. Surfaced rather than
   * silently dropped, the same as the customer cart.
   */
  readonly rejected: readonly { slug: string; reason: string }[];
}

/** Nothing on the counter yet. `channel` is null until the cashier picks dine-in or takeaway. */
export async function priceDraft(lines: readonly CartLine[], channel: string | null = null): Promise<PricedDraft> {
  const menu = await getMenu(channel);
  const bySlug = new Map(menu.flatMap((category) => category.products).map((product) => [product.slug, product]));
  const context = await resolvePricingContext();

  interface Pending {
    readonly key: string;
    readonly product: MenuProduct;
    readonly quantity: number;
    readonly modifiers: readonly MenuModifier[];
    readonly unitPrice: Paise;
  }

  const pending: Pending[] = [];
  const rejected: { slug: string; reason: string }[] = [];

  for (const line of lines) {
    const product = bySlug.get(line.slug);
    if (!product) {
      rejected.push({ slug: line.slug, reason: "No longer on the menu" });
      continue;
    }

    // Server-authoritative: a tile that looked orderable when the grid last
    // rendered can have been 86'd since. Reject here rather than trusting
    // that the tile was disabled — the same reasoning as resolveLineModifiers
    // not trusting the client's chosen modifiers. §41.
    if (!product.availability.available) {
      rejected.push({ slug: line.slug, reason: product.availability.reason ?? "Not available right now" });
      continue;
    }

    const { modifiers, error } = resolveLineModifiers(product, line.modifiers);
    if (error) {
      rejected.push({ slug: line.slug, reason: error });
      continue;
    }

    pending.push({
      key: lineKey(line),
      product,
      quantity: line.quantity,
      modifiers,
      unitPrice: add(product.price, ...modifiers.map((modifier) => modifier.priceDelta)),
    });
  }

  const totals = priceOrder(
    {
      lines: pending.map((line) => ({
        unitPrice: line.product.price,
        quantity: line.quantity,
        modifierDeltas: line.modifiers.map((modifier) => modifier.priceDelta),
        rateBps: line.product.taxRateBps,
      })),
    },
    context,
  );

  const resolved: PricedDraftLine[] = pending.map((line, index) => {
    const priced = totals.lines[index];
    if (!priced) throw new Error("pos: pricing produced a different number of lines than requested");
    return { ...line, priced };
  });

  return {
    lines: resolved,
    totals,
    itemCount: resolved.reduce((count, line) => count + line.quantity, 0),
    rejected,
  };
}
