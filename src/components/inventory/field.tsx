import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

/**
 * One labelled field, the way the purchased `form-layout1` block lays them
 * out: label, control, optional helper line. Controls are the app's own
 * native inputs on the IQ kit's 40px field (`Input` primitive), with the
 * same 3px brand focus ring.
 */
export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-[13px] font-semibold">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[12.5px] leading-[1.4] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export const inputClass =
  "h-10 w-full rounded-md border border-border bg-panel px-3 text-sm outline-none transition-[border-color,box-shadow] duration-[120ms] placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 disabled:opacity-60";
export const selectClass = inputClass;

/** The one submit style inventory forms share: the panel's own primary, in ink. */
export const submitClass = "inline-flex h-9 items-center rounded-md bg-inverse px-4 text-sm font-semibold text-inverse-foreground transition-colors duration-[120ms] hover:bg-inverse/85 disabled:opacity-60";
/** Result lines: a 2px rule in the signal colour on the panel. */
export const errorNoteClass = "rounded-md border-l-2 border-loss bg-loss-soft/60 px-4 py-3 text-sm";
export const successNoteClass = "rounded-md border-l-2 border-gain bg-gain-soft/60 px-4 py-3 text-sm";
