"use client";

/**
 * The POS shell: categories, the product grid, and the order being built.
 *
 * State lives here and nowhere touches a price. `lines` holds only what was
 * tapped — a slug, a quantity, modifier slugs — and every change reprices
 * the whole draft through `priceDraftOrder`, which recomputes on the server
 * from the same menu the grid reads. §13.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { OrderChannel } from "@/domain/order-channel";
import { lineKey } from "@/lib/cart/schema";
import { type PriceDraftOk, pollPosMenu, priceDraftOrder } from "@/lib/pos/actions";
import type { MenuCategory, MenuProduct } from "@/lib/repositories/menu";
import { CategoryRail } from "./category-rail";
import { CustomerLookup } from "./customer-lookup";
import { ModifierPicker } from "./modifier-picker";
import { OrderBuilder } from "./order-builder";
import { ProductGrid } from "./product-grid";
import { useOnline } from "./use-online";

interface DraftLine {
  readonly key: string;
  readonly slug: string;
  readonly name: string;
  readonly quantity: number;
  readonly modifierSlugs: readonly string[];
  readonly modifierNames: readonly string[];
}

const PRICE_DEBOUNCE_MS = 200;
/**
 * Not urgent the way a new order is — a price or an 86 from the Menu
 * Manager reaching the counter within half a minute is plenty, and anything
 * shorter is unnecessary load on a screen that stays open for a whole
 * shift.
 */
const MENU_POLL_MS = 25_000;

