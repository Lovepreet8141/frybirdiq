import "server-only";

/**
 * A short-lived copy of the public menu, for the pages a crowd reads.
 *
 * The menu is read on every home, /menu and item view and never changes
 * faster than a person edits it, so 45 seconds of reuse cuts most database
 * reads without anyone noticing. Deliberately NOT used by cart pricing,
 * checkout or the POS: those keep calling `getMenu` directly and see the
 * database, so money is never computed from this copy. Staleness here is a
 * card that still shows for up to 45 s; the cart re-checks availability
 * itself.
 *
 * In-process (a Map on globalThis, so every route bundle shares it) rather
 * than `unstable_cache`, because product prices are `bigint` paise and cannot
 * be serialised to that cache. A menu edit calls `clearMenuCache` (via
 * `revalidateMenuSurfaces`) so the same process shows it at once.
 */

import { getMenu, type MenuCategory, type MenuProduct } from "./menu";

export const MENU_CACHE_TTL_MS = 45_000;

type Entry = { at: number; value: Promise<readonly MenuCategory[]> };
const store = ((globalThis as { __frybirdMenuCache?: Map<string, Entry> }).__frybirdMenuCache ??= new Map<string, Entry>());

export async function getMenuCached(channel: string | null = null, now: number = Date.now()): Promise<readonly MenuCategory[]> {
  const key = channel ?? "";
  const hit = store.get(key);
  if (hit && now - hit.at < MENU_CACHE_TTL_MS) return hit.value;
  const value = getMenu(channel);
  store.set(key, { at: now, value });
  // A failed read must not be served for the next 45 seconds.
  value.catch(() => {
    if (store.get(key)?.value === value) store.delete(key);
  });
  return value;
}

export function clearMenuCache(): void {
  store.clear();
}

export async function getProductCached(slug: string, channel: string | null = null): Promise<MenuProduct | null> {
  for (const category of await getMenuCached(channel)) {
    const found = category.products.find((product) => product.slug === slug);
    if (found) return found;
  }
  return null;
}

export async function getAllProductsCached(channel: string | null = null): Promise<readonly MenuProduct[]> {
  return (await getMenuCached(channel)).flatMap((category) => category.products);
}
