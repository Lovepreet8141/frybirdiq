import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getStaff, staffCan } from "@/lib/auth";
import { formatINR } from "@/lib/money";
import {
  getProductAdmin,
  getRecipeStatus,
  listAvailabilityRules,
  listCategoriesAdmin,
  listModifierGroupsAdmin,
  listTaxRates,
} from "@/lib/repositories/menu-admin";
import { listMedia } from "@/lib/repositories/media";
import type { MenuProduct } from "@/lib/repositories/menu";
import { ActionButton } from "@/components/iq/menu/action-button";
import { ProductAvailabilityForm } from "@/components/iq/menu/product-availability-form";
import { ProductDetailsForm } from "@/components/iq/menu/product-details-form";
import { ProductMediaForm } from "@/components/iq/menu/product-media-form";
import { ProductModifiersForm } from "@/components/iq/menu/product-modifiers-form";
import { ProductPreview } from "@/components/iq/menu/product-preview";
import { ProductPriceForm } from "@/components/iq/menu/product-price-form";
import { ProductRecipeSection } from "@/components/iq/menu/product-recipe-section";
import { publishProductAction, setProductActiveAction } from "@/lib/menu-admin/actions";

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

  const { id } = await params;
  const product = await getProductAdmin(staff.orgId, id);
  if (!product) notFound();

  const [categories, taxRates, groups, rules, library, recipeStatus] = await Promise.all([
    listCategoriesAdmin(staff.orgId),
    listTaxRates(staff.orgId),
    listModifierGroupsAdmin(staff.orgId),
    listAvailabilityRules(staff.orgId, id),
    listMedia(staff.orgId),
    getRecipeStatus(staff.orgId, id),
  ]);

  const category = categories.find((c) => c.id === product.categoryId);
  const taxRate = taxRates.find((r) => r.id === product.taxRateId);
  const assignedGroups = groups.filter((g) => product.modifierGroupIds.includes(g.id));

  const previewProduct: MenuProduct = {
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
      modifiers: g.modifiers.map((m) => ({ slug: m.slug, name: m.name, priceDelta: m.priceDelta, isDefault: false })),
    })),
    sku: product.sku,
    prepMinutes: product.prepMinutes,
    kdsStation: product.kdsStation,
    badges: product.tags,
    availability: { status: "AVAILABLE", available: true, reason: null, until: null },
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-[var(--gutter)] py-8">
      <Link href="/app/iq/menu/products" className="text-sm text-muted-foreground underline underline-offset-2">
        ← Products
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">{product.name}</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            {product.status === "DRAFT" ? "Draft — not visible yet." : "Live."}
            {!product.isActive && " Archived."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {product.status === "DRAFT" && canPublish && (
            <ActionButton action={() => publishProductAction(id)}>Publish</ActionButton>
          )}
          <ActionButton action={() => setProductActiveAction(id, !product.isActive)} variant="ghost">
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
            }}
          />
        </Section>

        <Section title="Pricing" hint={canPrice ? undefined : "Only an owner or admin can change the price."}>
          {canPrice ? <ProductPriceForm id={id} basePrice={product.basePrice} /> : (
            <p className="tabular text-lg font-bold">{formatINR(product.basePrice)}</p>
          )}
        </Section>

        <Section title="Modifiers" hint="Which option groups this product offers, and in what order.">
          <ProductModifiersForm productId={id} groups={groups.map((g) => ({ id: g.id, name: g.name, status: g.status }))} initialSelected={product.modifierGroupIds} />
        </Section>

        <Section title="Media">
          <ProductMediaForm productId={id} initialImages={product.images} library={library} />
        </Section>

        <Section title="Availability" hint="Off everywhere, or only on one channel — the counter and the website both read this.">
          <ProductAvailabilityForm
            productId={id}
            rules={rules.map((r) => ({ id: r.id, channel: r.channel, status: r.status, unavailableUntil: r.unavailableUntil, reason: r.reason }))}
          />
        </Section>

        <Section title="Recipe" hint="Links this product to its ingredients, for costing and — later — stock-aware availability.">
          <ProductRecipeSection productId={id} status={recipeStatus} />
        </Section>
      </div>
    </div>
  );
}
