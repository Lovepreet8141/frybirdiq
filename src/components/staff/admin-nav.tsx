"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface AdminNavItem {
  readonly href: string;
  readonly label: string;
}

/**
 * Settings has one nav, drawn the same on every settings page: Restaurant,
 * Bill & Receipt, Printers, Audit log — whichever the person may see. The
 * active item carries the underline the Overview's section nav uses, so
 * the two families of screens read as one product.
 */
export function AdminNav({ items }: { items: readonly AdminNavItem[] }) {
  const pathname = usePathname();
  if (items.length < 2) return null;
  return (
    <nav aria-label="Settings" className="mx-auto w-full max-w-[1400px] px-[var(--gutter)] pt-5">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 border-b border-border pb-2.5 text-[14px] font-semibold text-muted-foreground">
        <span className="mr-1 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground/80 uppercase">Settings</span>
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={cn("transition-colors duration-[120ms] hover:text-foreground", active && "text-foreground shadow-[0_12px_0_-10px_var(--foreground)]")}>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
