"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type ActionResult, updateProductDetailsAction } from "@/lib/menu-admin/actions";

const IDLE: ActionResult = { ok: true };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-[40px] items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
    >
      {pending ? "Saving…" : "Save details"}
    </button>
  );
}

export function ProductDetailsForm({
  id,
  categories,
  taxRates,
  initial,
}: {
  id: string;
  categories: readonly { id: string; name: string }[];
  taxRates: readonly { id: string; name: string; rateBps: number }[];
  initial: {
    name: string;
    slug: string;
    description: string | null;
    shortDescription: string | null;
    categoryId: string | null;
    taxRateId: string | null;
    spiceLevel: number;
    isVegetarian: boolean;
    allergens: readonly string[];
    tags: readonly string[];
    sku: string | null;
    prepMinutes: number | null;
    kdsStation: string | null;
  };
}) {
  const action = updateProductDetailsAction.bind(null, id);
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
          <input name="name" required defaultValue={initial.name} className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Slug
          <input name="slug" required pattern="[a-z0-9-]+" defaultValue={initial.slug} className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal" />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm font-semibold">
        Short description <span className="font-normal text-muted-foreground">(card and grid)</span>
        <input name="shortDescription" defaultValue={initial.shortDescription ?? ""} maxLength={200} className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal" />
      </label>

      <label className="flex flex-col gap-1 text-sm font-semibold">
        Full description
        <textarea name="description" defaultValue={initial.description ?? ""} rows={3} className="rounded-md border border-border bg-surface px-3 py-2 font-normal" />
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Category
          <select name="categoryId" defaultValue={initial.categoryId ?? ""} className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal">
            <option value="">Uncategorised</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-semibold">
          GST rate <span className="font-normal text-muted-foreground">(HSN follows the rate)</span>
          <select name="taxRateId" defaultValue={initial.taxRateId ?? ""} className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal">
            <option value="">Default</option>
            {taxRates.map((rate) => (
              <option key={rate.id} value={rate.id}>
                {rate.name} ({(rate.rateBps / 100).toFixed(1)}%)
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-semibold">
          Spice level (0–5)
          <input name="spiceLevel" type="number" min={0} max={5} defaultValue={initial.spiceLevel} className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal" />
        </label>
      </div>

      <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm font-semibold">
        <input type="checkbox" name="isVegetarian" defaultChecked={initial.isVegetarian} className="size-4 accent-primary" />
        Vegetarian
      </label>

      <label className="flex flex-col gap-1 text-sm font-semibold">
        Allergens <span className="font-normal text-muted-foreground">(only list what you&apos;ve confirmed, comma-separated)</span>
        <input name="allergens" defaultValue={initial.allergens.join(", ")} className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal" />
      </label>

      <label className="flex flex-col gap-1 text-sm font-semibold">
        Badges <span className="font-normal text-muted-foreground">(e.g. bestseller, new — comma-separated)</span>
        <input name="tags" defaultValue={initial.tags.join(", ")} className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal" />
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          SKU
          <input name="sku" defaultValue={initial.sku ?? ""} className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Prep time (minutes)
          <input name="prepMinutes" type="number" min={0} max={240} defaultValue={initial.prepMinutes ?? ""} className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          KDS station <span className="font-normal text-muted-foreground">(for later)</span>
          <input name="kdsStation" defaultValue={initial.kdsStation ?? ""} className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal" />
        </label>
      </div>

      <div>
        <Submit />
      </div>
    </form>
  );
}
