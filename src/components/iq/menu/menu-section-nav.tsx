import Link from "next/link";
import { cn } from "@/lib/utils";

export type MenuSection = "products" | "modifiers" | "combos" | "media" | "review";

const SECTIONS: readonly { readonly key: MenuSection; readonly label: string; readonly href: string; readonly needs?: "edit" | "publish" }[] = [
  { key: "products", label: "Products", href: "/app/iq/menu" },
  { key: "modifiers", label: "Modifiers", href: "/app/iq/menu/modifiers" },
  { key: "combos", label: "Combos", href: "/app/iq/menu/combos" },
  { key: "media", label: "Media", href: "/app/iq/menu/media", needs: "edit" },
  { key: "review", label: "Review changes", href: "/app/iq/menu/review", needs: "publish" },
];

/**
 * The one strip every Menu screen carries, so moving between products,
 * modifiers, combos, media and publishing is a tab away rather than a trip
 * back to the hub. Routes, not client tabs — each section is its own page
 * with its own permission gate, and a link keeps the URL honest.
 */
export function MenuSectionNav({ current, draftCount, canEdit, canPublish }: { current: MenuSection; draftCount: number; canEdit: boolean; canPublish: boolean }) {
  const visible = SECTIONS.filter((section) => (section.needs === "edit" ? canEdit : section.needs === "publish" ? canPublish : true));
  return (
    <nav aria-label="Menu sections" className="-mb-px flex max-w-full gap-1 overflow-x-auto border-b border-border">
      {visible.map((section) => {
        const active = section.key === current;
        const pending = section.key === "review" && draftCount > 0;
        return (
          <Link
            key={section.key}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-[13.5px] transition-colors duration-[120ms]",
              active ? "border-primary font-semibold text-foreground" : "border-transparent font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {section.label}
            {pending && <span className="tabular flex h-5 min-w-5 items-center justify-center rounded-full bg-flag-soft px-1.5 text-[11px] font-semibold text-flag">{draftCount}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
