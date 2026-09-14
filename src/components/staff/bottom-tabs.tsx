"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import type { NavGroup, NavItem } from "./nav-items";

/**
 * The phone shell: four destinations and More, fixed to the bottom, the
 * way a hand holds a phone. Which four is decided by the same nav the
 * sidebar renders — the first items of the Operations group the person is
 * allowed to see — so a page never appears here that is missing there.
 * More opens the full sidebar as a sheet. Hidden from md up.
 */
export function BottomTabs({ groups }: { groups: readonly NavGroup[] }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const preferred = ["/app/iq", "/app/orders", "/app/pos", "/app/kds", "/app/iq/live", "/app/deliveries", "/app/customers"];
  const all = groups.flatMap((group) => group.items);
  const items = preferred.map((href) => all.find((item) => item.href === href)).filter((item): item is NavItem => Boolean(item)).slice(0, 4);
  if (items.length === 0) return null;

  const isActive = (item: NavItem) => {
    const on = pathname === item.href || pathname.startsWith(`${item.href}/`);
    const excluded = (item.exclude ?? []).some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
    return on && !excluded;
  };

  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden print:hidden">
      {items.map((item) => {
        const active = isActive(item);
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={cn("flex min-h-[56px] flex-col items-center justify-center gap-1 text-[10.5px] font-semibold transition-colors duration-[120ms]", active ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
            <item.icon aria-hidden="true" className="size-5" />
            <span className="truncate px-1">{item.label}</span>
          </Link>
        );
      })}
      <button type="button" onClick={() => setOpenMobile(true)} className="flex min-h-[56px] flex-col items-center justify-center gap-1 text-[10.5px] font-semibold text-muted-foreground hover:text-foreground">
        <MoreHorizontal aria-hidden="true" className="size-5" />
        More
      </button>
    </nav>
  );
}
