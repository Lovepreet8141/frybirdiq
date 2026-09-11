"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type ActionResult, createCategoryAction, updateCategoryAction } from "@/lib/menu-admin/actions";
import { ReloadAppButton } from "@/components/reload-app-button";
import { STALE_DEPLOYMENT_MESSAGE, recoverFromStaleDeployment } from "@/lib/errors/stale-deployment";

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

const IDLE: ActionResult = { ok: true };

export function CategoryForm({
  id,
  initial,
}: {
  id?: string;
  initial?: { name: string; slug: string; description: string | null; imageUrl: string | null; updatedAt: Date };
}) {
  const boundAction = id ? updateCategoryAction.bind(null, id) : createCategoryAction;
  const action = (prev: ActionResult, formData: FormData) => recoverFromStaleDeployment(() => boundAction(prev, formData));
  const [state, formAction] = useActionState<ActionResult, FormData>(action, IDLE);
  const justSaved = state !== IDLE && state.ok;
  const isStale = !state.ok && state.error === STALE_DEPLOYMENT_MESSAGE;
  const isConflict = !state.ok && !isStale && state.error?.includes("changed by someone else") === true;

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
          <input name="slug" required defaultValue={initial?.slug} pattern="[a-z0-9-]+" className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal" />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Description
        <textarea name="description" defaultValue={initial?.description ?? ""} rows={2} className="rounded-md border border-border bg-surface px-3 py-2 font-normal" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Banner image URL
        <input name="imageUrl" type="url" defaultValue={initial?.imageUrl ?? ""} placeholder="Pick from the media library, or paste a URL" className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal" />
      </label>
      <div>
        <Submit label={id ? "Save" : "Create category"} />
      </div>
    </form>
  );
}
