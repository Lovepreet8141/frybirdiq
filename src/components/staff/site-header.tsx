"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { CommandPalette } from "@/components/staff/command-palette";
import type { NavGroup } from "@/components/staff/nav-items";
import { SectionBreadcrumb } from "@/components/staff/section-breadcrumb";
import { SoundCheck } from "@/components/staff/sound-check";
import { UserMenu } from "@/components/staff/user-menu";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import type { Role } from "@/domain/permissions";

/**
 * The header of every sidebar page: 56px, one hairline, the panel ground.
 * Left: the collapse toggle and where-you-are. Right: search (⌘K), the
 * alarm check, the account menu. Page-level actions belong to the page's
 * own header, not here, so the chrome is the same on every screen.
 */
export function SiteHeader({
  groups,
  canSeeOrders,
  staff,
}: {
  groups: readonly NavGroup[];
  canSeeOrders: boolean;
  staff: { displayName: string | null; roles: readonly Role[] };
}) {
  const { toggleSidebar, open, openMobile, isMobile } = useSidebar();
  const expanded = isMobile ? openMobile : open;

  return (
    <header className="sticky top-0 z-40 flex h-(--header-height) shrink-0 items-center border-b border-border bg-panel/85 backdrop-blur-md md:rounded-t-xl print:hidden">
      <div className="flex w-full items-center gap-1.5 px-3 md:px-4">
        <Button onClick={toggleSidebar} size="icon-sm" variant="ghost" aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"} className="text-muted-foreground">
          {expanded ? <PanelLeftClose /> : <PanelLeftOpen />}
        </Button>
        <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden="true" />
        <SectionBreadcrumb />

        <div className="ml-auto flex items-center gap-2">
          <CommandPalette groups={groups} />
          {canSeeOrders && <SoundCheck />}
          <span className="mx-0.5 hidden h-4 w-px bg-border sm:block" aria-hidden="true" />
          <UserMenu displayName={staff.displayName} roles={staff.roles} />
        </div>
      </div>
    </header>
  );
}
