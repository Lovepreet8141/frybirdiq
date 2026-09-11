"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { setProductModifierGroupsAction } from "@/lib/menu-admin/actions";
import { ReloadAppButton } from "@/components/reload-app-button";
import { STALE_DEPLOYMENT_MESSAGE, recoverFromStaleDeployment } from "@/lib/errors/stale-deployment";

export function ProductModifiersForm({
  productId,
  groups,
  initialSelected,
}: {
  productId: string;
  groups: readonly { id: string; name: string; status: "DRAFT" | "PUBLISHED" }[];
  initialSelected: readonly string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function toggle(id: string) {
    setSaved(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      const result = await recoverFromStaleDeployment(() => setProductModifierGroupsAction(productId, [...selected]));
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
    <div className="flex flex-col gap-3">
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
      <ul className="flex flex-col gap-2">
        {groups.map((group) => (
          <li key={group.id}>
            <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={selected.has(group.id)} onChange={() => toggle(group.id)} className="size-4 accent-primary" />
              {group.name}
              {group.status === "DRAFT" && <span className="text-xs font-semibold text-[var(--warning)]">Draft</span>}
            </label>
          </li>
        ))}
      </ul>
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
