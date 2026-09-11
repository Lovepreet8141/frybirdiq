"use client";

import { RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The one recovery action for a stale-deployment failure: a full page
 * reload, not a soft `router.refresh()`. A soft refresh re-renders Server
 * Components with fresh data but keeps the same client-side JS bundle — the
 * exact thing carrying the outdated Server Action reference that caused the
 * failure in the first place. Only a real navigation fetches the current
 * build.
 */
export function ReloadAppButton({ className, variant = "primary" }: { className?: string; variant?: "primary" | "ghost" }) {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className={cn(
        "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md px-5 text-sm font-bold transition-colors",
        variant === "primary" && "bg-primary text-primary-foreground hover:opacity-90",
        variant === "ghost" && "border border-border text-foreground hover:bg-surface-muted",
        className,
      )}
    >
      <RotateCw className="size-4" aria-hidden="true" />
      Reload FRYBIRD IQ
    </button>
  );
}
