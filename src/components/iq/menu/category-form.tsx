"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type ActionResult, createCategoryAction, updateCategoryAction } from "@/lib/menu-admin/actions";

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
  initial?: { name: string; slug: string; description: string | null; imageUrl: string | null };
}) {
  const action = id ? updateCategoryAction.bind(null, id) : createCategoryAction;
  const [state, formAction] = useActionState<ActionResult, FormData>(action, IDLE);
  const justSaved = state !== IDLE && state.ok;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {!state.ok && state.error && (
        <p role="alert" className="text-sm text-[var(--destructive)]">
          {state.error}
        </p>
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
