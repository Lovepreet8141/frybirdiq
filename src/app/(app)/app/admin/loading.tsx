import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like an admin screen — header, section strip, a trust line, two panels of setting rows — so nothing jumps when it arrives (§56). */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <Skeleton className="h-10 w-full max-w-lg" />
      <Skeleton className="h-4 w-1/2" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-panel p-5 lg:col-span-2">
          <Skeleton className="h-4 w-32" />
          <div className="mt-4 flex flex-col gap-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center justify-between gap-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
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
    </div>
  );
}
