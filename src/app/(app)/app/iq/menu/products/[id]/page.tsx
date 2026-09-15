import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getStaff, staffCan } from "@/lib/auth";
import { formatINR, paise } from "@/lib/money";
import {
  getProductAdmin,
  getRecipeDetail,
  inventoryAvailability,
  listAvailabilityRules,
  listCategoriesAdmin,
  listComboItems,
  listIngredientOptions,
  listModifierGroupsAdmin,
  listProductsAdmin,
  listTaxRates,
} from "@/lib/repositories/menu-admin";
import { listMedia } from "@/lib/repositories/media";
import type { MenuProduct } from "@/lib/repositories/menu";
import { resolveAvailability } from "@/domain/menu-availability";
import { businessDate } from "@/lib/dates";
import { ActionButton } from "@/components/iq/menu/action-button";
import { AvailabilityBadge } from "@/components/iq/menu/availability-badge";
import { ProductAvailabilityForm } from "@/components/iq/menu/product-availability-form";
import { ProductDetailsForm } from "@/components/iq/menu/product-details-form";
import { ProductMediaForm } from "@/components/iq/menu/product-media-form";
import { ProductModifiersForm } from "@/components/iq/menu/product-modifiers-form";
import { ProductPreview } from "@/components/iq/menu/product-preview";
import { ProductPriceForm } from "@/components/iq/menu/product-price-form";
import { ProductRecipeSection } from "@/components/iq/menu/product-recipe-section";
import { duplicateProductAction, publishProductAction, setProductActiveAction } from "@/lib/menu-admin/actions";

