"use client";

import { Minus, Plus } from "lucide-react";
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group";
import { cn } from "@/lib/utils";

/**
 * The purchased `button-group14` quantity selector — a fused − / count / +
 * control — with two POS rules applied: every target is the till's 56 px
 * (§7, wet hands, not the 44 px web floor), and the count is read-only. A
 * keyboard on a touchscreen is slower than two taps, and a typed "50" is
 * how a wrong order gets cooked.
 */
export function QuantityStepper({ value, min = 1, max = 50, name, onChange, className }: { value: number; min?: number; max?: number; name: string; onChange: (next: number) => void; className?: string }) {
  const button = "flex size-[56px] touch-manipulation select-none items-center justify-center border border-border bg-panel transition-colors duration-[var(--duration-micro)] hover:border-border-strong active:bg-surface-muted disabled:opacity-40 first:rounded-l-md last:rounded-r-md";
  return (
    <ButtonGroup aria-label={`Quantity of ${name}`} className={cn("h-[56px]", className)}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} className={button} aria-label={`One fewer ${name}`}>
        <Minus className="size-5" aria-hidden="true" />
      </button>
      <ButtonGroupText className="tabular min-w-[56px] justify-center rounded-none border-border bg-panel px-2 text-[17px] font-semibold" aria-live="polite">
        {value}
      </ButtonGroupText>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} className={button} aria-label={`One more ${name}`}>
        <Plus className="size-5" aria-hidden="true" />
      </button>
    </ButtonGroup>
  );
}
