import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatINR } from "@/lib/money";
import { PURCHASE_ORDER_STATUS_LABEL, type PurchaseOrderRow, type PurchaseOrderStatus } from "@/lib/repositories/purchase-orders";

const STATUS_BADGE_VARIANT: Record<PurchaseOrderStatus, "outline" | "info" | "success" | "destructive"> = {
  DRAFT: "outline",
  ORDERED: "info",
  RECEIVED: "success",
  CANCELLED: "destructive",
};

const dateLabel = (date: Date | null) => (date ? date.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—");

/** A plain list — no client state needed, every row is a link to its own detail page where the real actions live. */
export function PurchaseOrdersTable({ orders }: { orders: readonly PurchaseOrderRow[] }) {
  if (orders.length === 0) {
    return <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No purchase orders yet.</p>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-panel">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Supplier</TableHead>
            <TableHead className="hidden sm:table-cell">Reference</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Lines</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="hidden md:table-cell">Expected</TableHead>
            <TableHead className="hidden lg:table-cell">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow key={order.id} className="cursor-pointer">
              <TableCell>
                <Link href={`/app/inventory/purchase-orders/${order.id}`} className="font-semibold hover:underline">
                  {order.supplierName}
                </Link>
              </TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">{order.reference ?? "—"}</TableCell>
              <TableCell>
                <Badge variant={STATUS_BADGE_VARIANT[order.status]}>{PURCHASE_ORDER_STATUS_LABEL[order.status]}</Badge>
              </TableCell>
              <TableCell className="tabular text-right">{order.itemCount}</TableCell>
              <TableCell className="tabular text-right font-semibold">{formatINR(order.total)}</TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">{dateLabel(order.expectedAt)}</TableCell>
              <TableCell className="hidden text-muted-foreground lg:table-cell">{dateLabel(order.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
