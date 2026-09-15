"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { adjustStockAction, countStockAction, receiveStockAction } from "@/lib/inventory/stock-actions";
import { type InventoryFormState } from "@/lib/inventory/actions";
import { purchaseUnitsFor, type BaseUnit } from "@/lib/iq/units";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field, errorNoteClass, inputClass, selectClass, submitClass, successNoteClass } from "./field";
import type { SupplierOption } from "./ingredient-form";

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={submitClass}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function Result({ state }: { state: InventoryFormState }) {
  if (state.status === "error") {
    return (
      <p role="alert" className={errorNoteClass}>
        {state.message}
      </p>
    );
  }
  if (state.status === "success") {
    return (
      <p role="status" className={successNoteClass}>
        {state.message}
      </p>
    );
  }
  return null;
}

function UnitSelect({ id, name, baseUnit }: { id: string; name: string; baseUnit: BaseUnit }) {
  const units = purchaseUnitsFor(baseUnit);
  return (
    <select id={id} name={name} defaultValue={units[units.length - 1]?.unit ?? baseUnit} className={selectClass}>
      {units.map((conversion) => (
        <option key={conversion.unit} value={conversion.unit}>
          {conversion.label}
        </option>
      ))}
    </select>
  );
}

/** "10 kg for ₹2,800." The same shape as recording a price, because receiving stock always records one — see `receiveStockAction`. */
function ReceiveForm({ ingredientId, baseUnit, suppliers, defaultSupplierId }: { ingredientId: string; baseUnit: BaseUnit; suppliers: readonly SupplierOption[]; defaultSupplierId: string | null }) {
  const [state, action] = useActionState<InventoryFormState, FormData>(receiveStockAction, { status: "idle" });

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="ingredientId" value={ingredientId} />
      <Result state={state} />

      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr]">
        <Field id="receive-qty" label="Received">
          <input id="receive-qty" name="purchaseQuantity" inputMode="numeric" required placeholder="10" className={inputClass} />
        </Field>
        <Field id="receive-unit" label="Unit">
          <UnitSelect id="receive-unit" name="purchaseUnit" baseUnit={baseUnit} />
        </Field>
        <Field id="receive-cost" label="For ₹">
          <input id="receive-cost" name="purchaseCost" inputMode="decimal" required placeholder="2800" className={inputClass} />
        </Field>
      </div>

      <Field id="receive-supplier" label="From">
        <select id="receive-supplier" name="supplierId" defaultValue={defaultSupplierId ?? ""} className={selectClass}>
          <option value="">Not recorded</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </Field>

      <Field id="receive-notes" label="Notes" hint="Optional — a delivery note number, condition on arrival.">
        <input id="receive-notes" name="notes" maxLength={300} className={inputClass} />
      </Field>

      <div className="flex justify-end">
        <Submit label="Record delivery" pendingLabel="Recording…" />
      </div>
    </form>
  );
}

/** A manual correction — found or missing stock with no purchase, waste or count behind it. The reason is required. */
function AdjustForm({ ingredientId, baseUnit }: { ingredientId: string; baseUnit: BaseUnit }) {
  const [state, action] = useActionState<InventoryFormState, FormData>(adjustStockAction, { status: "idle" });

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="ingredientId" value={ingredientId} />
      <Result state={state} />

      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr]">
        <Field id="adjust-direction" label="Direction">
          <select id="adjust-direction" name="direction" defaultValue="ADD" className={selectClass}>
            <option value="ADD">Add stock</option>
            <option value="REMOVE">Remove stock</option>
          </select>
        </Field>
        <Field id="adjust-qty" label="Quantity">
          <input id="adjust-qty" name="quantity" inputMode="decimal" required placeholder="0.6" className={inputClass} />
        </Field>
        <Field id="adjust-unit" label="Unit">
          <UnitSelect id="adjust-unit" name="unit" baseUnit={baseUnit} />
        </Field>
      </div>

      <Field id="adjust-notes" label="Reason" hint="Required — why this correction is happening.">
        <input id="adjust-notes" name="notes" required maxLength={300} placeholder="Found an uncounted case in the walk-in" className={inputClass} />
      </Field>

      <div className="flex justify-end">
        <Submit label="Record adjustment" pendingLabel="Recording…" />
      </div>
    </form>
  );
}

/** A physical count. The server computes the delta against on-hand and writes exactly that as one adjustment — never the raw counted figure. */
function CountForm({ ingredientId, baseUnit }: { ingredientId: string; baseUnit: BaseUnit }) {
  const [state, action] = useActionState<InventoryFormState, FormData>(countStockAction, { status: "idle" });

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="ingredientId" value={ingredientId} />
      <Result state={state} />

      <div className="grid gap-4 sm:grid-cols-[1fr_1fr]">
        <Field id="count-qty" label="Counted" hint="What's actually on the shelf right now.">
          <input id="count-qty" name="countedQuantity" inputMode="decimal" required placeholder="9.4" className={inputClass} />
        </Field>
        <Field id="count-unit" label="Unit">
          <UnitSelect id="count-unit" name="unit" baseUnit={baseUnit} />
        </Field>
      </div>

      <Field id="count-notes" label="Notes" hint="Optional — spot check, end-of-day count, and so on.">
        <input id="count-notes" name="notes" maxLength={300} className={inputClass} />
      </Field>

      <div className="flex justify-end">
        <Submit label="Record count" pendingLabel="Recording…" />
      </div>
    </form>
  );
}

/**
 * Receive, adjust and count, behind one set of tabs so the ingredient page
 * doesn't grow a fourth stacked panel for what is really one concern: "stock
 * moved." Every tab's action re-checks `inventory.adjust` itself — this
 * component only decides what's offered, never what's allowed (§41).
 */
export function StockMovementForms({ ingredientId, baseUnit, suppliers, defaultSupplierId }: { ingredientId: string; baseUnit: BaseUnit; suppliers: readonly SupplierOption[]; defaultSupplierId: string | null }) {
  return (
    <Tabs defaultValue="receive" className="flex flex-col gap-4">
      <TabsList variant="line" className="h-8 w-fit">
        <TabsTrigger value="receive" className="text-[12.5px]">
          Receive
        </TabsTrigger>
        <TabsTrigger value="adjust" className="text-[12.5px]">
          Adjust
        </TabsTrigger>
        <TabsTrigger value="count" className="text-[12.5px]">
          Count
        </TabsTrigger>
      </TabsList>
      <TabsContent value="receive">
        <ReceiveForm ingredientId={ingredientId} baseUnit={baseUnit} suppliers={suppliers} defaultSupplierId={defaultSupplierId} />
      </TabsContent>
      <TabsContent value="adjust">
        <AdjustForm ingredientId={ingredientId} baseUnit={baseUnit} />
      </TabsContent>
      <TabsContent value="count">
        <CountForm ingredientId={ingredientId} baseUnit={baseUnit} />
      </TabsContent>
    </Tabs>
  );
}
