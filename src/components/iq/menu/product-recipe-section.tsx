"use client";

import { useMemo, useState, useTransition } from "react";
import { createBareRecipeAction, saveRecipeVersionAction } from "@/lib/menu-admin/actions";
import { ReloadAppButton } from "@/components/reload-app-button";
import { STALE_DEPLOYMENT_MESSAGE, recoverFromStaleDeployment } from "@/lib/errors/stale-deployment";
import { EmptyState, PermissionDenied } from "@/components/states";
import { theoreticalRecipeCost, type MilliPaise } from "@/lib/iq/costing";
import { unitLabel, type BaseUnit } from "@/lib/iq/units";
import { formatINR, paise, scale, type Paise } from "@/lib/money";

export interface RecipeIngredientOptionView {
  readonly id: string;
  readonly name: string;
  readonly baseUnit: BaseUnit;
  readonly costPerBaseUnitMilli: MilliPaise;
  readonly isPackaging: boolean;
  readonly isActive: boolean;
}

export interface RecipeLineView {
  readonly ingredientId: string;
  readonly ingredientName: string;
  readonly baseUnit: BaseUnit;
  readonly quantityBase: number;
  readonly cost: Paise;
  readonly priced: boolean;
}

export interface RecipeView {
  readonly linked: boolean;
  readonly yieldQuantity: number;
  /** Null until the first version is saved. */
  readonly version: number | null;
  readonly lines: readonly RecipeLineView[];
  readonly theoreticalCost: Paise | null;
  readonly costPerPortion: Paise | null;
}

type Access = "none" | "view" | "edit";

/**
 * The bare-header form this section has always offered — unchanged except
 * that a successful create now reveals the line editor below it via a
 * server refresh, instead of an optimistic local flag.
 */
function CreateRecipeForm({ productId }: { productId: string }) {
  const [yieldQuantity, setYieldQuantity] = useState(1);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Yield (portions per batch)
        <input
          type="number"
          min={1}
          value={yieldQuantity}
          onChange={(event) => setYieldQuantity(Number(event.target.value))}
          className="min-h-[36px] w-24 rounded-md border border-border bg-surface px-3 font-normal"
        />
      </label>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await recoverFromStaleDeployment(() => createBareRecipeAction(productId, yieldQuantity));
            if (!result.ok) setError(result.error ?? "Could not create the recipe.");
          })
        }
        className="inline-flex min-h-[36px] items-center rounded-md border border-border px-3 text-sm font-semibold hover:bg-surface-muted disabled:opacity-60"
      >
        {isPending ? "Creating…" : "Create recipe"}
      </button>
      {error && (
        <div role="alert" className="flex w-full flex-col items-start gap-1.5 text-xs text-[var(--destructive)]">
          {error}
          {error === STALE_DEPLOYMENT_MESSAGE && <ReloadAppButton className="min-h-[32px] px-3 text-xs" />}
        </div>
      )}
    </div>
  );
}

function CostSummary({ total, perPortion, dirty }: { total: Paise | null; perPortion: Paise | null; dirty: boolean }) {
  if (total === null) return null;
  return (
    <p className="text-sm font-semibold">
      {dirty ? "Estimated cost (unsaved): " : "Theoretical cost: "}
      {formatINR(total)} per batch
      {perPortion !== null && ` · ${formatINR(perPortion)} per portion`}
    </p>
  );
}

