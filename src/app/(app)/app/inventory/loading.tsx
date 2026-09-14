import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like the workspace — header, four tiles, the attention and capability panels, the table — so nothing jumps when the data lands (§56). */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading inventory</span>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex min-h-[152px] flex-col gap-3 rounded-xl border border-border/80 bg-panel px-5 py-4">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-9 w-16" />
            <Skeleton className="h-3.5 w-32" />
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-panel p-5 lg:col-span-2">
          <Skeleton className="h-4 w-36" />
          <div className="mt-4 flex flex-col gap-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-border bg-panel p-5">
            <Skeleton className="h-4 w-28" />
            <div className="mt-4 flex flex-col gap-2.5">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-panel p-5">
            <Skeleton className="h-4 w-40" />
            <div className="mt-4 flex flex-col gap-2.5">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-9 w-64 max-w-full" />
          <Skeleton className="ml-auto h-9 w-24" />
          <Skeleton className="h-9 w-20" />
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-panel">
          <div className="border-b border-border px-4 py-3">
            <Skeleton className="h-4 w-full" />
          </div>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-4 last:border-b-0">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="ml-auto h-4 w-20" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
