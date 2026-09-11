"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { type CreateProductResult, createProductAction } from "@/lib/menu-admin/actions";

const IDLE: CreateProductResult = { ok: true };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-[40px] items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
    >
      {pending ? "Creating…" : "Create draft"}
    </button>
  );
}

/**
 * Creates a bare product as a draft, then hands off to the full editor —
 * asking for everything (pricing, modifiers, photos, availability) on one
 * screen before the product even exists is more form than a first save
 * needs.
 */
export function ProductCreateForm({
  categories,
  initialCategoryId,
}: {
  categories: readonly { id: string; name: string }[];
  initialCategoryId?: string;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<CreateProductResult, FormData>(createProductAction, IDLE);

  useEffect(() => {
    if (state.ok && state.id) router.push(`/app/iq/menu/products/${state.id}`);
  }, [state, router]);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {!state.ok && state.error && (
        <p role="alert" className="text-sm text-[var(--destructive)]">
          {state.error}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Name
          <input name="name" required className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Slug
          <input name="slug" required pattern="[a-z0-9-]+" className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal" />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Category
        <select name="categoryId" defaultValue={initialCategoryId ?? ""} className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal">
          <option value="">Uncategorised</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {/* Everything else defaults sensibly and is edited on the next screen. */}
      <input type="hidden" name="spiceLevel" value="0" />
      <input type="hidden" name="isVegetarian" value="" />
      <div>
        <Submit />
      </div>
    </form>
  );
}
