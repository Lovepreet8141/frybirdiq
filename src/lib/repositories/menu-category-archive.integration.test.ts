/**
 * P0-5: archiving a category takes it — and every product in it — off sale
 * on every ordering surface.
 *
 * The defect this pins: the Menu Control Center's "Archive category" control
 * writes `categories.is_active = false`, writes an audit row and renders the
 * category as "Off", while `getMenu()` filtered `products.is_active` and both
 * `status` columns but never `categories.is_active`. The category and all its
 * products kept selling on the website, `/api/public/menu` and POS, with no
 * error and nothing the owner could discover.
 *
 * All three surfaces read the one function — website `getMenu("ONLINE")`
 * (`src/app/(site)/menu/page.tsx:31`), the public API's route handler (which
 * calls `getMenu("ONLINE")` and serialises it), and POS `getMenu()` with no
 * channel (`src/app/(app)/app/pos/page.tsx:41`) plus `getMenu("DINE_IN")` on
 * the 60s poll (`src/lib/pos/actions.ts:256`). So this asserts each surface as
 * that surface actually calls it, rather than asserting one call three times.
 *
 * Remove `eq(categories.isActive, true)` from `readFromDatabase` and every
 * "after archiving" expectation below fails.
 *
 * ## The fix closes more than the three surfaces asserted here
 *
 * Do not "add the missing surfaces" later — there are none, and doing it by
 * filtering per surface would recreate exactly the split this condition
 * removes. Everything downstream of `getMenu` inherits it: `/item/[slug]`
 * (`getProduct` → `getMenu`), the homepage (`getAllProducts`), and the
 * customer cart (`priceCart`, `src/lib/cart/index.ts:154`). A grep for
 * category reads outside `menu-admin` returns only the seed, so no ordering
 * surface reads categories a second way.
 *
 * The cart is the one behavioural consequence, and it is the money question
 * this fix raised: a line whose category is archived *mid-session* falls out
 * of `priceCart`'s slug map and is **rejected** with "No longer on the menu"
 * (`cart/index.ts:169-172`), not silently dropped. So archiving a category
 * cannot undercharge an in-flight cart.
 *
 * ## The transcription fallback is deliberately untouched
 *
 * `buildFromTranscription()` has no `isActive` concept, so an archived
 * category would still appear there. That is vacuous rather than a hole:
 * the branch runs only when Supabase is unconfigured, and with no database
 * there is nothing to have archived. Not a missing case — do not file it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, products } from "@/db/schema";
import { getMenu } from "./menu";
import { GET as publicMenuGET } from "@/app/api/public/menu/route";
import { ORG_SLUG } from "./org";
import { createTestOrg, createTestTaxRate, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

interface SeededCategory {
  readonly id: string;
  readonly slug: string;
  readonly productSlugs: readonly string[];
}

/**
 * A PUBLISHED, active category with two PUBLISHED, active products in it.
 * Built here rather than through `createTestProduct` because this test needs
 * the category id back in order to archive it, and because the whole point is
 * two products under one category — a per-product fixture cannot express that.
 */
async function seedCategory(org: TestOrg, taxRateId: string, name: string): Promise<SeededCategory> {
  const categorySlug = `cat-${randomUUID()}`;
  const [category] = await db()
    .insert(categories)
    .values({ orgId: org.orgId, name, slug: categorySlug, status: "PUBLISHED", isActive: true })
    .returning({ id: categories.id });
  if (!category) throw new Error("fixture: category insert returned no row");

  const productSlugs: string[] = [];
  for (const index of [1, 2]) {
    const slug = `prod-${randomUUID()}`;
    await db().insert(products).values({
      orgId: org.orgId,
      categoryId: category.id,
      name: `${name} item ${index}`,
      slug,
      basePrice: 9_900n,
      taxRateId,
      status: "PUBLISHED",
      isActive: true,
    });
    productSlugs.push(slug);
  }

  return { id: category.id, slug: categorySlug, productSlugs };
}

