"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { type ActionResult, updateProductDetailsAction } from "@/lib/menu-admin/actions";
import { ReloadAppButton } from "@/components/reload-app-button";
import { STALE_DEPLOYMENT_MESSAGE, recoverFromStaleDeployment } from "@/lib/errors/stale-deployment";

const IDLE: ActionResult = { ok: true };

const BADGE_PRESETS = ["Bestseller", "Popular", "New"] as const;

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
    servingInfo: string | null;
    productType: "SIMPLE" | "COMBO";
    updatedAt: Date;
  };
}) {
  const boundAction = updateProductDetailsAction.bind(null, id);
  const action = (prev: ActionResult, formData: FormData) => recoverFromStaleDeployment(() => boundAction(prev, formData));
  const [state, formAction] = useActionState<ActionResult, FormData>(action, IDLE);
  const justSaved = state !== IDLE && state.ok;
  const isStale = !state.ok && state.error === STALE_DEPLOYMENT_MESSAGE;
  const isConflict = !state.ok && !isStale && state.error?.includes("changed by someone else") === true;

  const initialPresets = initial.tags.filter((t): t is (typeof BADGE_PRESETS)[number] => (BADGE_PRESETS as readonly string[]).includes(t));
  const initialCustom = initial.tags.filter((t) => !(BADGE_PRESETS as readonly string[]).includes(t));
  const [selectedBadges, setSelectedBadges] = useState<Set<string>>(new Set(initialPresets));
  const [customBadges, setCustomBadges] = useState(initialCustom.join(", "));
  const tagsValue = useMemo(() => {
    const custom = customBadges
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    return [...selectedBadges, ...custom].join(", ");
  }, [selectedBadges, customBadges]);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="expectedUpdatedAt" value={initial.updatedAt.toISOString()} />
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
          <input name="name" required defaultValue={initial.name} className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Slug
          <input name="slug" required pattern="[a-z0-9-]+" defaultValue={initial.slug} className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal" />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm font-semibold">
        Product type
        <select name="productType" defaultValue={initial.productType} className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal">
          <option value="SIMPLE">Simple item</option>
          <option value="COMBO">Combo</option>
        </select>
        <span className="text-xs font-normal text-muted-foreground">A combo gets a &quot;Combo contents&quot; section below once saved.</span>
      </label>

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

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-semibold">Badges</legend>
        <div className="flex flex-wrap gap-3">
          {BADGE_PRESETS.map((preset) => (
            <label key={preset} className="flex min-h-[36px] cursor-pointer items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={selectedBadges.has(preset)}
                onChange={(e) =>
                  setSelectedBadges((current) => {
                    const next = new Set(current);
                    if (e.target.checked) next.add(preset);
                    else next.delete(preset);
                    return next;
                  })
                }
                className="size-4 accent-primary"
              />
              {preset}
            </label>
          ))}
        </div>
        <input
          value={customBadges}
          onChange={(e) => setCustomBadges(e.target.value)}
          placeholder="Other badges, comma-separated"
          className="mt-1 min-h-[36px] rounded-md border border-border bg-surface px-3 text-sm font-normal"
        />
        <input type="hidden" name="tags" value={tagsValue} />
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          SKU
          <input name="sku" defaultValue={initial.sku ?? ""} className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Serving info <span className="font-normal text-muted-foreground">(e.g. &quot;Serves 2&quot;, &quot;450g&quot;)</span>
          <input name="servingInfo" defaultValue={initial.servingInfo ?? ""} className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal" />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
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
