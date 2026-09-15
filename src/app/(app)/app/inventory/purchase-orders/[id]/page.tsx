import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Panel, PanelBody, PanelHeader } from "@/components/iq/ui";
import { PurchaseOrderDetailActions } from "@/components/inventory/purchase-order-detail-actions";
import { PageHeader } from "@/components/staff/page-header";
import { PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { unitLabel } from "@/lib/iq/units";
import { formatINR } from "@/lib/money";
import { PURCHASE_ORDER_STATUS_LABEL, getPurchaseOrder, type PurchaseOrderStatus } from "@/lib/repositories/purchase-orders";

export const metadata: Metadata = { title: "Purchase order", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const STATUS_BADGE_VARIANT: Record<PurchaseOrderStatus, "outline" | "info" | "success" | "destructive"> = {
  DRAFT: "outline",
  ORDERED: "info",
  RECEIVED: "success",
  CANCELLED: "destructive",
};

const dateTimeLabel = (date: Date | null) =>
  date ? date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

export default async function PurchaseOrderDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const [{ id }, { created }] = await Promise.all([params, searchParams]);
  const staff = await requireStaff();
  const [canView, canManage] = await Promise.all([staffCan("inventory.view"), staffCan("purchasing.manage")]);
  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view purchase orders" />
      </div>
    );
  }

  const order = await getPurchaseOrder(staff.orgId, id);
  if (!order) notFound();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title={order.supplierName}
        description={[order.reference, `${order.lines.length} ${order.lines.length === 1 ? "line" : "lines"}`].filter(Boolean).join(" · ")}
        actions={<Badge variant={STATUS_BADGE_VARIANT[order.status]}>{PURCHASE_ORDER_STATUS_LABEL[order.status]}</Badge>}
      />

      {created && (
        <p role="status" className="rounded-md border-l-2 border-gain bg-gain-soft/60 px-4 py-3 text-sm">
          Purchase order created as a draft. Send it once it&rsquo;s ready to go to the supplier.
        </p>
      )}

      <Panel>
        <PanelHeader title="Status" description="Draft → Ordered → Received. Receiving is the only step that moves stock or money." />
        <PanelBody>
          <PurchaseOrderDetailActions
            id={order.id}
            status={order.status}
            canManage={canManage}
            lines={order.lines.map((line) => ({ id: line.id, ingredientName: line.ingredientName, quantity: line.quantity, unit: line.unit }))}
          />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Lines" meta={formatINR(order.total)} />
        <PanelBody flush className="border-t border-border pb-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ingredient</TableHead>
                <TableHead className="text-right">Ordered</TableHead>
                <TableHead className="text-right">Unit cost</TableHead>
                <TableHead className="text-right">Line total</TableHead>
                <TableHead className="text-right">Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="font-medium">{line.ingredientName}</TableCell>
                  <TableCell className="tabular text-right">
                    {line.quantity} {unitLabel(line.unit)}
                  </TableCell>
                  <TableCell className="tabular text-right">{formatINR(line.unitCost)}</TableCell>
                  <TableCell className="tabular text-right font-semibold">{formatINR(line.lineTotal)}</TableCell>
                  <TableCell className="tabular text-right text-muted-foreground">
                    {line.receivedQuantity === null ? "—" : `${line.receivedQuantity} ${unitLabel(line.unit)}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Details" />
        <PanelBody>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="tabular">{formatINR(order.subtotal)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Tax</dt>
              <dd className="tabular">{formatINR(order.taxTotal)}</dd>
            </div>
            <div className="flex justify-between gap-4 font-semibold">
              <dt>Total</dt>
              <dd className="tabular">{formatINR(order.total)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Created</dt>
              <dd>{dateTimeLabel(order.createdAt)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Expected</dt>
              <dd>{dateTimeLabel(order.expectedAt)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Received</dt>
              <dd>{dateTimeLabel(order.receivedAt)}</dd>
            </div>
          </dl>
        </PanelBody>
      </Panel>
    </div>
  );
}
