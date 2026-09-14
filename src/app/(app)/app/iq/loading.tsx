import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shaped like the Command Center grid — header and controls, the chart
 * beside the 2×2 KPI cards, the three-card row, the 8/4 rows — so nothing
 * jumps into place when the data lands (§56).
 */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-[var(--gutter)] py-6 lg:gap-6 md:py-8" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading FRYBIRD IQ</span>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-3.5 w-72" />
        </div>
        <Skeleton className="h-10 w-72" />
      </div>
      <Skeleton className="h-10 w-full max-w-md" />

      <div className="grid gap-4 lg:grid-cols-12 lg:gap-6">
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-8">
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-48" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-12 w-24" />
              <Skeleton className="h-12 w-24" />
            </div>
          </div>
          <Skeleton className="mt-4 h-[186px] w-full" />
        </div>
        <div className="grid grid-cols-2 gap-4 lg:col-span-4 lg:gap-6">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
              <Skeleton className="h-3.5 w-16" />
              <Skeleton className="h-7 w-20" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>

        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5 lg:col-span-4">
            <Skeleton className="h-4 w-28" />
            <div className="mt-4 flex flex-col gap-3">
              {Array.from({ length: 3 }, (_, j) => (
                <Skeleton key={j} className="h-5 w-full" />
              ))}
            </div>
          </div>
        ))}

        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-8">
          <Skeleton className="h-4 w-36" />
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-4">
          <Skeleton className="h-4 w-24" />
          <div className="mt-4 flex flex-col gap-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-8">
          <Skeleton className="h-4 w-28" />
          <div className="mt-4 flex flex-col gap-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-4">
          <Skeleton className="h-4 w-20" />
          <div className="mt-4 flex flex-col gap-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
