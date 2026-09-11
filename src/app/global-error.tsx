"use client";

import { useEffect } from "react";
import "./globals.css";
import { ReloadAppButton } from "@/components/reload-app-button";
import { isStaleDeploymentError, STALE_DEPLOYMENT_MESSAGE } from "@/lib/errors/stale-deployment";

/**
 * The last-resort boundary — only reached if an error escapes even the root
 * layout, which `src/app/(app)/error.tsx` and every other segment's own
 * handling should normally catch first. Next.js requires this file to
 * render its own `<html>`/`<body>`, since it replaces the root layout
 * entirely rather than nesting inside it — kept deliberately plain (no
 * custom fonts, minimal markup) so this page has as little as possible left
 * to fail if something is already badly wrong.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = isStaleDeploymentError(error);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white px-6 text-center text-black">
        <h1 className="text-xl font-bold">{stale ? STALE_DEPLOYMENT_MESSAGE : "Something went wrong."}</h1>
        <p className="max-w-sm text-sm text-gray-600">
          {stale
            ? "This page was open before the last update. Nothing you just did was saved."
            : "Reload the page. If it keeps happening, try again shortly."}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <ReloadAppButton />
          {!stale && (
            <button
              type="button"
              onClick={() => reset()}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-gray-300 px-5 text-sm font-bold text-black hover:bg-gray-50"
            >
              Try again
            </button>
          )}
        </div>
      </body>
    </html>
  );
}
