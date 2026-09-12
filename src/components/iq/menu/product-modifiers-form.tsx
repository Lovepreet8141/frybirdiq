"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { setProductModifierGroupsAction } from "@/lib/menu-admin/actions";
import { ReloadAppButton } from "@/components/reload-app-button";
import { STALE_DEPLOYMENT_MESSAGE, recoverFromStaleDeployment } from "@/lib/errors/stale-deployment";

interface GroupOption {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: "DRAFT" | "PUBLISHED";
}

const ARROW = "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent";

/**
 * Which option groups a product offers, in the order the customer and the
 * counter see them. The order is real: `setProductModifierGroups` writes
 * `position` from this array's index and every read path sorts by it —
 * the previous checkbox list only ever wrote click order, which nobody
 * could see or change. Assigned groups are an ordered list with move
 * up/down; unassigned ones sit below with an add button. One save writes
 * the whole thing.
 */
export function ProductModifiersForm({
  productId,
  groups,
  initialSelected,
}: {
  productId: string;
  groups: readonly GroupOption[];
  initialSelected: readonly string[];
}) {
  const [selected, setSelected] = useState<readonly string[]>(() => initialSelected.filter((id) => groups.some((group) => group.id === id)));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const assigned = selected.map((id) => groups.find((group) => group.id === id)).filter((group): group is GroupOption => group !== undefined);
  const unassigned = groups.filter((group) => !selected.includes(group.id));
  // Three groups all called "Size" are indistinguishable by name alone — show the slug for those.
  const ambiguous = new Set(groups.map((group) => group.name).filter((name, index, all) => all.indexOf(name) !== index));

  function update(next: (current: readonly string[]) => readonly string[]) {
    setSaved(false);
    setSelected(next);
  }

  function move(id: string, direction: "up" | "down") {
    update((current) => {
      const index = current.indexOf(id);
      const swapWith = direction === "up" ? index - 1 : index + 1;
      if (index === -1 || swapWith < 0 || swapWith >= current.length) return current;
      const next = [...current];
      [next[index], next[swapWith]] = [next[swapWith]!, next[index]!];
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      const result = await recoverFromStaleDeployment(() => setProductModifierGroupsAction(productId, selected));
      if (!result.ok) {
        setError(result.error ?? "Could not save.");
        return;
      }
      setError(null);
      setSaved(true);
    });
  }

  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No modifier groups exist yet.{" "}
        <Link href="/app/iq/menu/modifiers" className="text-primary underline">
          Create one
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div role="alert" className="flex flex-col items-start gap-1.5 text-sm text-[var(--destructive)]">
          {error}
          {error === STALE_DEPLOYMENT_MESSAGE && <ReloadAppButton />}
        </div>
      )}
      {saved && (
        <p role="status" className="text-sm text-[var(--success)]">
          Saved.
        </p>
      )}

      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Offered, in this order</p>
        {assigned.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet — add a group below.</p>
        ) : (
          <ol className="divide-y divide-border rounded-md border border-border">
            {assigned.map((group, index) => (
              <li key={group.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="tabular w-5 shrink-0 text-muted-foreground">{index + 1}.</span>
                  <span className="truncate">{group.name}</span>
                  {ambiguous.has(group.name) && <span className="shrink-0 text-xs text-muted-foreground">{group.slug}</span>}
                  {group.status === "DRAFT" && <span className="shrink-0 text-xs font-semibold text-[var(--warning)]">Draft</span>}
                </span>
                <span className="flex shrink-0 items-center gap-0.5">
                  <button type="button" onClick={() => move(group.id, "up")} disabled={index === 0} aria-label={`Move ${group.name} up`} className={ARROW}>
                    ↑
                  </button>
                  <button type="button" onClick={() => move(group.id, "down")} disabled={index === assigned.length - 1} aria-label={`Move ${group.name} down`} className={ARROW}>
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => update((current) => current.filter((id) => id !== group.id))}
                    className="ml-1 inline-flex min-h-[32px] items-center rounded-md px-2 text-sm font-semibold text-[var(--destructive)] hover:bg-[var(--destructive)]/10"
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {unassigned.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Not offered</p>
          <ul className="flex flex-wrap gap-1.5">
            {unassigned.map((group) => (
              <li key={group.id}>
                <button
                  type="button"
                  onClick={() => update((current) => [...current, group.id])}
                  className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-border px-2.5 text-sm hover:bg-surface-muted"
                >
                  + {group.name}
                  {ambiguous.has(group.name) && <span className="text-xs text-muted-foreground">{group.slug}</span>}
                  {group.status === "DRAFT" && <span className="text-xs font-semibold text-[var(--warning)]">Draft</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="inline-flex min-h-[40px] items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {isPending ? "Saving…" : "Save modifiers"}
        </button>
      </div>
    </div>
  );
}
