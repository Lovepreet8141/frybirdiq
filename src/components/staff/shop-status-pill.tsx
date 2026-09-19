"use client";

import Link from "next/link";
import { CircleCheck, Clock, PauseCircle } from "lucide-react";
import { useState } from "react";
import { useShopSwitch } from "@/components/shop/use-shop-switch";
import { sinceLabel } from "@/components/pos/shop-switch-view";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { type PillDetail, type PillView, pillDetail, pillView } from "@/lib/orders/shop-pill";
import type { StaffOrderingStatus } from "@/lib/repositories/shop-status";
import { cn } from "@/lib/utils";

const ICONS = { check: CircleCheck, clock: Clock, pause: PauseCircle } as const;
const DOTS = { green: "bg-success", grey: "bg-muted-foreground", red: "bg-destructive" } as const;

/** The pill face: dot + icon + text; at phone width only the dot and one word. Exported so the states can be tested as markup. */
export function PillFace({ view }: { view: PillView }) {
  const Icon = ICONS[view.icon];
  return (
    <>
      <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-full", DOTS[view.dot])} />
      <Icon className="hidden size-4 shrink-0 sm:block" aria-hidden="true" />
      <span data-pill-long className="hidden whitespace-nowrap sm:inline">
        {view.long}
      </span>
      <span data-pill-short className="sm:hidden">
        {view.short}
      </span>
    </>
  );
}

/**
 * What opens from the pill: the status, and ONE primary action. Roles that
 * cannot close the shop get the status only (`canSwitch` false, no button).
 * Exported so the read-only role can be tested as markup.
 */
export function PillPanel({
  view,
  detail,
  canSwitch,
  canEditHours,
  onSwitchOff,
  onSwitchOn,
  busy,
}: {
  view: PillView;
  detail: PillDetail;
  canSwitch: boolean;
  canEditHours: boolean;
  onSwitchOff: () => void;
  onSwitchOn: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-base font-semibold leading-snug">{detail.statusLine}</p>
      <div className="flex flex-col gap-1 text-sm text-muted-foreground">
        {detail.byLine && <p>{detail.byLine}</p>}
        {detail.reasonLine && <p className="break-words">{detail.reasonLine}</p>}
        <p>{detail.hoursLine}</p>
        <p>{detail.notFinishedLine}</p>
        {detail.closedDayLine && <p>{detail.closedDayLine}</p>}
      </div>

      {canSwitch ? (
        view.state === "off" ? (
          <button type="button" onClick={onSwitchOn} disabled={busy} className="min-h-[48px] rounded-md bg-inverse px-4 text-sm font-semibold text-inverse-foreground disabled:opacity-60">
            Switch orders back on
          </button>
        ) : (
          <button type="button" onClick={onSwitchOff} disabled={busy} className="min-h-[48px] rounded-md border border-destructive/50 bg-destructive/10 px-4 text-sm font-semibold text-foreground disabled:opacity-60">
            Switch online orders off…
          </button>
        )
      ) : (
        <p className="text-sm text-muted-foreground">Only a manager can switch online orders off or on.</p>
      )}

      {canEditHours && (
        <Link href="/app/admin/restaurant" className="inline-flex min-h-[44px] items-center text-sm font-semibold underline underline-offset-2">
          Edit opening hours
        </Link>
      )}
    </div>
  );
}

/**
 * The shop status pill in the staff top bar (owner card, Release 3): a shortcut
 * to the existing Close Shop control. Same server actions, same dialog, same
 * state as the POS switch (`useShopSwitch`), and the full panel stays in
 * Admin → Restaurant. Popover on desktop, bottom sheet on a phone.
 */
export interface ShopStatusPillProps {
  initialStatus: StaffOrderingStatus;
  /** The server's clock at render, so the first client render words times as the server did. */
  renderedAt: string;
  /** orders.update. The action checks again on every call; this only decides whether to offer the button. */
  canSwitch: boolean;
  /** settings.manage: the Admin page it links to needs it. */
  canEditHours: boolean;
  hours: { opens: string; closes: string };
}

export function ShopStatusPill({ initialStatus, renderedAt, canSwitch, canEditHours, hours }: ShopStatusPillProps) {
  const shop = useShopSwitch({ initialStatus, renderedAt, canSwitch });
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const view = pillView(shop.status, shop.now);
  const detail = pillDetail(shop.status, shop.now, hours, sinceLabel);

  const panel = (
    <PillPanel
      view={view}
      detail={detail}
      canSwitch={canSwitch}
      canEditHours={canEditHours}
      busy={shop.isPending || !shop.online}
      onSwitchOff={() => {
        setOpen(false);
        shop.openPause();
      }}
      onSwitchOn={() => {
        setOpen(false);
        shop.openResume();
      }}
    />
  );

  const trigger = (
    <button
      type="button"
      aria-label={`Shop status: ${view.long}`}
      className={cn(
        "inline-flex min-h-[44px] touch-manipulation items-center gap-2 rounded-md border px-3 text-sm font-semibold text-foreground transition-colors hover:bg-surface-muted",
        view.state === "off" ? "border-destructive/50 bg-destructive/10" : "border-border",
      )}
    >
      <PillFace view={view} />
    </button>
  );

  return (
    <>
      {isMobile ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>{trigger}</SheetTrigger>
          <SheetContent side="bottom" className="gap-3 rounded-t-xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <SheetHeader className="p-0">
              <SheetTitle>{view.long}</SheetTitle>
              <SheetDescription className="sr-only">Shop status and the switch for online orders</SheetDescription>
            </SheetHeader>
            {panel}
          </SheetContent>
        </Sheet>
      ) : (
        <Popover open={open} onOpenChange={setOpen} modal>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent>{panel}</PopoverContent>
        </Popover>
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {shop.announcement}
      </span>
      {shop.dialogs}
    </>
  );
}
