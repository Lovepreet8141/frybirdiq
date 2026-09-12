"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { type CreateGroupResult, createModifierGroupAction, updateModifierGroupAction } from "@/lib/menu-admin/actions";
import { ReloadAppButton } from "@/components/reload-app-button";
import { STALE_DEPLOYMENT_MESSAGE, recoverFromStaleDeployment } from "@/lib/errors/stale-deployment";

const IDLE: CreateGroupResult = { ok: true };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-[40px] items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

export function ModifierGroupForm({
  id,
  initial,
}: {
  id?: string;
  initial?: { name: string; slug: string; minSelections: number; maxSelections: number | null; updatedAt: Date };
}) {
  const router = useRouter();
  const boundAction = id ? updateModifierGroupAction.bind(null, id) : createModifierGroupAction;
  const action = (prev: CreateGroupResult, formData: FormData) => recoverFromStaleDeployment(() => boundAction(prev, formData));
  const [state, formAction] = useActionState<CreateGroupResult, FormData>(action, IDLE);
  const justSaved = state !== IDLE && state.ok;
  const isStale = !state.ok && state.error === STALE_DEPLOYMENT_MESSAGE;
  const isConflict = !state.ok && !isStale && state.error?.includes("changed by someone else") === true;

  useEffect(() => {
    if (!id && state.ok && state.id) router.push(`/app/iq/menu/modifiers/${state.id}`);
  }, [id, state, router]);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {id && initial && <input type="hidden" name="expectedUpdatedAt" value={initial.updatedAt.toISOString()} />}
      {!state.ok && state.error && (
        <div role="alert" className="flex flex-col items-start gap-1.5 text-sm text-[var(--destructive)]">
          <p>
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
          {isStale && <ReloadAppButton />}
        </div>
      )}
      {justSaved && (
        <p role="status" className="text-sm text-[var(--success)]">
          Saved.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Name
          <input name="name" required defaultValue={initial?.name} className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Slug
          <input name="slug" required pattern="[a-z0-9\-]+" defaultValue={initial?.slug} className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal" />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Minimum selections <span className="font-normal text-muted-foreground">(1 = required)</span>
          <input name="minSelections" type="number" min={0} max={20} defaultValue={initial?.minSelections ?? 0} className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Maximum selections <span className="font-normal text-muted-foreground">(blank = unlimited)</span>
          <input name="maxSelections" type="number" min={1} max={20} defaultValue={initial?.maxSelections ?? ""} className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal" />
        </label>
      </div>
      <div>
        <Submit label={id ? "Save" : "Create group"} />
      </div>
    </form>
  );
}
