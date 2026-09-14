import type { ReactNode } from "react";

/**
 * The title block a staff page renders at its top: a heading, an optional
 * description, and a slot for whatever that page needs on the right — a
 * range switcher, a button, a count. Replaces the near-identical header
 * markup `orders/page.tsx` and others used to hand-roll on their own.
 *
 * Deliberately not responsible for a breadcrumb trail — that's
 * `SectionBreadcrumb` in the persistent chrome, one level up, since it's the
 * same fact ("where am I") on every page rather than something each page
 * should have to restate.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-3xl">
        <h1 className="font-heading text-[26px] font-semibold leading-[1.15] tracking-[-0.015em]">{title}</h1>
        {description && <p className="mt-1 text-[13.5px] leading-[1.5] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
