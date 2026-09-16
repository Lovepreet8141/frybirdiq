import { cn } from "@/lib/utils";
import type { VegClass } from "@/db/menu-data";

/**
 * The veg / non-veg mark.
 *
 * Legally required on Indian menus and a hard filter for a large share of the
 * customers, so it is never decoration and never optional. The colour is
 * backed by a text alternative — §55 and design-system/accessibility.md both
 * forbid colour as the only signal, and roughly one man in twelve has some
 * colour vision deficiency.
 */
export function VegMark({
  veg,
  className,
  /** "stage" swaps the veg green for --stage-veg (5.19:1 on --stage-yellow) — the default green is tuned for cream and drops to 1.86:1 there. Non-veg's red already passes on yellow unchanged. */
  tone = "default",
}: {
  veg: VegClass;
  className?: string;
  tone?: "default" | "stage";
}) {
  const isVeg = veg === "VEG";
  const vegColor = tone === "stage" ? "border-[var(--stage-veg)]" : "border-[#3F9D52]";
  const vegDot = tone === "stage" ? "bg-[var(--stage-veg)]" : "bg-[#3F9D52]";
  return (
    <span
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center border-2",
        isVeg ? vegColor : "border-[#8E1409]",
        className,
      )}
      role="img"
      aria-label={isVeg ? "Vegetarian" : "Non-vegetarian"}
      title={isVeg ? "Vegetarian" : "Non-vegetarian"}
    >
      <span className={cn("size-2 rounded-full", isVeg ? vegDot : "bg-[#8E1409]")} aria-hidden="true" />
    </span>
  );
}

const HEAT_WORDS = ["Not spicy", "Mild", "Medium", "Hot", "Very hot", "Fiery"] as const;

/**
 * Heat level, 0–5.
 *
 * Drawn as filled marks rather than chillies-as-emoji — §4 of the UX rules is
 * explicit that emoji are not icons. The level is also written out for screen
 * readers, so heat never depends on counting shapes.
 */
export function SpiceMark({ level, className }: { level: number; className?: string }) {
  const clamped = Math.max(0, Math.min(5, Math.round(level)));
  if (clamped === 0) return null;

  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} role="img" aria-label={HEAT_WORDS[clamped]}>
      {Array.from({ length: clamped }, (_, index) => (
        <span key={index} className="block h-3 w-1 rounded-full bg-secondary" aria-hidden="true" />
      ))}
    </span>
  );
}
