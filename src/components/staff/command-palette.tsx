"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { NavGroup } from "./nav-items";

/**
 * Jump to any live staff page from anywhere, keyboard-first.
 *
 * Foundation only, as scoped for this pass: results are today's real
 * navigable destinations, permission-filtered the same way the sidebar is —
 * driven by the exact same `buildNavGroups` list, so this can never list a
 * page the sidebar hides or vice versa. It is not yet a search over orders,
 * customers or products; that needs its own repository-backed query
 * (permission-checked per result, per §23) and is scoped as a later slice
 * rather than bolted on here.
 */
export function CommandPalette({ groups }: { groups: readonly NavGroup[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-2 rounded-lg border border-border bg-panel px-3 text-[13px] text-muted-foreground transition-colors duration-[120ms] hover:border-border-strong hover:text-foreground focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 sm:w-[220px] lg:w-[260px]"
      >
        <SearchIcon className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">Search or jump to…</span>
        <kbd className="ml-auto hidden rounded border border-border bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold sm:inline">
          &#8984;K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen} title="Jump to" description="Search staff pages">
        <CommandInput placeholder="Jump to a page…" />
        <CommandList>
          <CommandEmpty>No matching page.</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group.id} heading={group.label}>
              {group.items.map((item) => (
                <CommandItem key={item.href} value={item.label} onSelect={() => go(item.href)}>
                  <item.icon className="size-4" aria-hidden="true" />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
