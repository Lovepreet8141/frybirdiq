"use client";

/**
 * Draft a purchase order. Same idiom `ProductRecipeSection`'s `RecipeEditor`
 * uses for its own variable-length line list (`src/components/iq/menu/
 * product-recipe-section.tsx`): local draft state only, nothing reaches the
 * server until "Create purchase order" is pressed, at which point the whole
 * line set is sent as one call — never a per-line write.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPurchaseOrderAction } from "@/lib/inventory/purchase-order-actions";
import { ReloadAppButton } from "@/components/reload-app-button";
import { STALE_DEPLOYMENT_MESSAGE, recoverFromStaleDeployment } from "@/lib/errors/stale-deployment";
import { EmptyState } from "@/components/states";
import { purchaseUnitsFor, type BaseUnit } from "@/lib/iq/units";
import type { Unit } from "@/db/schema/inventory";
import { Field, errorNoteClass, inputClass, selectClass, submitClass } from "./field";

export interface PurchaseOrderIngredientOption {
  readonly id: string;
  readonly name: string;
  readonly baseUnit: BaseUnit;
  readonly isPackaging: boolean;
}

export interface PurchaseOrderSupplierOption {
  readonly id: string;
  readonly name: string;
}

interface DraftLine {
  readonly key: string;
  readonly ingredientId: string;
  readonly quantity: string;
  readonly unit: Unit;
  readonly unitCost: string;
}

export function PurchaseOrderForm({
  suppliers,
  ingredients,
}: {
  suppliers: readonly PurchaseOrderSupplierOption[];
  ingredients: readonly PurchaseOrderIngredientOption[];
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [reference, setReference] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [draftLines, setDraftLines] = useState<readonly DraftLine[]>([]);
  const [selectedIngredientId, setSelectedIngredientId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  const ingredientMap = useMemo(() => new Map(ingredients.map((option) => [option.id, option])), [ingredients]);
  const availableToAdd = ingredients.filter((option) => !draftLines.some((line) => line.ingredientId === option.id));

  function addLine() {
    const ingredient = ingredientMap.get(selectedIngredientId);
    if (!ingredient) return;
    const units = purchaseUnitsFor(ingredient.baseUnit);
    setDraftLines((lines) => [
      ...lines,
      { key: `${ingredient.id}-${lines.length}`, ingredientId: ingredient.id, quantity: "", unit: units[units.length - 1]?.unit ?? ingredient.baseUnit, unitCost: "" },
    ]);
    setSelectedIngredientId("");
  }

  function removeLine(key: string) {
    setDraftLines((lines) => lines.filter((line) => line.key !== key));
  }

  function updateLine(key: string, patch: Partial<Omit<DraftLine, "key" | "ingredientId">>) {
    setDraftLines((lines) => lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function save() {
    setError(null);
    if (!supplierId) {
      setError("Choose a supplier.");
      return;
    }
    if (draftLines.length === 0) {
      setError("Add at least one line.");
      return;
    }
    for (const line of draftLines) {
      if (!/^\d+$/.test(line.quantity) || Number(line.quantity) <= 0) {
        setError(`Enter a whole-number quantity for ${ingredientMap.get(line.ingredientId)?.name ?? "a line"}.`);
        return;
      }
      if (!/^\d+(\.\d{1,2})?$/.test(line.unitCost) || Number(line.unitCost) <= 0) {
        setError(`Enter a cost per unit for ${ingredientMap.get(line.ingredientId)?.name ?? "a line"}.`);
        return;
      }
    }

    startSaving(async () => {
      const result = await recoverFromStaleDeployment(() =>
        createPurchaseOrderAction({
          supplierId,
          reference: reference.trim() ? reference.trim() : null,
          expectedAt: expectedAt ? new Date(expectedAt).toISOString() : null,
          lines: draftLines.map((line) => ({ ingredientId: line.ingredientId, quantity: Number(line.quantity), unit: line.unit, unitCost: line.unitCost })),
        }),
      );
      if (!result.ok) {
        setError(result.error ?? "Could not create the purchase order.");
        return;
      }
      if (result.id) router.push(`/app/inventory/purchase-orders/${result.id}?created=1`);
    });
  }

  if (suppliers.length === 0) {
    return <EmptyState title="No suppliers yet" detail="Add a supplier before drafting a purchase order." />;
  }
  if (ingredients.length === 0) {
    return <EmptyState title="No ingredients yet" detail="Add ingredients before drafting a purchase order." />;
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div role="alert" className={errorNoteClass}>
          {error}
          {error === STALE_DEPLOYMENT_MESSAGE && <ReloadAppButton className="mt-2 min-h-[32px] px-3 text-xs" />}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="po-supplier" label="Supplier">
          <select id="po-supplier" value={supplierId} onChange={(event) => setSupplierId(event.target.value)} className={selectClass}>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="po-reference" label="Reference" hint="Optional — a delivery note or order number.">
          <input id="po-reference" value={reference} onChange={(event) => setReference(event.target.value)} maxLength={120} className={inputClass} />
        </Field>
        <Field id="po-expected" label="Expected" hint="Optional.">
          <input id="po-expected" type="date" value={expectedAt} onChange={(event) => setExpectedAt(event.target.value)} className={inputClass} />
        </Field>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        {draftLines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No lines yet — add ingredients below.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {draftLines.map((line) => {
              const ingredient = ingredientMap.get(line.ingredientId);
              const units = ingredient ? purchaseUnitsFor(ingredient.baseUnit) : [];
              return (
                <li key={line.key} className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface-muted px-3 py-2">
                  <span className="min-w-[140px] pb-2.5 text-sm font-medium">{ingredient?.name ?? "Unknown ingredient"}</span>
                  <Field id={`po-line-qty-${line.key}`} label="Quantity">
                    <input
                      id={`po-line-qty-${line.key}`}
                      inputMode="numeric"
                      value={line.quantity}
                      onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                      placeholder="10"
                      className={`${inputClass} w-24`}
                    />
                  </Field>
                  <Field id={`po-line-unit-${line.key}`} label="Unit">
                    <select
                      id={`po-line-unit-${line.key}`}
                      value={line.unit}
                      onChange={(event) => updateLine(line.key, { unit: event.target.value as Unit })}
                      className={`${selectClass} w-24`}
                    >
                      {units.map((conversion) => (
                        <option key={conversion.unit} value={conversion.unit}>
                          {conversion.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id={`po-line-cost-${line.key}`} label="Cost per unit (₹)">
                    <input
                      id={`po-line-cost-${line.key}`}
                      inputMode="decimal"
                      value={line.unitCost}
                      onChange={(event) => updateLine(line.key, { unitCost: event.target.value })}
                      placeholder="280"
                      className={`${inputClass} w-28`}
                    />
                  </Field>
                  <button type="button" onClick={() => removeLine(line.key)} className="pb-2.5 text-xs font-semibold text-[var(--destructive)] hover:underline">
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <Field id="po-add-ingredient" label="Add ingredient">
            <select
              id="po-add-ingredient"
              value={selectedIngredientId}
              onChange={(event) => setSelectedIngredientId(event.target.value)}
              disabled={availableToAdd.length === 0}
              className={`${selectClass} min-w-[200px]`}
            >
              <option value="">Choose an ingredient…</option>
              {availableToAdd.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                  {option.isPackaging ? " (packaging)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <button
            type="button"
            onClick={addLine}
            disabled={!selectedIngredientId}
            className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-semibold hover:bg-surface-muted disabled:opacity-50"
          >
            Add line
          </button>
        </div>
        {availableToAdd.length === 0 && draftLines.length > 0 && <p className="text-xs text-muted-foreground">Every ingredient is already on this order.</p>}
      </div>

      <div className="flex justify-end border-t border-border pt-4">
        <button type="button" disabled={isSaving} onClick={save} className={submitClass}>
          {isSaving ? "Creating…" : "Create purchase order"}
        </button>
      </div>
    </div>
  );
}