/**
 * Exactly what `setCategoryActive` writes when the owner archives a category
 * (`src/lib/repositories/menu-admin.ts:319`) — including `updatedAt`, which
 * nothing asserted here reads.
 *
 * It is mirrored anyway so this helper cannot quietly stop modelling the real
 * write: if a category read ever starts resolving by `updatedAt` the way
 * product availability does, a helper that set only `isActive` would keep
 * passing while the thing it stands in for had moved.
 */
async function archive(categoryId: string): Promise<void> {
  await db().update(categories).set({ isActive: false, updatedAt: new Date() }).where(eq(categories.id, categoryId));
}

describe("getMenu — an archived category is off sale on every surface (P0-5)", () => {
  let org: TestOrg;
  /** The category the owner archives. */
  let archived: SeededCategory;
  /** A second, untouched category — archiving one must not empty the menu. */
  let kept: SeededCategory;

  /** The website: `src/app/(site)/menu/page.tsx:31`. */
  const websiteSlugs = async () => flatten(await getMenu("ONLINE"));
  /** POS shell's first render passes no channel: `src/app/(app)/app/pos/page.tsx:41`. */
  const posSlugs = async () => flatten(await getMenu());
  /** POS's 60s poll, once the cashier has picked a channel: `src/lib/pos/actions.ts:256`. */
  const posDineInSlugs = async () => flatten(await getMenu("DINE_IN"));

  /** The public API, through its own route handler — the response frybird.in would read. */
  async function publicApi(): Promise<{ categories: string[]; products: string[] }> {
    const body = (await (await publicMenuGET()).json()) as {
      categories: readonly { slug: string }[];
      products: readonly { slug: string }[];
    };
    return { categories: body.categories.map((c) => c.slug), products: body.products.map((p) => p.slug) };
  }

  function flatten(menu: Awaited<ReturnType<typeof getMenu>>): { categories: string[]; products: string[] } {
    return {
      categories: menu.map((category) => category.slug),
      products: menu.flatMap((category) => category.products.map((product) => product.slug)),
    };
  }

  beforeAll(async () => {
    // `requireOrg()` resolves the acting org by the hardcoded slug, so the
    // fixture org has to carry it — see fixtures.ts on why that is safe here.
    org = await createTestOrg({ slug: ORG_SLUG });
    const taxRate = await createTestTaxRate(org.orgId);
    archived = await seedCategory(org, taxRate.id, "Combos");
    kept = await seedCategory(org, taxRate.id, "Burgers");
  });

  afterAll(async () => {
    await deleteTestOrg(org.orgId);
  });

  it("sells the category on all three surfaces while it is active", async () => {
    for (const read of [websiteSlugs, posSlugs, posDineInSlugs]) {
      const { categories: categorySlugs, products: productSlugs } = await read();
      expect(categorySlugs).toContain(archived.slug);
      expect(productSlugs).toEqual(expect.arrayContaining([...archived.productSlugs]));
    }

    const api = await publicApi();
    expect(api.categories).toContain(archived.slug);
    expect(api.products).toEqual(expect.arrayContaining([...archived.productSlugs]));
  });

  describe("after the owner archives it", () => {
    beforeAll(async () => {
      await archive(archived.id);
    });

    it("is absent from the website read", async () => {
      const { categories: categorySlugs, products: productSlugs } = await websiteSlugs();
      expect(categorySlugs).not.toContain(archived.slug);
      for (const slug of archived.productSlugs) expect(productSlugs).not.toContain(slug);
    });

    it("is absent from the public menu API read", async () => {
      const api = await publicApi();
      expect(api.categories).not.toContain(archived.slug);
      for (const slug of archived.productSlugs) expect(api.products).not.toContain(slug);
    });

    it("is absent from the POS read, with and without a channel", async () => {
      for (const read of [posSlugs, posDineInSlugs]) {
        const { categories: categorySlugs, products: productSlugs } = await read();
        expect(categorySlugs).not.toContain(archived.slug);
        for (const slug of archived.productSlugs) expect(productSlugs).not.toContain(slug);
      }
    });

    it("leaves every other category untouched", async () => {
      const { categories: categorySlugs, products: productSlugs } = await websiteSlugs();
      expect(categorySlugs).toContain(kept.slug);
      expect(productSlugs).toEqual(expect.arrayContaining([...kept.productSlugs]));
    });
  });
});
