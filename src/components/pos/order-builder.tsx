"use client";

import { Banknote, Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { ORDER_CHANNELS, ORDER_CHANNEL_LABELS, type OrderChannel, fulfilmentsFor } from "@/domain/order-channel";
import type { PriceDraftOk } from "@/lib/pos/actions";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState, LoadingState, OfflineState } from "@/components/states";

export interface PosTableOption {
  readonly id: string;
  readonly name: string;
  /** False when someone is already seated there with an open bill. */
  readonly available: boolean;
}

export interface DraftLine {
  readonly key: string;
  readonly slug: string;
  readonly name: string;
  readonly quantity: number;
  readonly modifierNames: readonly string[];
}

/**
 * The order being built: channel first, then lines, then a total the server
 * computed. Nothing here is a source of truth for money — every figure comes
 * from `priceDraftOrder`, already formatted. §13.
 */
export function OrderBuilder({
  channel,
  onChannelChange,
  lines,
  onQuantityChange,
  onRemove,
  priced,
  isPricing,
  pricingError,
  onRetry,
  online,
  tables,
  tableId,
  onTableChange,
  onCharge,
}: {
  channel: OrderChannel | null;
  onChannelChange: (channel: OrderChannel) => void;
  lines: readonly DraftLine[];
  onQuantityChange: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
  priced: PriceDraftOk | null;
  isPricing: boolean;
  pricingError: string | null;
  onRetry: () => void;
  online: boolean;
  tables: readonly PosTableOption[];
  tableId: string | null;
  onTableChange: (tableId: string | null) => void;
  onCharge: () => void;
}) {
  return (
    <div className="flex h-full flex-col border-l border-border bg-surface">
      <div className="flex flex-col gap-2 border-b border-border p-4">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Order type</span>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Order type">
          {ORDER_CHANNELS.filter((value): value is "DINE_IN" | "TAKEAWAY" => value !== "ONLINE").map((value) => {
            const isActive = channel === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={isActive}
                onClick={() => onChannelChange(value)}
                className={cn(
                  "flex min-h-[56px] items-center justify-center rounded-md border px-3 text-sm font-semibold transition-colors duration-[var(--duration-micro)]",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:border-border-strong",
                )}
              >
                {ORDER_CHANNEL_LABELS[value]}
              </button>
            );
          })}
        </div>
        {channel && <p className="text-xs text-muted-foreground">{fulfilmentLabel(channel)}</p>}

        {/* Seating is a dine-in idea, so the control only exists for dine-in —
            and the server refuses a table on a takeaway order regardless.
            Tables with an open bill are listed but not selectable: hiding them
            would leave the counter wondering where a table went. */}
        {channel === "DINE_IN" && tables.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pos-table" className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Table
            </label>
            <select
              id="pos-table"
              value={tableId ?? ""}
              onChange={(event) => onTableChange(event.target.value === "" ? null : event.target.value)}
              className="h-[44px] w-full rounded-md border border-border bg-background px-3 text-sm font-semibold"
            >
              <option value="">No table</option>
              {tables.map((table) => (
                <option key={table.id} value={table.id} disabled={!table.available}>
                  {table.name}
                  {table.available ? "" : " — occupied"}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!online && <OfflineState className="m-4" />}

      {channel === null ? (
        <EmptyState
          className="m-4 flex-1"
          title="Choose dine-in or takeaway."
          detail="Pick how this order is served before adding items."
        />
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-4">
            {lines.length === 0 ? (
              <EmptyState title="No items yet." detail="Tap a product to add it to this order." />
            ) : (
              <ul className="flex flex-col gap-3">
                {lines.map((line) => {
                  const priceView = priced?.lines.find((entry) => entry.key === line.key);
                  return (
                    <li key={line.key} className="flex flex-col gap-2 rounded-md border border-border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{line.name}</p>
                          {line.modifierNames.length > 0 && (
                            <p className="truncate text-xs text-muted-foreground">{line.modifierNames.join(", ")}</p>
                          )}
                        </div>
                        <span className="tabular shrink-0 text-sm font-semibold">
                          {priceView ? priceView.lineTotal : <Loader2 className="size-4 animate-spin" aria-label="Pricing" />}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onQuantityChange(line.key, line.quantity - 1)}
                            disabled={line.quantity <= 1}
                            className="flex size-[44px] items-center justify-center rounded-md border border-border transition-colors hover:border-border-strong disabled:opacity-40"
                            aria-label={`One fewer ${line.name}`}
                          >
                            <Minus className="size-4" aria-hidden="true" />
                          </button>
                          <span className="tabular w-8 text-center font-semibold" aria-live="polite">
                            {line.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => onQuantityChange(line.key, line.quantity + 1)}
                            disabled={line.quantity >= 50}
                            className="flex size-[44px] items-center justify-center rounded-md border border-border transition-colors hover:border-border-strong disabled:opacity-40"
                            aria-label={`One more ${line.name}`}
                          >
                            <Plus className="size-4" aria-hidden="true" />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => onRemove(line.key)}
                          className="ml-auto flex size-[44px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                          aria-label={`Remove ${line.name}`}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {priced && priced.rejected.length > 0 && (
              <p role="alert" className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
                {priced.rejected.length === 1
                  ? "One item is no longer on the menu and was left out of the total."
                  : `${priced.rejected.length} items are no longer on the menu and were left out of the total.`}
              </p>
            )}
          </div>

          {lines.length > 0 && (
            <div className="border-t border-border p-4">
              {pricingError ? (
                <ErrorState
                  title="Couldn't price this order"
                  detail={pricingError}
                  action={
                    <button
                      type="button"
                      onClick={onRetry}
                      className="flex min-h-[44px] items-center justify-center rounded-md border border-border-strong px-4 text-sm font-semibold hover:bg-surface-muted"
                    >
                      Try again
                    </button>
                  }
                />
              ) : priced ? (
                <dl className="flex flex-col gap-1.5 text-sm">
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-muted-foreground">
                      {priced.itemCount} {priced.itemCount === 1 ? "item" : "items"}
                    </dt>
                    <dd className="tabular">{priced.subtotal}</dd>
                  </div>
                  {priced.hasTax && (
                    <div className="flex items-baseline justify-between gap-4 text-xs text-muted-foreground">
                      <dt>
                        GST ({priced.cgst} CGST + {priced.sgst} SGST)
                      </dt>
                      <dd className="tabular">{priced.taxTotal}</dd>
                    </div>
                  )}
                  <div
                    className={cn(
                      "flex items-baseline justify-between gap-4 border-t border-border pt-2 transition-opacity duration-[var(--duration-micro)]",
                      isPricing && "opacity-50",
                    )}
                  >
                    <span className="font-heading text-base font-semibold">Total</span>
                    <span className="tabular text-xl font-bold">{priced.total}</span>
                  </div>
                </dl>
              ) : (
                // Between a tap and the debounced reprice landing — too brief
                // to be worth its own copy, so it borrows the loading look.
                <LoadingState rows={2} />
              )}

              {/* The one way money is taken. Disabled until the server has
                  returned a total for the current draft, so the sheet can
                  never open against a figure this screen invented, and while
                  a reprice is in flight, so it cannot open against a stale
                  one either. */}
              <button
                type="button"
                onClick={onCharge}
                disabled={!online || priced === null || isPricing || pricingError !== null}
                className="mt-3 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-base font-bold text-primary-foreground transition-opacity disabled:opacity-50"
              >
                <Banknote className="size-5" aria-hidden="true" />
                {priced ? `Charge ${priced.total}` : "Charge"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The fulfilment a channel implies, for a small label under the toggle. */
export function fulfilmentLabel(channel: OrderChannel): string {
  const [fulfilment] = fulfilmentsFor(channel);
  return fulfilment === "DINE_IN" ? "Served at the table" : "Handed over at the counter";
}
