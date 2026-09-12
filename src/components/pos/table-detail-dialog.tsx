"use client";

import { useTransition } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatINR, paise } from "@/lib/money";
import { clearTableAction } from "@/lib/pos/table-actions";
import type { OrderView } from "@/lib/repositories/orders";

/**
 * What's on this table right now, and a way to clear it.
 *
 * `order` is fetched server-side (`getOrder`, the same repository function
 * the order-detail screen already uses) and passed in whole — no client-side
 * fetch-on-open, since a QSR's table count is small enough that fetching
 * every occupied table's order up front is cheaper than a second round trip
 * per dialog open.
 */
export function TableDetailDialog({
  open,
  onOpenChange,
  tableName,
  tableId,
  order,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableName: string;
  tableId: string;
  order: OrderView | null;
}) {
  const [isClearing, startClearing] = useTransition();

  function handleClear() {
    startClearing(async () => {
      const result = await clearTableAction(tableId);
      if (result.ok) onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tableName}</DialogTitle>
          {order ? (
            <DialogDescription>Order #{order.orderNumber}</DialogDescription>
          ) : (
            <DialogDescription>Nothing here right now.</DialogDescription>
          )}
        </DialogHeader>

        {order && (
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-2 text-sm">
              {order.items.map((item, index) => (
                <li key={index} className="flex items-baseline justify-between gap-4">
                  <span className="min-w-0">
                    <span className="tabular">{item.quantity}×</span> {item.name}
                    {item.modifiers.length > 0 && (
                      <span className="block text-xs text-muted-foreground">{item.modifiers.join(", ")}</span>
                    )}
                  </span>
                  <span className="tabular shrink-0 font-medium">{formatINR(paise(item.total), "whole")}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-baseline justify-between border-t border-border pt-3 text-sm font-semibold">
              <span>Total</span>
              <span className="tabular">{formatINR(paise(order.grandTotal), "whole")}</span>
            </div>
          </div>
        )}

        {order && (
          <DialogFooter>
            <Button variant="destructive" onClick={handleClear} disabled={isClearing}>
              {isClearing ? "Clearing…" : "Clear table"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
