/**
 * The states §56 says every interactive feature needs, as components so they
 * are harder to skip than to include.
 *
 *   default  loading  success  error
 *   empty    disabled offline  permission denied
 *
 * `offline` and `permission denied` are the two that get left out, and the two
 * this product cannot leave out: §20 makes the POS offline-first, and §41 is
 * explicit that hiding a button is not authorization.
 *
 * The shell is the purchased kit's `Empty` composition (media · title ·
 * description · content), so every empty, error, offline and denied state on
 * every screen shares one anatomy. Copy follows design-system/content.md —
 * say what happened, then what to do. No "oops", no jokes, no exclamation
 * marks, and offline never offers "try again": queued orders sync on their
 * own when the connection returns (§57).
 */

import { AlertTriangle, Inbox, Lock, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function Shell({
  icon,
  title,
  detail,
  action,
  tone = "neutral",
  className,
}: {
  icon: ReactNode;
  title: string;
  detail?: string;
  action?: ReactNode;
  tone?: "neutral" | "warning" | "error";
  className?: string;
}) {
  return (
    <Empty className={cn("border border-dashed border-border-strong/70 bg-panel px-6 py-10", className)}>
      <EmptyHeader>
        <EmptyMedia
          variant="icon"
          className={cn(
            "mb-0 size-10 rounded-full [&_svg:not([class*='size-'])]:size-5",
            tone === "neutral" && "bg-surface-muted text-muted-foreground",
            tone === "warning" && "bg-warning/15 text-warning",
            // Ember fails AA as text on charred, so the destructive tone tints a
            // container and keeps the glyph readable rather than colouring copy.
            tone === "error" && "bg-destructive/20 text-foreground",
          )}
        >
          {icon}
        </EmptyMedia>
        <EmptyTitle className="text-[15px] font-semibold">{title}</EmptyTitle>
        {detail && <EmptyDescription className="text-[13px] leading-[1.5]">{detail}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent className="gap-2">{action}</EmptyContent>}
    </Empty>
  );
}

/**
 * Says what would be here and how to get it. Never a blank panel.
 *
 * A dashboard with no sales says "No sales recorded today", not ₹0 — those are
 * different facts and the owner has to tell them apart.
 */
export function EmptyState({
  title,
  detail,
  action,
  className,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
  className?: string;
}) {
  return <Shell icon={<Inbox />} title={title} detail={detail} action={action} className={className} />;
}

/** Says what failed and what to do next. Never makes failure look like success. */
export function ErrorState({
  title = "Something didn't work",
  detail,
  action,
  className,
}: {
  title?: string;
  detail?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div role="alert">
      <Shell icon={<AlertTriangle />} title={title} detail={detail} action={action} tone="error" className={className} />
    </div>
  );
}

/**
 * The POS is offline. §57's exact copy.
 *
 * `queued` is shown because a cashier needs to know the orders are not lost —
 * that is the entire promise of §20. No retry button: syncing is automatic.
 */
export function OfflineState({ queued, className }: { queued?: number; className?: string }) {
  return (
    <div role="status" aria-live="polite">
      <Shell
        icon={<WifiOff />}
        title="You're offline"
        detail={queued ? `New orders will sync when connection returns. ${queued} waiting.` : "New orders will sync when connection returns."}
        tone="warning"
        className={className}
      />
    </div>
  );
}

/**
 * An honest message rather than a hidden button.
 *
 * §41: "Never rely only on hiding UI buttons." The server has already refused;
 * this explains the refusal instead of pretending the action never existed.
 */
export function PermissionDenied({
  action = "do that",
  detail = "Ask an owner or manager if you need access.",
  className,
}: {
  action?: string;
  detail?: string;
  className?: string;
}) {
  return <Shell icon={<Lock />} title={`You don't have permission to ${action}`} detail={detail} className={className} />;
}

/**
 * Content loading.
 *
 * A skeleton in the shape of what is coming, so the layout does not jump when
 * it arrives — §48 targets CLS below 0.1, and a spinner that becomes a table
 * is how that budget gets spent.
 */
export function LoadingState({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3", className)} role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}
