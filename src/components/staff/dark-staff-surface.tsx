import type { ReactNode } from "react";

/**
 * Reapplies `.surface-dark` inside `AppLayout`'s `[data-surface="iq"]` wrapper.
 *
 * `(app)/app/layout.tsx` puts `data-surface="iq"` and `.surface-dark` on the
 * same top-level div, for every route under `/app`. In `globals.css`,
 * `[data-surface="iq"]` is declared after `.surface-dark` and redeclares
 * every custom property `.surface-dark` sets, at equal specificity — so it
 * wins everywhere, POS and KDS included, even though `.surface-dark`'s own
 * comment names exactly those screens ("looked at for a whole shift... a
 * cream field is fatiguing") as needing to stay dark.
 *
 * Reapplying the same `.surface-dark` class here, nested inside that div,
 * redeclares every property it sets. Inheritance falls back to the nearest
 * declaration, so this shadows the inherited `[data-surface="iq"]` values
 * for whatever route renders it — without touching the shared layout, its
 * CSS, or any other `/app` route.
 *
 * `contents` so this wrapper never participates in the surrounding flex
 * layout — it exists only to scope custom properties, not to render a box.
 *
 * Known limitation, not fixed here: a Radix `Portal` (`Dialog`, `Sheet`)
 * renders into `document.body` by default, outside this wrapper's DOM
 * subtree, so a dialog opened from a page using this component still
 * inherits from `:root` rather than the dark values — a pre-existing
 * characteristic of the whole app's portal theming, not something this
 * component introduces or was asked to solve.
 */
export function DarkStaffSurface({ children }: { children: ReactNode }) {
  return <div className="surface-dark contents">{children}</div>;
}
