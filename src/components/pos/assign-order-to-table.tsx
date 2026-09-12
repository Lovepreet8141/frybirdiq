"use client";

import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ReloadAppButton } from "@/components/reload-app-button";
import { formatINR, paise } from "@/lib/money";
import { assignOrderToTableAction } from "@/lib/pos/table-actions";
import { STALE_DEPLOYMENT_MESSAGE, recoverFromStaleDeployment } from "@/lib/errors/stale-deployment";
import type { UnassignedDineInOrder } from "@/lib/repositories/tables";

/**
 * "Sit this order down." Picks from real unassigned dine-in orders — until
 * the counter can actually place one as DINE_IN, this list is honestly
 * empty, which is the correct state to show, not a placeholder to hide.
 */
export function AssignOrderToTable({ tableId, tableName, orders }: { tableId: string; tableName: string; orders: readonly UnassignedDineInOrder[] }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function assign(orderId: string) {
    startTransition(async () => {
      const result = await recoverFromStaleDeployment(() => assignOrderToTableAction(orderId, tableId));
      if (!result.ok) {
        setError(result.error ?? "Could not assign that order.");
        return;
      }
      setError(null);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm">Seat an order</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Seat an order at {tableName}</DialogTitle>
        </DialogHeader>

        {error && (
          <div role="alert" className="flex flex-col items-start gap-2 text-sm text-[var(--destructive)]">
            {error}
            {error === STALE_DEPLOYMENT_MESSAGE && <ReloadAppButton />}
          </div>
        )}

        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No unseated dine-in orders right now.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {orders.map((order) => (
              <li key={order.id}>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => assign(order.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left text-sm hover:border-foreground/20 disabled:opacity-60"
                >
                  <span>
                    <span className="font-medium">#{order.orderNumber}</span>
                    {order.customerName && <span className="text-muted-foreground"> · {order.customerName}</span>}
                  </span>
                  <span className="tabular font-medium">{formatINR(paise(order.grandTotal), "whole")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
