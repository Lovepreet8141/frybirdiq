"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/states";
import { ReloadAppButton } from "@/components/reload-app-button";
import { isStaleDeploymentError, STALE_DEPLOYMENT_MESSAGE } from "@/lib/errors/stale-deployment";

/**
 * The staff app's error boundary — everything under `/app/**` (Menu
 * Manager, POS, orders, deliveries, IQ). Catches whatever a call site's own
 * `recoverFromStaleDeployment` wrap didn't (a component that doesn't wrap
 * its Server Action calls yet, or a genuinely unexpected crash), so a stale
 * tab is never left as a silent failure or a blank screen anywhere in the
 * staff app.
 *
 * §56's `ErrorState` says what failed and what to do next — never makes
 * failure look like success. A stale deployment gets the one action that
 * actually fixes it; anything else gets `reset()`, which retries the
 * segment without a full reload, since a genuine one-off error doesn't need
 * one.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = isStaleDeploymentError(error);

  useEffect(() => {
    // Never swallowed — same posture Next's own default error UI has, kept
    // here so replacing that default with our own doesn't lose the signal.
    console.error(error);
  }, [error]);

  if (stale) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <ErrorState
          title={STALE_DEPLOYMENT_MESSAGE}
          detail="This page was open before the last update. Nothing you just did was saved — reload and try again."
          action={<ReloadAppButton />}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
      <ErrorState
        detail="Try again. If it keeps happening, reload the page."
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => reset()}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-5 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Try again
            </button>
            <ReloadAppButton variant="ghost" />
          </div>
        }
      />
    </div>
  );
}
