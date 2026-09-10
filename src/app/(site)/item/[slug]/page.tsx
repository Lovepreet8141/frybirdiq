import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Customizer } from "@/components/menu/customizer";
import { SpiceMark, VegMark } from "@/components/menu/marks";
import { Price } from "@/components/menu/price";
import { getAllProducts, getProduct } from "@/lib/repositories/menu";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) return { title: "Not found" };

  return {
    title: product.name,
    description: product.description ?? `${product.name} at FRYBIRD, Sector 9, Ambala City.`,
  };
}

export async function generateStaticParams() {
  const products = await getAllProducts();
  return products.map((product) => ({ slug: product.slug }));
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProduct(slug);
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

      <div className="mt-6 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <VegMark veg={product.veg} />
          <SpiceMark level={product.spice} />
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {product.categoryName}
          </span>
        </div>

        <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl">{product.name}</h1>

        {product.description && (
          <p className="max-w-prose text-lg leading-relaxed text-muted-foreground">{product.description}</p>
        )}

        <Price amount={product.price} className="text-2xl font-bold" />
      </div>

      {/*
        A photo slot lives here. It is left out rather than filled with stock
        imagery — the brand brief is explicit that stock chicken photos read as
        a template with a logo on it, and a confident typographic block is
        better than a wrong picture.
      */}

      <div className="mt-10 border-t border-border pt-10">
        <Customizer product={product} />
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        {product.taxRateBps > 0 ? "Price includes GST." : "Price is what you pay."}
      </p>
    </div>
  );
}
