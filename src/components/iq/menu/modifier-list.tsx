"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { type ActionResult, addModifierAction, deleteModifierAction, updateModifierAction } from "@/lib/menu-admin/actions";
import { type Paise, formatINR, toRupeesFloat } from "@/lib/money";
import { ActionButton } from "./action-button";

const IDLE: ActionResult = { ok: true };

type ModifierRow = { id: string; name: string; slug: string; priceDelta: Paise; isDefault: boolean; isAvailable: boolean; updatedAt: Date };

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-[36px] items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-surface-muted disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

/** One option's inline edit form — collapsed to a row until "Edit" is clicked. */
function ModifierEditForm({ modifier, onDone }: { modifier: ModifierRow; onDone: () => void }) {
  const action = updateModifierAction.bind(null, modifier.id);
  const [state, formAction] = useActionState<ActionResult, FormData>(action, IDLE);
  const isConflict = !state.ok && state.error?.includes("changed by someone else") === true;
  const justSaved = state !== IDLE && state.ok;

  useEffect(() => {
    if (justSaved) onDone();
  }, [justSaved, onDone]);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 bg-surface-muted px-3 py-2">
      <input type="hidden" name="expectedUpdatedAt" value={modifier.updatedAt.toISOString()} />
      {!state.ok && state.error && (
        <p role="alert" className="w-full text-sm text-[var(--destructive)]">
          {state.error}
          {isConflict && (
            <>
              {" "}
              <a href="" className="underline">
                Reload the page
              </a>
              .
            </>
          )}
        </p>
      )}
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Name
        <input name="name" required defaultValue={modifier.name} className="min-h-[36px] rounded-md border border-border bg-surface px-3 font-normal" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Slug
        <input name="slug" required pattern="[a-z0-9-]+" defaultValue={modifier.slug} className="min-h-[36px] w-32 rounded-md border border-border bg-surface px-3 font-normal" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Price change
        <input name="priceDelta" defaultValue={toRupeesFloat(modifier.priceDelta)} className="min-h-[36px] w-24 rounded-md border border-border bg-surface px-3 font-normal" />
      </label>
      <label className="flex min-h-[36px] cursor-pointer items-center gap-1.5 text-sm font-semibold">
        <input type="checkbox" name="isDefault" defaultChecked={modifier.isDefault} className="size-4 accent-primary" />
        Default
      </label>
      <label className="flex min-h-[36px] cursor-pointer items-center gap-1.5 text-sm font-semibold">
        <input type="checkbox" name="isAvailable" defaultChecked={modifier.isAvailable} className="size-4 accent-primary" />
        Available
      </label>
      <Submit label="Save" pendingLabel="Saving…" />
      <button type="button" onClick={onDone} className="inline-flex min-h-[36px] items-center px-2 text-sm text-muted-foreground hover:underline">
        Cancel
      </button>
    </form>
  );
}

export function ModifierList({ groupId, modifiers }: { groupId: string; modifiers: readonly ModifierRow[] }) {
  const action = addModifierAction.bind(null, groupId);
  const [state, formAction] = useActionState<ActionResult, FormData>(action, IDLE);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {modifiers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No options yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {modifiers.map((modifier) =>
            editingId === modifier.id ? (
              <li key={modifier.id}>
                <ModifierEditForm modifier={modifier} onDone={() => setEditingId(null)} />
              </li>
            ) : (
              <li key={modifier.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span>
                  {modifier.name}
                  {!modifier.isAvailable && <span className="ml-2 text-xs font-semibold text-muted-foreground">Unavailable</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular text-muted-foreground">
                    {modifier.priceDelta === 0n ? "No charge" : formatINR(modifier.priceDelta)}
                  </span>
                  <button type="button" onClick={() => setEditingId(modifier.id)} className="inline-flex min-h-[36px] items-center rounded-md border border-border px-3 text-sm font-semibold hover:bg-surface-muted">
                    Edit
                  </button>
                  <ActionButton action={() => deleteModifierAction(modifier.id)} variant="destructive" confirmMessage={`Remove "${modifier.name}"?`}>
                    Remove
                  </ActionButton>
                </span>
              </li>
            ),
          )}
        </ul>
      )}

      <form action={formAction} className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
        {!state.ok && state.error && (
          <p role="alert" className="w-full text-sm text-[var(--destructive)]">
            {state.error}
          </p>
        )}
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Name
          <input name="name" required className="min-h-[36px] rounded-md border border-border bg-surface px-3 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Slug
          <input name="slug" required pattern="[a-z0-9-]+" className="min-h-[36px] w-32 rounded-md border border-border bg-surface px-3 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Price change
          <input name="priceDelta" defaultValue="0" className="min-h-[36px] w-24 rounded-md border border-border bg-surface px-3 font-normal" />
        </label>
        <label className="flex min-h-[36px] cursor-pointer items-center gap-1.5 text-sm font-semibold">
          <input type="checkbox" name="isDefault" className="size-4 accent-primary" />
          Default
        </label>
        <label className="flex min-h-[36px] cursor-pointer items-center gap-1.5 text-sm font-semibold">
          <input type="checkbox" name="isAvailable" defaultChecked className="size-4 accent-primary" />
          Available
        </label>
        <Submit label="+ Add option" pendingLabel="Adding…" />
      </form>
    </div>
  );
}
