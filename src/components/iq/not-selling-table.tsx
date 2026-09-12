import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type Paise, formatINR } from "@/lib/money";

export interface SellingGapRow {
  readonly slug: string;
  readonly name: string;
  readonly price: Paise;
}

/**
 * The other half of "what's selling" — matched by product ID upstream, not
 * name, so a rename never shows as a false gap. No sorting: six rows of one
 * real fact each, nothing to reorder by.
 */
export function NotSellingTable({ products }: { products: readonly SellingGapRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Product</TableHead>
          <TableHead className="text-right">Price</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {products.map((product) => (
          <TableRow key={product.slug}>
            <TableCell className="min-w-0 truncate">{product.name}</TableCell>
            <TableCell className="tabular text-right text-muted-foreground">{formatINR(product.price, "whole")}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
