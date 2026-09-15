import { NextResponse } from "next/server";
import { getMenu } from "@/lib/repositories/menu";

export const dynamic = "force-dynamic";

/**
 * The published, customer-visible menu, as JSON. Server-side-consumer only
 * — for frybird.in (a separate deployment, separate codebase) to read real
 * products/prices/availability instead of carrying its own copy.
 *
 * This is a thin, read-only view over `getMenu("ONLINE")` — the exact
 * function `/menu` and the homepage already call. It computes nothing:
 * no pricing, no tax, no availability logic lives here, so there is no
 * second source of truth to drift from the real one. Menu Control Center
 * and this org's single Supabase project remain authoritative; this route
 * only serializes what they already resolved.
 *
 * Deliberately excludes anything not needed to *display* a menu: modifier
 * groups/customization (the marketing site sends "Order now" to the real
 * ordering flow rather than building a second cart), SKU, prep time, KDS
 * station, HSN code, tax rate — none of that is a customer-facing fact and
 * none of it belongs in a response meant to be fetched from outside this
 * app. No recipe, cost, inventory, supplier, customer or admin data is
 * reachable through `getMenu` in the first place.
 *
 * No auth: this is public menu information, the same facts already
 * rendered into the public `/menu` page's HTML. Meant to be fetched
 * server-side by the consumer (not from a browser — there is no CORS
 * header here on purpose), the same way any third party would read a
 * restaurant's published menu.
 */
export async function GET() {
  const menu = await getMenu("ONLINE");

  const categories = menu.map((category) => ({
    slug: category.slug,
    name: category.name,
  }));

  const products = menu.flatMap((category) =>
    category.products.map((product) => ({
      slug: product.slug,
      name: product.name,
      description: product.description,
      /** Integer paise, GST-inclusive — the same figure the checkout charges. Display only; never recompute. */
      price: Number(product.price),
      veg: product.veg,
      spice: product.spice,
      categorySlug: product.categorySlug,
      image: product.image,
      badges: product.badges,
      /** The authoritative availability engine's answer, resolved for the website channel today. */
      available: product.availability.available,
    })),
  );

  return NextResponse.json(
    { categories, products },
    {
      headers: {
        // Short, safe cache: a menu edit in Menu Control Center should not
        // take more than a minute or two to reach a site that reads this.
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}
