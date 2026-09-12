import type { ReactNode } from "react";

/**
 * One setting: what it is, what it means, what it's set to. The row layout
 * is adapted from the purchased `switch-card1` block (label + description
 * on the left, control on the right) with a value in place of the switch —
 * these are read, not toggled.
 */
export function SettingRow({ label, description, value }: { label: string; description?: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-lg border border-border p-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-base font-medium">{label}</span>
        {description && <span className="text-sm text-muted-foreground">{description}</span>}
      </div>
      <div className="tabular text-right text-base font-semibold">{value}</div>
    </div>
  );
}
