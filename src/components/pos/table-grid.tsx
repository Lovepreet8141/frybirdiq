"use client";

import { useState } from "react";
import { formatINR, paise } from "@/lib/money";
import type { TableRow, UnassignedDineInOrder } from "@/lib/repositories/tables";
import type { OrderView } from "@/lib/repositories/orders";
import { TableStatusBadge } from "@/components/pos/table-status-badge";
import { TableDetailDialog } from "@/components/pos/table-detail-dialog";
import { AssignOrderToTable } from "@/components/pos/assign-order-to-table";

/**
 * The floor plan: every active table as a card, open order (if any) surfaced
 * right on the card so a runner can read status without opening anything.
 *
 * `orderDetails` is pre-fetched server-side, keyed by order id — the grid
 * itself never fetches; opening a dialog is just picking the right entry
 * out of a map that's already in hand. An occupied card is a single button
 * that opens the detail dialog; an available one can't be — it hosts its
 * own "Seat an order" dialog trigger, and a button can't nest inside a
 * button — so it renders as a plain card instead.
 */
export function TableGrid({
  tables,
  orderDetails,
  unassignedOrders,
}: {
  tables: readonly TableRow[];
  orderDetails: ReadonlyMap<string, OrderView>;
  unassignedOrders: readonly UnassignedDineInOrder[];
}) {
  const [openTableId, setOpenTableId] = useState<string | null>(null);
  const openTable = tables.find((table) => table.id === openTableId) ?? null;

  if (tables.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium text-foreground">No tables yet</p>
        <p className="text-sm text-muted-foreground">Add the first one to start assigning dine-in orders.</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {tables.map((table) =>
          table.openOrder ? (
            <button
              key={table.id}
              type="button"
              onClick={() => setOpenTableId(table.id)}
              className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-foreground/20"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-foreground">{table.name}</span>
                <TableStatusBadge occupied />
              </div>
              {table.category && <span className="text-xs text-muted-foreground">{table.category}</span>}
              <div className="mt-1 flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">#{table.openOrder.orderNumber}</span>
                <span className="tabular font-medium">{formatINR(paise(table.openOrder.grandTotal), "whole")}</span>
              </div>
            </button>
          ) : (
            <div key={table.id} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-foreground">{table.name}</span>
                <TableStatusBadge occupied={false} />
              </div>
              {table.category && <span className="text-xs text-muted-foreground">{table.category}</span>}
              {table.capacity && <span className="text-sm text-muted-foreground">Seats {table.capacity}</span>}
              <div className="mt-1">
                <AssignOrderToTable tableId={table.id} tableName={table.name} orders={unassignedOrders} />
              </div>
            </div>
          ),
        )}
      </div>

      {openTable && (
        <TableDetailDialog
          open={openTableId !== null}
          onOpenChange={(open) => setOpenTableId(open ? openTable.id : null)}
          tableName={openTable.name}
          tableId={openTable.id}
          order={openTable.openOrder ? (orderDetails.get(openTable.openOrder.id) ?? null) : null}
        />
      )}
    </>
  );
}
