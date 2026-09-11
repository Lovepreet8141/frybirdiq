import type { MenuProduct } from "@/lib/repositories/menu";
import { ProductCard } from "@/components/menu/product-card";
import { ProductTile } from "@/components/pos/product-grid";

/**
 * Renders the product exactly as the website and the counter will — the
 * real `ProductCard` and the real POS `ProductTile`, not a re-implementation
 * that could drift from what customers and cashiers actually see.
 */
export function ProductPreview({ product }: { product: MenuProduct }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Website</p>
        <div className="max-w-[260px] [perspective:1000px]">
          <ProductCard product={product} />
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Counter (POS)</p>
        <div className="max-w-[200px]">
          <ProductTile product={product} quantity={0} disabled={false} />
        </div>
      </div>
    </div>
  );
}
