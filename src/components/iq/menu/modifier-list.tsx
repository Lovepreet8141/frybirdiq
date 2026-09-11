"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type ActionResult, addModifierAction, deleteModifierAction } from "@/lib/menu-admin/actions";
import { type Paise, formatINR } from "@/lib/money";
import { ActionButton } from "./action-button";

const IDLE: ActionResult = { ok: true };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-[40px] items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-surface-muted disabled:opacity-60"
    >
      {pending ? "Adding…" : "+ Add option"}
    </button>
  );
}

export function ModifierList({
  groupId,
  modifiers,
}: {
  groupId: string;
  modifiers: readonly { id: string; name: string; slug: string; priceDelta: Paise; isAvailable: boolean }[];
}) {
  const action = addModifierAction.bind(null, groupId);
  const [state, formAction] = useActionState<ActionResult, FormData>(action, IDLE);

  return (
    <div className="flex flex-col gap-3">
      {modifiers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No options yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {modifiers.map((modifier) => (
            <li key={modifier.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span>
                {modifier.name}
                {!modifier.isAvailable && <span className="ml-2 text-xs font-semibold text-muted-foreground">Unavailable</span>}
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular text-muted-foreground">
                  {modifier.priceDelta === 0n ? "No charge" : formatINR(modifier.priceDelta)}
                </span>
                <ActionButton action={() => deleteModifierAction(modifier.id)} variant="destructive" confirmMessage={`Remove "${modifier.name}"?`}>
                  Remove
                </ActionButton>
              </span>
            </li>
          ))}
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
        <Submit />
      </form>
    </div>
  );
}
