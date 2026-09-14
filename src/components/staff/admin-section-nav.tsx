import Link from "next/link";
import { cn } from "@/lib/utils";

export type AdminSection = "restaurant" | "receipt" | "hardware" | "notifications" | "audit";

export interface AdminNavAccess {
  readonly canSeeSettings: boolean;
  readonly canSeeHardware: boolean;
  readonly canSeeAudit: boolean;
}

const SECTIONS: readonly { readonly key: AdminSection; readonly label: string; readonly href: string; readonly needs: keyof AdminNavAccess }[] = [
  { key: "restaurant", label: "Restaurant", href: "/app/admin/restaurant", needs: "canSeeSettings" },
  { key: "receipt", label: "Bill & Receipt", href: "/app/admin/receipt", needs: "canSeeSettings" },
  { key: "hardware", label: "Printers & devices", href: "/app/admin/hardware", needs: "canSeeHardware" },
  { key: "notifications", label: "Notifications", href: "/app/admin/notifications", needs: "canSeeSettings" },
  { key: "audit", label: "Audit log", href: "/app/admin/audit", needs: "canSeeAudit" },
];

/** The strip every Admin screen carries. Routes, not client tabs: each screen keeps its own permission gate. */
export function AdminSectionNav({ current, access }: { current: AdminSection; access: AdminNavAccess }) {
  const visible = SECTIONS.filter((section) => access[section.needs]);
  if (visible.length <= 1) return null;
  return (
    <nav aria-label="Admin sections" className="-mb-px flex max-w-full gap-1 overflow-x-auto border-b border-border">
      {visible.map((section) => {
        const active = section.key === current;
        return (
          <Link
            key={section.key}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-10 shrink-0 items-center border-b-2 px-3 text-[13.5px] transition-colors duration-[120ms]",
              active ? "border-primary font-semibold text-foreground" : "border-transparent font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
