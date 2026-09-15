"use client";

/**
 * Status actions on a purchase order's detail page — send, receive, cancel.
 * Every one of these re-checks `purchasing.manage` on the server regardless
 * of `canManage` here (§41); this component only decides what's offered.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelPurchaseOrderAction, receivePurchaseOrderAction, sendPurchaseOrderAction } from "@/lib/inventory/purchase-order-actions";
import { ReloadAppButton } from "@/components/reload-app-button";
import { STALE_DEPLOYMENT_MESSAGE, recoverFromStaleDeployment } from "@/lib/errors/stale-deployment";
import { unitLabel } from "@/lib/iq/units";
import type { Unit } from "@/db/schema/inventory";
import { errorNoteClass, inputClass, submitClass, successNoteClass } from "./field";

export interface PurchaseOrderDetailActionLine {
  readonly id: string;
  readonly ingredientName: string;
  readonly quantity: number;
  readonly unit: Unit;
}

export function PurchaseOrderDetailActions({
  id,
  status,
  canManage,
  lines,
}: {
  id: string;
  status: "DRAFT" | "ORDERED" | "RECEIVED" | "CANCELLED";
  canManage: boolean;
  lines: readonly PurchaseOrderDetailActionLine[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showReceive, setShowReceive] = useState(false);
  const [receiveQuantities, setReceiveQuantities] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((line) => [line.id, String(line.quantity)])));
  const [isPending, startTransition] = useTransition();

  const allFullQuantity = useMemo(() => lines.every((line) => Number(receiveQuantities[line.id] ?? line.quantity) === line.quantity), [lines, receiveQuantities]);

  function refresh() {
    router.refresh();
  }

  function send() {
    setError(null);
    startTransition(async () => {
      const result = await recoverFromStaleDeployment(() => sendPurchaseOrderAction(id));
      if (!result.ok) {
        setError(result.error ?? "Could not send the purchase order.");
        return;
      }
      setMessage("Purchase order sent.");
      refresh();
    });
  }

  function cancel() {
    setError(null);
    startTransition(async () => {
      const result = await recoverFromStaleDeployment(() => cancelPurchaseOrderAction(id));
      if (!result.ok) {
        setError(result.error ?? "Could not cancel the purchase order.");
        return;
      }
      setMessage("Purchase order cancelled.");
      refresh();
    });
  }

  function receive() {
    setError(null);
    for (const line of lines) {
      const raw = receiveQuantities[line.id] ?? "";
      if (!/^\d+$/.test(raw) || Number(raw) > line.quantity) {
        setError(`Received quantity for ${line.ingredientName} must be a whole number, up to the ${line.quantity} ordered.`);
        return;
      }
    }

    startTransition(async () => {
      const result = await recoverFromStaleDeployment(() =>
        receivePurchaseOrderAction(
          id,
          lines.map((line) => ({ purchaseOrderItemId: line.id, receivedQuantity: Number(receiveQuantities[line.id] ?? line.quantity) })),
        ),
      );
      if (!result.ok) {
        setError(result.error ?? "Could not receive the purchase order.");
        return;
      }
      setMessage("Received. Stock and supplier price updated.");
      setShowReceive(false);
      refresh();
    });
  }

  if (status === "RECEIVED") {
    return <p className="text-sm text-muted-foreground">Received — stock and the supplier price are already updated.</p>;
  }
  if (status === "CANCELLED") {
    return <p className="text-sm text-muted-foreground">Cancelled. No stock was affected.</p>;
  }
  if (!canManage) {
    return <p className="text-sm text-muted-foreground">Sending, receiving and cancelling need the purchasing permission.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div role="alert" className={errorNoteClass}>
          {error}
          {error === STALE_DEPLOYMENT_MESSAGE && <ReloadAppButton className="mt-2 min-h-[32px] px-3 text-xs" />}
        </div>
      )}
      {message && !error && (
        <p role="status" className={successNoteClass}>
          {message}
        </p>
      )}

      {status === "DRAFT" && (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={isPending} onClick={send} className={submitClass}>
            {isPending ? "Sending…" : "Send order"}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={cancel}
            className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-semibold text-[var(--destructive)] hover:bg-surface-muted disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      )}

      {status === "ORDERED" && (
        <div className="flex flex-col gap-3">
          {!showReceive ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={isPending} onClick={() => setShowReceive(true)} className={submitClass}>
                Receive order
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={cancel}
                className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-semibold text-[var(--destructive)] hover:bg-surface-muted disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-muted p-3">
              <p className="text-sm font-semibold">{allFullQuantity ? "Receiving in full." : "Receiving with adjusted quantities."} Confirm what actually arrived.</p>
              <ul className="flex flex-col gap-2">
                {lines.map((line) => (
                  <li key={line.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                    <span>{line.ingredientName}</span>
                    <span className="flex items-center gap-2">
                      <input
                        aria-label={`Received quantity for ${line.ingredientName}`}
                        inputMode="numeric"
                        value={receiveQuantities[line.id] ?? ""}
                        onChange={(event) => setReceiveQuantities((values) => ({ ...values, [line.id]: event.target.value }))}
                        className={`${inputClass} w-20 text-right`}
                      />
                      <span className="text-muted-foreground">
                        of {line.quantity} {unitLabel(line.unit)} ordered
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={isPending} onClick={receive} className={submitClass}>
                  {isPending ? "Receiving…" : "Confirm receipt"}
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setShowReceive(false)}
                  className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-surface-muted disabled:opacity-60"
                >
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
