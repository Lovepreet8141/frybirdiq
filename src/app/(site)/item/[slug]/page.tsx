import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Customizer } from "@/components/menu/customizer";
import { SpiceMark, VegMark } from "@/components/menu/marks";
import { Price } from "@/components/menu/price";
import { ShopClosedNotice } from "@/components/site/shop-closed-notice";
import { getProductCached } from "@/lib/repositories/menu-cache";
import { absoluteUrl } from "@/lib/seo/site";
import { getOrg } from "@/lib/repositories/org";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductCached(slug, "ONLINE");
  if (!product) return { title: "Not found", robots: { index: false } };

  const description = product.description ?? `${product.name} at FRYBIRD, Sector 9, Ambala City.`;
  // The item's own photo when it has one; otherwise the site-wide share image
  // (app/opengraph-image) is inherited.
  const images = product.image ? [{ url: product.image.url.startsWith("http") ? product.image.url : absoluteUrl(product.image.url), alt: product.image.alt }] : undefined;
  return {
    title: product.name,
    description,
    alternates: { canonical: `/item/${product.slug}` },
    openGraph: { type: "website", siteName: "FRYBIRD", locale: "en_IN", title: `${product.name} · FRYBIRD`, description, url: absoluteUrl(`/item/${product.slug}`), ...(images ? { images } : {}) },
    twitter: { card: images ? "summary_large_image" : "summary", title: `${product.name} · FRYBIRD`, description, ...(images ? { images: images.map((image) => image.url) } : {}) },
  };
}

/**
 * No `generateStaticParams` here. Investigation into a "Menu Manager edit
 * didn't reach the website" report (see that report for the full trace)
 * confirmed this route already builds and serves fully dynamic — a
 * `generateStaticParams` that was here previously produced zero static
 * routes (`prerender-manifest.json` showed 0 entries for `/item/*`, and the
 * production build output marked this route "ƒ Dynamic", not static) — so
 * it had no effect and only implied a caching behaviour this route doesn't
 * actually have. Requests read the menu through `getProductCached` (a 45 s copy,
 * cleared by `revalidateMenuSurfaces()` on every menu mutation) so a crowd
 * on one item does not hit the database each time; the route stays dynamic.
 */
export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [product, org] = await Promise.all([getProductCached(slug, "ONLINE"), getOrg()]);
  if (!product) notFound();

  return (
    <div className="mx-auto w-full max-w-3xl px-[var(--gutter)] py-10 sm:py-14">
      <Link
        href="/menu"
        className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Menu
      </Link>

      {/*
        The photograph, which this page was missing entirely — the menu showed
        the food and then the page you open to actually order it showed none.
        It leads, because on a phone it is the whole first screen and it is what
        the decision is made on.
      */}
      {product.image && (
        <div className="mt-6 flex items-center justify-center rounded-2xl border-[2.5px] border-[var(--ink)] bg-[var(--cream-hi)] p-4 shadow-[6px_6px_0_var(--red)]">
          <Image
            src={product.image.url}
            alt={product.image.alt}
            width={640}
            height={640}
            priority
            sizes="(min-width: 768px) 40rem, 92vw"
            className="h-[clamp(180px,48vw,300px)] w-auto object-contain drop-shadow-[0_18px_18px_rgba(44,33,27,0.22)]"
          />
        </div>
      )}

      <div className="mt-6 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <VegMark veg={product.veg} />
          <SpiceMark level={product.spice} />
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {product.categoryName}
          </span>
        </div>

        <h1 className="font-heading text-3xl font-black tracking-tight sm:text-5xl">{product.name}</h1>

        {org && <ShopClosedNotice openingTime={org.openingTime} closingTime={org.closingTime} />}

        {product.description && (
          <p className="max-w-prose text-lg leading-relaxed text-muted-foreground">{product.description}</p>
        )}

        <Price amount={product.price} className="font-heading text-2xl font-black text-primary" />
      </div>

      <div className="mt-10 border-t border-border pt-10">
        <Customizer product={product} />
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        {product.taxRateBps > 0 ? "Price includes GST." : "Price is what you pay."}
      </p>
    </div>
  );
}
