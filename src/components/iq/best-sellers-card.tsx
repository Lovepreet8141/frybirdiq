import Image from "next/image";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface BestSeller {
  readonly key: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly quantity: number;
}

/**
 * The best sellers at a glance — adapted from the purchased
 * `product-list-card1` block (thumbnail, name, "units sold" per row). Its
 * green "units sold" text is muted here: green is reserved for status. Real
 * product photos where the catalogue has one, an initial where it doesn't.
 */
export function BestSellersCard({ title, description, products }: { title: string; description: string; products: readonly BestSeller[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {products.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Nothing sold in this period.</p>
        ) : (
          products.map((product) => (
            <div key={product.key} className="flex items-center justify-between gap-3 rounded-md border border-border p-1 pr-3">
              <div className="flex min-w-0 items-center gap-3">
                {product.imageUrl ? (
                  <Image src={product.imageUrl} alt="" width={40} height={40} sizes="40px" className="size-10 shrink-0 rounded-md object-cover" />
                ) : (
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-muted font-heading font-black text-muted-foreground" aria-hidden="true">
                    {product.name.charAt(0)}
                  </span>
                )}
                <span className="truncate text-sm font-medium">{product.name}</span>
              </div>
              <span className="tabular whitespace-nowrap text-sm text-muted-foreground">{product.quantity} sold</span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
