"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/states";
import { ReloadAppButton } from "@/components/reload-app-button";
import { STALE_DEPLOYMENT_MESSAGE, isStaleDeploymentError } from "@/lib/errors/stale-deployment";

/** Inventory's own boundary, so a failed ingredient read says so in place rather than blanking the whole staff app. */
export default function InventoryError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = isStaleDeploymentError(error);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
      <ErrorState
        title={stale ? STALE_DEPLOYMENT_MESSAGE : "Inventory couldn't load"}
        detail={stale ? "This page was open before the last update. Reload to get the current build." : "The ingredient list didn't come back. Try again; if it keeps happening, reload the page."}
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            {!stale && (
              <button
                type="button"
                onClick={() => reset()}
                className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-5 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Try again
              </button>
            )}
            <ReloadAppButton variant={stale ? undefined : "ghost"} />
          </div>
        }
      />
    </div>
  );
}
