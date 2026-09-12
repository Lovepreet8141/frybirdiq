import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shaped like the finished screen, not a spinner — §56. Three KPI tiles, the
 * food-cost panel, the two selling columns, the attention list, in the same
 * proportions the real content renders at, so nothing jumps into place.
 */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-[var(--gutter)] py-8" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading FRYBIRD IQ</span>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-11 w-64" />
      </div>

      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 bg-surface px-5 py-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-4 w-36" />
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="mt-4 h-40 w-full" />
        <div className="mt-6 grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface p-5">
            <Skeleton className="h-5 w-32" />
            <div className="mt-4 flex flex-col gap-3">
              {Array.from({ length: 4 }, (_, j) => (
                <Skeleton key={j} className="h-4 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="mt-4 h-4 w-2/3" />
      </div>
    </div>
  );
}
