import type { MetadataRoute } from "next";
import { getAllProductsCached } from "@/lib/repositories/menu-cache";
import { absoluteUrl } from "@/lib/seo/site";

/**
 * Public, indexable pages only: home, the menu and one page per orderable
 * item. Item URLs come from the same menu the site renders, so a product
 * added or removed shows up here without a code change. Never lists staff,
 * account, cart, checkout or order pages (those are disallowed in robots).
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let products: readonly { slug: string }[] = [];
  try {
    products = await getAllProductsCached("ONLINE");
  } catch {
    // The database being unreachable must not take the sitemap down: home and
    // /menu are still worth listing.
  }
  return [
    { url: absoluteUrl("/"), changeFrequency: "weekly", priority: 1 },
    { url: absoluteUrl("/menu"), changeFrequency: "daily", priority: 0.9 },
    ...products.map((product) => ({ url: absoluteUrl(`/item/${product.slug}`), changeFrequency: "weekly" as const, priority: 0.6 })),
  ];
}
