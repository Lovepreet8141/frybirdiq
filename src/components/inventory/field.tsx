import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

/**
 * One labelled field, the way the purchased `form-layout1` block lays them
 * out: label, control, optional helper line. Controls are the app's own
 * native inputs styled to the 44px operational minimum.
 */
export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-sm font-semibold">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export const inputClass = "h-[44px] w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const selectClass = inputClass;