export const metadata: Metadata = { title: "Edit product — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="font-heading text-lg font-bold">{title}</h2>
      {hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("menu.view"))) redirect("/app/iq/menu");

  const canPrice = await staffCan("menu.price");
  const canPublish = await staffCan("menu.publish");
  const canViewRecipe = await staffCan("recipes.view");
  const canEditRecipe = await staffCan("recipes.edit");

  const { id } = await params;
  const product = await getProductAdmin(staff.orgId, id);
  if (!product) notFound();

  const [categories, taxRates, groups, rules, library, comboContents] = await Promise.all([
    listCategoriesAdmin(staff.orgId),
    listTaxRates(staff.orgId),
    listModifierGroupsAdmin(staff.orgId),
    listAvailabilityRules(staff.orgId, id),
    listMedia(staff.orgId),
    product.isCombo ? listComboItems(staff.orgId, id) : Promise.resolve([]),
  ]);

  // Not fetched at all for someone without recipes.view — no data to leak, and
  // no query to run for a screen that would only tell them "no permission".
  const [recipeDetail, ingredientOptions, stockRisk] = canViewRecipe
    ? await Promise.all([getRecipeDetail(staff.orgId, id), listIngredientOptions(staff.orgId), inventoryAvailability(staff.orgId, id)])
    : [null, [], null];

  const category = categories.find((c) => c.id === product.categoryId);
  const taxRate = taxRates.find((r) => r.id === product.taxRateId);
  const assignedGroups = groups.filter((g) => product.modifierGroupIds.includes(g.id));

  const today = businessDate();
  const resolvedAvailability = resolveAvailability(
    rules.map((r) => ({ locationId: null, channel: null, status: r.status, unavailableUntil: r.unavailableUntil, reason: r.reason, setOnBusinessDate: businessDate(r.updatedAt) })),
    { locationId: null, channel: null, now: new Date(), today },
  );

  const allProducts = product.isCombo ? await listProductsAdmin(staff.orgId) : [];
  const comboItemsWithPrice = comboContents.map((item) => ({ ...item, price: allProducts.find((p) => p.id === item.productId)?.basePrice ?? 0n }));
  const comboItemsTotal = comboItemsWithPrice.reduce((sum, item) => sum + item.price * BigInt(item.quantity), 0n);
  const comboSavings = comboItemsTotal - product.basePrice;

  const previewProduct: MenuProduct = {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    price: product.basePrice,
    veg: product.isVegetarian ? "VEG" : "NON_VEG",
    spice: product.spiceLevel,
    categorySlug: category?.slug ?? "",
    categoryName: category?.name ?? "Uncategorised",
    taxRateBps: taxRate?.rateBps ?? 500,
    hsnCode: taxRate?.hsnCode ?? null,
    image: product.images[0] ? { url: product.images[0].url, alt: product.images[0].alt } : null,
    modifierGroups: assignedGroups.map((g) => ({
      slug: g.slug,
      name: g.name,
      minSelections: g.minSelections,
      maxSelections: g.maxSelections,
      modifiers: g.modifiers.map((m) => ({ slug: m.slug, name: m.name, priceDelta: m.priceDelta, isDefault: m.isDefault })),
    })),
    sku: product.sku,
    prepMinutes: product.prepMinutes,
    kdsStation: product.kdsStation,
    badges: product.tags,
    availability: { status: "AVAILABLE", available: true, reason: null, until: null },
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-[var(--gutter)] py-8">
      <Link href="/app/iq/menu" className="text-sm text-muted-foreground underline underline-offset-2">
        ← Menu Control Center
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">{product.name}</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <AvailabilityBadge status={resolvedAvailability.status} isActive={product.isActive} />
            {product.status === "DRAFT" ? "Draft — not visible yet." : "Live."}
            {resolvedAvailability.reason && ` — ${resolvedAvailability.reason}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {product.status === "DRAFT" && canPublish && (
            <ActionButton action={publishProductAction.bind(null, id)}>Publish</ActionButton>
          )}
          <ActionButton action={duplicateProductAction.bind(null, id)} variant="ghost">
            Duplicate
          </ActionButton>
          <ActionButton action={setProductActiveAction.bind(null, id, !product.isActive)} variant="ghost">
            {product.isActive ? "Archive" : "Restore"}
          </ActionButton>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-4">
        <Section title="Preview" hint="Exactly what the website and the counter will show.">
          <ProductPreview product={previewProduct} />
        </Section>

        <Section title="Details">
          <ProductDetailsForm
            id={id}
            categories={categories.map((c) => ({ id: c.id, name: c.name }))}
            taxRates={taxRates}
            initial={{
              name: product.name,
              slug: product.slug,
              description: product.description,
              shortDescription: product.shortDescription,
              categoryId: product.categoryId,
              taxRateId: product.taxRateId,
              spiceLevel: product.spiceLevel,
              isVegetarian: product.isVegetarian,
              allergens: product.allergens,
              tags: product.tags,
              sku: product.sku,
              prepMinutes: product.prepMinutes,
              kdsStation: product.kdsStation,
              servingInfo: product.servingInfo,
              productType: product.productType,
              updatedAt: product.updatedAt,
            }}
          />
        </Section>

        <Section title="Pricing" hint={canPrice ? undefined : "Only an owner or admin can change the price."}>
          {canPrice ? <ProductPriceForm id={id} basePrice={product.basePrice} updatedAt={product.updatedAt} /> : (
            <p className="tabular text-lg font-bold">{formatINR(product.basePrice)}</p>
          )}
        </Section>

        <Section title="Modifiers" hint="Which option groups this product offers, and in what order.">
          <ProductModifiersForm productId={id} groups={groups.map((g) => ({ id: g.id, name: g.name, slug: g.slug, status: g.status }))} initialSelected={product.modifierGroupIds} />
        </Section>

        {product.isCombo && (
          <Section title="Combo contents" hint="Fixed items this combo bundles. &quot;Choose one&quot;/&quot;choose any&quot; components live in Modifiers above — a combo upgrade is just a modifier group, the same mechanism every product uses.">
            {comboItemsWithPrice.length === 0 ? (
              <p className="text-sm text-muted-foreground">No fixed items yet.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {comboItemsWithPrice.map((item) => {
                  const itemProduct = allProducts.find((p) => p.id === item.productId);
                  return (
                    <li key={item.id} className="flex items-center justify-between">
                      <span>
                        {item.quantity}× {itemProduct?.name ?? "Unknown product"}
                      </span>
                      <span className="tabular text-muted-foreground">{formatINR(paise(item.price * BigInt(item.quantity)))}</span>
                    </li>
                  );
                })}
                <li className="flex items-center justify-between border-t border-border pt-1.5 font-semibold">
                  <span>Items priced separately</span>
                  <span className="tabular">{formatINR(paise(comboItemsTotal))}</span>
                </li>
                <li className="flex items-center justify-between font-semibold text-[var(--success)]">
                  <span>Combo saves</span>
                  <span className="tabular">{comboSavings > 0n ? formatINR(paise(comboSavings)) : "No savings — check the combo's price"}</span>
                </li>
              </ul>
            )}
            <Link href={`/app/iq/menu/combos/${id}`} className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">
              Edit combo items →
            </Link>
          </Section>
        )}

        <Section title="Media">
          <ProductMediaForm productId={id} initialImages={product.images} library={library} />
        </Section>

        <Section title="Availability" hint="Off everywhere, or only on one channel — the counter and the website both read this.">
          <ProductAvailabilityForm
            productId={id}
            rules={rules.map((r) => ({ id: r.id, channel: r.channel, status: r.status, unavailableUntil: r.unavailableUntil, reason: r.reason }))}
          />
        </Section>

        <Section title="Recipe" hint="What this product is made of, and what it costs to make.">
          {stockRisk && (stockRisk.status === "at_risk" || stockRisk.status === "stockout_today") && (
            <p role="status" className={`mb-4 rounded-md border-l-2 px-4 py-3 text-sm ${stockRisk.status === "stockout_today" ? "border-loss bg-loss-soft/60" : "border-flag bg-flag-soft/60"}`}>
              <strong className="font-semibold">Smart 86 (advisory):</strong>{" "}
              {stockRisk.status === "stockout_today"
                ? stockRisk.alreadyOut
                  ? `${stockRisk.limitingIngredientName} is out now — this product can't be made until it's restocked.`
                  : `${stockRisk.limitingIngredientName} is projected short around ${stockRisk.stockoutInstant?.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false })} today at the current pace.`
                : `${stockRisk.limitingIngredientName} is trending low${stockRisk.daysOfCover !== null ? ` — about ${stockRisk.daysOfCover.toFixed(1)} days of cover left` : ""}.`}
              {stockRisk.portionsPossible !== null && ` ~${stockRisk.portionsPossible} portions possible from it right now.`} This is a recommendation, not a change — availability below is still set by hand.
            </p>
          )}
          <ProductRecipeSection
            productId={id}
            access={!canViewRecipe ? "none" : canEditRecipe ? "edit" : "view"}
            recipe={
              recipeDetail ?? {
                linked: false,
                yieldQuantity: 1,
                version: null,
                lines: [],
                theoreticalCost: null,
                costPerPortion: null,
              }
            }
            ingredientOptions={ingredientOptions.map((option) => ({
              id: option.id,
              name: option.name,
              baseUnit: option.baseUnit,
              costPerBaseUnitMilli: option.costPerBaseUnitMilli,
              isPackaging: option.isPackaging,
              isActive: option.isActive,
            }))}
          />
        </Section>
      </div>
    </div>
  );
}