/** A staff member with `recipes.view` but not `recipes.edit` — the real lines and the real cost, no form to submit. */
function ReadOnlyRecipe({ recipe }: { recipe: RecipeView }) {
  if (recipe.lines.length === 0) {
    return <EmptyState title="No recipe lines yet" detail="No ingredients have been added to this recipe yet." />;
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {recipe.lines.map((line) => (
          <li key={line.ingredientId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm">
            <span className="font-medium">{line.ingredientName}</span>
            <span className="tabular text-muted-foreground">
              {line.quantityBase} {unitLabel(line.baseUnit)}
            </span>
            <span className="tabular">
              {formatINR(line.cost)}
              {!line.priced && <span className="ml-1 text-[11px] text-warning">(unpriced)</span>}
            </span>
          </li>
        ))}
      </ul>
      <CostSummary total={recipe.theoreticalCost} perPortion={recipe.costPerPortion} dirty={false} />
    </div>
  );
}

/**
 * The interactive editor. Local `draftLines` state is the only thing that
 * changes as a staff member adds, edits or removes a line — nothing reaches
 * the server until "Save recipe" is pressed, at which point the whole set
 * is sent as one new recipe version (never a per-line write). Keyed by the
 * recipe's version number in the parent, so a successful save — which
 * always produces a new version — remounts this component and resets the
 * draft to what the server just persisted, instead of drifting from it.
 */
function RecipeEditor({
  productId,
  yieldQuantity,
  initialLines,
  ingredientOptions,
}: {
  productId: string;
  yieldQuantity: number;
  initialLines: readonly RecipeLineView[];
  ingredientOptions: readonly RecipeIngredientOptionView[];
}) {
  const [draftLines, setDraftLines] = useState(() => initialLines.map((line) => ({ ingredientId: line.ingredientId, quantity: line.quantityBase })));
  const [selectedIngredientId, setSelectedIngredientId] = useState("");
  const [quantityInput, setQuantityInput] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  const ingredientMap = useMemo(() => new Map(ingredientOptions.map((option) => [option.id, option])), [ingredientOptions]);

  const costed = useMemo(
    () =>
      theoreticalRecipeCost(
        draftLines.map((line) => ({
          ingredientId: line.ingredientId,
          quantityBase: line.quantity,
          costPerBaseUnitMilli: ingredientMap.get(line.ingredientId)?.costPerBaseUnitMilli ?? (0n as MilliPaise),
        })),
      ),
    [draftLines, ingredientMap],
  );
  const costPerPortion = costed.total === null ? null : scale(costed.total, 1, Math.max(yieldQuantity, 1));

  // A line-set diff, not a deep-equal library — sorted so reordering never
  // reads as a change, which it isn't; only the actual ingredients and
  // quantities are.
  const dirty = useMemo(() => {
    const key = (lines: readonly { ingredientId: string; quantity: number }[]) =>
      [...lines].map((line) => `${line.ingredientId}:${line.quantity}`).sort().join("|");
    return key(initialLines.map((line) => ({ ingredientId: line.ingredientId, quantity: line.quantityBase }))) !== key(draftLines);
  }, [initialLines, draftLines]);

  const availableToAdd = ingredientOptions.filter((option) => option.isActive && !draftLines.some((line) => line.ingredientId === option.id));
  const selectedIngredient = ingredientMap.get(selectedIngredientId);
  const noIngredientsRecorded = ingredientOptions.filter((option) => option.isActive).length === 0;

  function addLine() {
    if (!selectedIngredientId) return;
    const quantity = Number(quantityInput);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setAddError("Enter a whole-number quantity greater than zero.");
      return;
    }
    setDraftLines((lines) => [...lines, { ingredientId: selectedIngredientId, quantity }]);
    setSelectedIngredientId("");
    setQuantityInput("");
    setAddError(null);
  }

  function removeLine(ingredientId: string) {
    setDraftLines((lines) => lines.filter((line) => line.ingredientId !== ingredientId));
  }

  function updateQuantity(ingredientId: string, quantity: number) {
    setDraftLines((lines) => lines.map((line) => (line.ingredientId === ingredientId ? { ...line, quantity } : line)));
  }

  function save() {
    startSaving(async () => {
      const result = await recoverFromStaleDeployment(() =>
        saveRecipeVersionAction(
          productId,
          draftLines.map((line) => ({ ingredientId: line.ingredientId, quantity: line.quantity })),
        ),
      );
      if (!result.ok) {
        setSaveError(result.error ?? "Could not save the recipe.");
        return;
      }
      setSaveError(null);
      // No further local update needed — a successful save always creates a
      // new version, the parent Server Component re-renders with it, and
      // this whole editor remounts (see the `key` on it below) with the
      // freshly persisted lines as its new starting point.
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {draftLines.length === 0 ? (
        <EmptyState title="No recipe lines yet" detail="Add ingredients below to start costing this recipe." />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {draftLines.map((line, index) => {
              const meta = ingredientMap.get(line.ingredientId);
              const costedLine = costed.lines[index];
              return (
                <li key={line.ingredientId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm">
                  <span className="font-medium">{meta?.name ?? "Unknown ingredient"}</span>
                  <span className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={line.quantity}
                      onChange={(event) => updateQuantity(line.ingredientId, Math.max(1, Math.trunc(Number(event.target.value) || 1)))}
                      className="tabular min-h-[32px] w-20 rounded-md border border-border bg-surface px-2 text-right font-normal"
                    />
                    <span className="text-muted-foreground">{meta ? unitLabel(meta.baseUnit) : ""}</span>
                  </span>
                  <span className="tabular text-muted-foreground">
                    {formatINR(costedLine?.cost ?? paise(0))}
                    {costedLine && !costedLine.priced && <span className="ml-1 text-[11px] text-warning">(unpriced)</span>}
                  </span>
                  <button type="button" onClick={() => removeLine(line.ingredientId)} className="text-xs font-semibold text-[var(--destructive)] hover:underline">
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
          <CostSummary total={costed.total} perPortion={costPerPortion} dirty={dirty} />
        </>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Ingredient
          <select
            value={selectedIngredientId}
            onChange={(event) => setSelectedIngredientId(event.target.value)}
            disabled={noIngredientsRecorded}
            className="min-h-[36px] min-w-[180px] rounded-md border border-border bg-surface px-3 font-normal disabled:opacity-60"
          >
            <option value="">Choose an ingredient…</option>
            {availableToAdd.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
                {option.isPackaging ? " (packaging)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Quantity {selectedIngredient && `(${unitLabel(selectedIngredient.baseUnit)})`}
          <input
            type="number"
            min={1}
            step={1}
            value={quantityInput}
            disabled={!selectedIngredientId}
            onChange={(event) => setQuantityInput(event.target.value)}
            className="min-h-[36px] w-24 rounded-md border border-border bg-surface px-3 font-normal disabled:opacity-60"
          />
        </label>
        <button
          type="button"
          onClick={addLine}
          disabled={!selectedIngredientId}
          className="inline-flex min-h-[36px] items-center rounded-md border border-border px-3 text-sm font-semibold hover:bg-surface-muted disabled:opacity-50"
        >
          Add line
        </button>
      </div>
      {noIngredientsRecorded && <p className="text-xs text-muted-foreground">No ingredients recorded yet — add some from Inventory first.</p>}
      {!noIngredientsRecorded && availableToAdd.length === 0 && <p className="text-xs text-muted-foreground">Every active ingredient is already on this recipe.</p>}
      {addError && (
        <p role="alert" className="text-xs text-[var(--destructive)]">
          {addError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
        <button
          type="button"
          disabled={isSaving || !dirty || draftLines.length === 0}
          onClick={save}
          className="inline-flex min-h-[40px] items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {isSaving ? "Saving…" : "Save recipe"}
        </button>
        {!dirty && draftLines.length > 0 && <span className="text-xs text-muted-foreground">No changes to save.</span>}
        {draftLines.length === 0 && <span className="text-xs text-muted-foreground">Add at least one ingredient to save.</span>}
      </div>
      {saveError && (
        <div role="alert" className="flex w-full flex-col items-start gap-1.5 text-xs text-[var(--destructive)]">
          {saveError}
          {saveError === STALE_DEPLOYMENT_MESSAGE && <ReloadAppButton className="min-h-[32px] px-3 text-xs" />}
        </div>
      )}
    </div>
  );
}

/**
 * A product's recipe: current lines, their cost, and — for `recipes.edit`
 * — the editor that versions a new set of them on save.
 *
 * Permission is enforced twice, per §41: `access` below only decides what
 * renders, and every server action this component can reach re-checks
 * `recipes.edit` itself regardless of what this prop says.
 */
export function ProductRecipeSection({
  productId,
  access,
  recipe,
  ingredientOptions,
}: {
  productId: string;
  access: Access;
  recipe: RecipeView;
  ingredientOptions: readonly RecipeIngredientOptionView[];
}) {
  if (access === "none") {
    return <PermissionDenied action="view this product's recipe" />;
  }

  if (!recipe.linked) {
    return (
      <EmptyState
        title="No recipe linked"
        detail={
          access === "edit"
            ? 'Availability cannot be inferred from stock until one exists — "sold out today" above is always a manual call.'
            : "No recipe has been created for this product yet."
        }
        action={access === "edit" ? <CreateRecipeForm productId={productId} /> : undefined}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {recipe.version === null ? "No version saved yet" : `Version ${recipe.version}`} — yields {recipe.yieldQuantity} {recipe.yieldQuantity === 1 ? "portion" : "portions"} per batch.
      </p>
      {access === "edit" ? (
        <RecipeEditor key={recipe.version ?? "draft"} productId={productId} yieldQuantity={recipe.yieldQuantity} initialLines={recipe.lines} ingredientOptions={ingredientOptions} />
      ) : (
        <ReadOnlyRecipe recipe={recipe} />
      )}
    </div>
  );
}
