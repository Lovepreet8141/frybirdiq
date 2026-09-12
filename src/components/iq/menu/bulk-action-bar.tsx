"use client";

import { useState, useTransition } from "react";
import {
  bulkMarkAvailableAction,
  bulkMarkUnavailableAction,
  bulkMoveProductsToCategoryAction,
  bulkPublishProductsAction,
  bulkSetProductActiveAction,
} from "@/lib/menu-admin/actions";
import { UNAVAILABLE_REASON_PRESETS } from "@/lib/menu-admin/constants";
import { ReloadAppButton } from "@/components/reload-app-button";
import { STALE_DEPLOYMENT_MESSAGE, recoverFromStaleDeployment } from "@/lib/errors/stale-deployment";

type Reason = (typeof UNAVAILABLE_REASON_PRESETS)[number];
/** "Other" needs a typed-in reason, which a one-line bar has no room for — the per-product dialog still offers it. */
const BULK_REASONS = UNAVAILABLE_REASON_PRESETS.filter((reason): reason is Exclude<Reason, "Other"> => reason !== "Other");

export interface BulkSelection {
  readonly id: string;
  readonly status: "DRAFT" | "PUBLISHED";
  readonly isActive: boolean;
}

const BUTTON = "inline-flex min-h-[36px] items-center rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-50";

/**
 * Appears above the product grid once something is ticked. Every button is
 * a real bulk Server Action that loops the same repository call the
 * per-card action uses — nothing here has its own write path.
 */
export function BulkActionBar({
  selected,
  categories,
  canPublish,
  onDone,
  onClear,
}: {
  selected: readonly BulkSelection[];
  categories: readonly { id: string; name: string }[];
  canPublish: boolean;
  onDone: () => void;
  onClear: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<Reason>("Sold out");

  const count = selected.length;
  const ids = selected.map((item) => item.id);
  const draftIds = selected.filter((item) => item.status === "DRAFT").map((item) => item.id);
  const activeIds = selected.filter((item) => item.isActive).map((item) => item.id);
  const archivedIds = selected.filter((item) => !item.isActive).map((item) => item.id);
  const plural = (n: number) => `${n} product${n === 1 ? "" : "s"}`;

  function run(action: () => Promise<{ ok: boolean; error?: string }>, confirmMessage?: string) {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    startTransition(async () => {
      const result = await recoverFromStaleDeployment(action);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      setError(null);
      onDone();
    });
  }

  return (
    <div role="region" aria-label="Bulk actions" className="sticky top-2 z-10 flex flex-col gap-2 rounded-lg border border-primary/40 bg-surface p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="tabular text-sm font-semibold">{count} selected</span>
        <button type="button" onClick={onClear} disabled={isPending} className={`${BUTTON} text-muted-foreground hover:bg-surface-muted`}>
          Clear
        </button>
        <span aria-hidden="true" className="mx-1 h-6 w-px bg-border" />

        <button
          type="button"
          disabled={isPending}
          onClick={() => run(() => bulkMarkAvailableAction(ids))}
          className={`${BUTTON} bg-[var(--success)]/15 text-[var(--success)] hover:bg-[var(--success)]/25`}
        >
          Make available
        </button>

        <span className="flex items-center gap-1">
          <label className="sr-only" htmlFor="bulk-reason">
            Reason
          </label>
          <select
            id="bulk-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value as Reason)}
            disabled={isPending}
            className="min-h-[36px] rounded-md border border-border bg-surface px-2 text-sm"
          >
            {BULK_REASONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => bulkMarkUnavailableAction(ids, reason), `Mark ${plural(count)} unavailable — "${reason}"?`)}
            className={`${BUTTON} bg-[var(--destructive)]/10 text-[var(--destructive)] hover:bg-[var(--destructive)]/20`}
          >
            Mark unavailable
          </button>
        </span>

        {categories.length > 0 && (
          <>
            <label className="sr-only" htmlFor="bulk-category">
              Move to category
            </label>
            <select
              id="bulk-category"
              defaultValue=""
              disabled={isPending}
              onChange={(event) => {
                const value = event.target.value;
                if (!value) return;
                event.target.value = "";
                run(() => bulkMoveProductsToCategoryAction(ids, value === "__none__" ? null : value));
              }}
              className="min-h-[36px] rounded-md border border-border bg-surface px-2 text-sm"
            >
              <option value="" disabled>
                Move to category…
              </option>
              <option value="__none__">Uncategorised</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </>
        )}

        {canPublish && draftIds.length > 0 && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => bulkPublishProductsAction(draftIds), `Publish ${draftIds.length} draft${draftIds.length === 1 ? "" : "s"}? They go live on the website and the counter.`)}
            className={`${BUTTON} bg-primary text-primary-foreground hover:bg-primary/90`}
          >
            Publish {draftIds.length} draft{draftIds.length === 1 ? "" : "s"}
          </button>
        )}

        {activeIds.length > 0 && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => bulkSetProductActiveAction(activeIds, false), `Archive ${plural(activeIds.length)}? They disappear from the menu until restored.`)}
            className={`${BUTTON} text-muted-foreground hover:bg-surface-muted`}
          >
            Archive
          </button>
        )}
        {archivedIds.length > 0 && (
          <button type="button" disabled={isPending} onClick={() => run(() => bulkSetProductActiveAction(archivedIds, true))} className={`${BUTTON} text-muted-foreground hover:bg-surface-muted`}>
            Restore
          </button>
        )}

        {isPending && (
          <span role="status" className="text-sm text-muted-foreground">
            Working…
          </span>
        )}
      </div>

      {error && (
        <div role="alert" className="flex flex-col items-start gap-1.5 text-sm text-[var(--destructive)]">
          {error}
          {error === STALE_DEPLOYMENT_MESSAGE && <ReloadAppButton />}
        </div>
      )}
    </div>
  );
}
