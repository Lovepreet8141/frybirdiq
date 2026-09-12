"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/states";

export default function IqError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-6xl px-[var(--gutter)] py-8">
      <ErrorState
        title="FRYBIRD IQ couldn't load"
        detail="Something didn't work while pulling today's figures. Try again — nothing you'd have seen here has changed."
        action={
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            Try again
          </button>
        }
      />
    </div>
  );
}
