import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like the finance workspace — header and period pills, four tiles, the chart and method panels, the tab strip and ledger rows (§56). */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading finance</span>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-10 w-80 max-w-full" />
      </div>

      <Skeleton className="h-4 w-2/3" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex min-h-[152px] flex-col gap-3 rounded-xl border border-border/80 bg-panel px-5 py-4">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-3.5 w-36" />
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-panel p-5 lg:col-span-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-4 aspect-[21/9] w-full" />
        </div>
        <div className="rounded-xl border border-border bg-panel p-5">
          <Skeleton className="h-4 w-24" />
          <div className="mt-4 flex flex-col gap-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-48" />
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-9 w-72 max-w-full" />
          <Skeleton className="ml-auto h-9 w-24" />
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-panel">
          <div className="border-b border-border px-4 py-3">
            <Skeleton className="h-4 w-full" />
          </div>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-4 last:border-b-0">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="ml-auto h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
