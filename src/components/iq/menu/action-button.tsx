"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { ReloadAppButton } from "@/components/reload-app-button";
import { STALE_DEPLOYMENT_MESSAGE, recoverFromStaleDeployment } from "@/lib/errors/stale-deployment";

export interface ActionButtonResult {
  readonly ok: boolean;
  readonly error?: string;
}

/**
 * A button that calls a Server Action directly and shows its own pending
 * and error state — the Menu Manager's toggle/publish/delete/reorder
 * controls all share this rather than each growing its own `useActionState`
 * form, since none of them collect input beyond a confirm dialog.
 */
export function ActionButton({
  action,
  children,
  pendingLabel,
  confirmMessage,
  className,
  variant = "default",
  onSuccess,
}: {
  action: () => Promise<ActionButtonResult>;
  children: React.ReactNode;
  pendingLabel?: string;
  confirmMessage?: string;
  className?: string;
  variant?: "default" | "destructive" | "ghost";
  onSuccess?: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run() {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    startTransition(async () => {
      const result = await recoverFromStaleDeployment(action);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      setError(null);
      onSuccess?.();
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={run}
        disabled={isPending}
        className={cn(
          "inline-flex min-h-[36px] items-center rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-50",
          variant === "default" && "bg-secondary text-secondary-foreground hover:bg-secondary/80",
          variant === "destructive" && "text-[var(--destructive)] hover:bg-[var(--destructive)]/10",
          variant === "ghost" && "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
          className,
        )}
      >
        {isPending ? (pendingLabel ?? "…") : children}
      </button>
      {error && (
        <span role="alert" className="flex flex-col items-start gap-1.5 text-xs text-[var(--destructive)]">
          {error}
          {error === STALE_DEPLOYMENT_MESSAGE && <ReloadAppButton className="min-h-[32px] px-3 text-xs" />}
        </span>
      )}
    </span>
  );
}