export function PosShell({ categories: initialCategories, canLookupCustomers }: { categories: readonly MenuCategory[]; canLookupCustomers: boolean }) {
  const [categories, setCategories] = useState<readonly MenuCategory[]>(initialCategories);
  const [activeCategory, setActiveCategory] = useState<string | null>(initialCategories[0]?.slug ?? null);
  const [channel, setChannel] = useState<OrderChannel | null>(null);
  const [lines, setLines] = useState<readonly DraftLine[]>([]);
  const [pickerProduct, setPickerProduct] = useState<MenuProduct | null>(null);
  const [search, setSearch] = useState("");

  const [priced, setPriced] = useState<PriceDraftOk | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [isPricing, startPricing] = useTransition();

  const online = useOnline();

  // Refresh the grid against the same shared menu path everything else
  // reads (§ pollPosMenu) — a price change, a photo, or someone marking an
  // item sold out from the Menu Manager reaches this screen without anyone
  // reloading the tab. Never touches `lines` or the priced draft: an order
  // already being built keeps whatever it was quoted until the counter taps
  // something new, exactly like every other price in this app.
  useEffect(() => {
    if (!online) return;
    let stopped = false;

    const tick = async () => {
      const result = await pollPosMenu(channel);
      if (stopped || !result.ok) return;
      setCategories(result.categories);
    };

    const timer = setInterval(() => void tick(), MENU_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [online, channel]);

  // If the category picked before a refresh no longer exists (renamed,
  // unpublished), fall back to the first still-available one rather than
  // silently showing an empty grid under a stale label — derived, not
  // synced via an effect, so a menu refresh can never cause an extra render
  // pass just to correct the selection.
  const resolvedActiveCategory = activeCategory && categories.some((c) => c.slug === activeCategory) ? activeCategory : (categories[0]?.slug ?? null);

  const bySlug = useMemo(
    () => new Map(categories.flatMap((category) => category.products).map((product) => [product.slug, product])),
    [categories],
  );

  const normalisedSearch = search.trim().toLowerCase();
  const allProducts = useMemo(() => categories.flatMap((category) => category.products), [categories]);
  const activeProducts =
    normalisedSearch !== ""
      ? allProducts.filter((product) => product.name.toLowerCase().includes(normalisedSearch) || (product.sku ?? "").toLowerCase().includes(normalisedSearch))
      : (categories.find((category) => category.slug === resolvedActiveCategory)?.products ?? []);

  const quantities = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of lines) map.set(line.slug, (map.get(line.slug) ?? 0) + line.quantity);
    return map;
  }, [lines]);

  /** Ignores a response that arrives after a newer edit has already fired. */
  const requestId = useRef(0);

  function reprice() {
    const id = ++requestId.current;
    startPricing(async () => {
      const result = await priceDraftOrder({
        lines: lines.map((line) => ({ slug: line.slug, quantity: line.quantity, modifiers: [...line.modifierSlugs] })),
        channel,
      });
      if (id !== requestId.current) return;
      if (result.ok) {
        setPriced(result);
        setPricingError(null);
      } else {
        setPricingError(result.error);
      }
    });
  }

  // Debounced so a burst of taps or quantity clicks sends one request, not
  // one per tap. Going back to zero lines is handled where it happens —
  // `removeLine` and `changeQuantity` below — not reactively here, so
  // clearing the stale total is a direct response to the tap rather than a
  // second render chasing the first.
  useEffect(() => {
    if (lines.length === 0 || !online) return;
    const timer = setTimeout(reprice, PRICE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, online, channel]);

  function addLine(input: { slug: string; quantity: number; modifierSlugs: readonly string[] }) {
    const product = bySlug.get(input.slug);
    if (!product) return;

    const key = lineKey({ slug: input.slug, modifiers: [...input.modifierSlugs] });
    const modifierNames = product.modifierGroups
      .flatMap((group) => group.modifiers)
      .filter((modifier) => input.modifierSlugs.includes(modifier.slug))
      .map((modifier) => modifier.name);

    setLines((current) => {
      const existing = current.find((line) => line.key === key);
      if (existing) {
        return current.map((line) =>
          line.key === key ? { ...line, quantity: Math.min(line.quantity + input.quantity, 50) } : line,
        );
      }
      return [
        ...current,
        {
          key,
          slug: input.slug,
          name: product.name,
          quantity: input.quantity,
          modifierSlugs: input.modifierSlugs,
          modifierNames,
        },
      ];
    });
  }

  function handleTap(product: MenuProduct) {
    if (!online || channel === null || !product.availability.available) return;
    if (product.modifierGroups.length > 0) {
      setPickerProduct(product);
      return;
    }
    addLine({ slug: product.slug, quantity: 1, modifierSlugs: [] });
  }

  /**
   * Drops the priced total the instant the draft empties, rather than
   * leaving the last order's figure on screen until the next reprice
   * catches up — done here, as a direct response to the tap that emptied it,
   * not in an effect reacting to the result.
   */
  function clearPricingIfEmpty(next: readonly DraftLine[]) {
    if (next.length > 0) return;
    requestId.current += 1;
    setPriced(null);
    setPricingError(null);
  }

  function changeQuantity(key: string, quantity: number) {
    const next =
      quantity <= 0
        ? lines.filter((line) => line.key !== key)
        : lines.map((line) => (line.key === key ? { ...line, quantity: Math.min(quantity, 50) } : line));
    setLines(next);
    clearPricingIfEmpty(next);
  }

  function removeLine(key: string) {
    const next = lines.filter((line) => line.key !== key);
    setLines(next);
    clearPricingIfEmpty(next);
  }

  const gridDisabled = !online || channel === null;
  const disabledReason = !online
    ? "You're offline. New items can't be priced until connection returns."
    : channel === null
      ? "Choose dine-in or takeaway before adding items."
      : undefined;

  return (
    <div className="grid grid-cols-1 lg:h-[calc(100dvh-68px)] lg:grid-cols-[220px_1fr_400px]">
      <div className="hidden lg:block">
        <CategoryRail
          categories={categories.map((category) => ({
            slug: category.slug,
            name: category.name,
            count: category.products.length,
          }))}
          active={resolvedActiveCategory}
          onSelect={setActiveCategory}
        />
      </div>

      {/* Below the rail's breakpoint, a select does the same job in far less
          height — a sideways-scrolling rail is easy to miss on a narrow
          screen, and this is a fallback, not the target device. */}
      <div className="border-b border-border bg-surface p-2 lg:hidden">
        <label htmlFor="pos-category" className="sr-only">
          Category
        </label>
        <select
          id="pos-category"
          value={resolvedActiveCategory ?? ""}
          onChange={(event) => setActiveCategory(event.target.value)}
          className="h-[44px] w-full rounded-md border border-border bg-background px-3 text-sm font-semibold"
        >
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name} ({category.products.length})
            </option>
          ))}
        </select>
      </div>

      <ProductGrid
        products={activeProducts}
        quantities={quantities}
        disabled={gridDisabled}
        disabledReason={disabledReason}
        search={search}
        onSearchChange={setSearch}
        onTap={handleTap}
      />

      <div className="flex h-full min-h-0 flex-col">
        {canLookupCustomers && <CustomerLookup />}
        <div className="min-h-0 flex-1">
          <OrderBuilder
            channel={channel}
            onChannelChange={setChannel}
            lines={lines}
            onQuantityChange={changeQuantity}
            onRemove={removeLine}
            priced={priced}
            isPricing={isPricing}
            pricingError={pricingError}
            onRetry={reprice}
            online={online}
          />
        </div>
      </div>

      <ModifierPicker product={pickerProduct} onClose={() => setPickerProduct(null)} onAdd={addLine} />
    </div>
  );
}
