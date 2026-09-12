import type { OrderView } from "@/lib/repositories/orders";
import type { TableRow, UnassignedDineInOrder } from "@/lib/repositories/tables";
import { AddTableDialog } from "@/components/pos/add-table-dialog";
import { TableGrid } from "@/components/pos/table-grid";

export function TablesView({
  tables,
  orderDetails,
  unassignedOrders,
  canAddTable,
}: {
  tables: readonly TableRow[];
  orderDetails: ReadonlyMap<string, OrderView>;
  unassignedOrders: readonly UnassignedDineInOrder[];
  canAddTable: boolean;
}) {
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-semibold">Tables</h2>
        {canAddTable && <AddTableDialog />}
      </div>
      <TableGrid tables={tables} orderDetails={orderDetails} unassignedOrders={unassignedOrders} />
    </div>
  );
}
