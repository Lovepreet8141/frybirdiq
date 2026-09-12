"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { CommandPalette } from "@/components/staff/command-palette";
import type { NavGroup } from "@/components/staff/nav-items";
import { SectionBreadcrumb } from "@/components/staff/section-breadcrumb";
import { SoundCheck } from "@/components/staff/sound-check";
import { UserMenu } from "@/components/staff/user-menu";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useSidebar } from "@/components/ui/sidebar";
import type { Role } from "@/domain/permissions";

/**
 * The header of every sidebar page, in the kit's shape
 * (`shadcn-ui-kit-dashboard/components/layout/header`): the kit's height
 * (`--header-height`, set on the provider), sticky with a blurred ground,
 * one hairline below, rounded top corners so it sits inside the inset panel.
 *
 * Left: the collapse toggle and where-you-are. Right: what was already
 * there — search, the alarm check, the account menu. The kit's store
 * switcher, notifications, theme switch and customizer are not here; none
 * of them is a real FRYBIRD feature.
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
    <header className="sticky top-0 z-50 flex h-(--header-height) shrink-0 items-center gap-2 border-b border-border bg-background/40 backdrop-blur-md transition-[width,height] ease-linear md:rounded-tl-xl md:rounded-tr-xl print:hidden">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2">
        <Button onClick={toggleSidebar} size="icon" variant="ghost" aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}>
          {expanded ? <PanelLeftClose /> : <PanelLeftOpen />}
        </Button>
        <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center" />
        <SectionBreadcrumb />

        <div className="ml-auto flex items-center gap-2">
          <CommandPalette groups={groups} />
          {canSeeOrders && <SoundCheck />}
          <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center" />
          <UserMenu displayName={staff.displayName} roles={staff.roles} />
        </div>
      </div>
    </header>
  );
}
