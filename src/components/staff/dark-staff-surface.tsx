import type { ReactNode } from "react";

/**
 * Reapplies `.surface-dark` inside `AppLayout`'s `[data-surface="iq"]` wrapper.
 *
 * `(app)/app/layout.tsx` puts `data-surface="iq"` and `.surface-dark` on the
 * same top-level div, for every route under `/app`. In `globals.css`,
 * `[data-surface="iq"]` is declared after `.surface-dark` and redeclares
 * every custom property `.surface-dark` sets, at equal specificity — so it
 * wins everywhere by default.
 *
 * This was briefly applied to POS too (2026-09-15, reverted the same day):
 * `.surface-dark`'s own comment reads as if the counter should be dark, but
 * the commit that actually designed POS ("Design phase 2, wave 3... POS
 * touch polish") describes it in explicit light-surface language — "the
 * category rail is the cream row", "the channel toggle settles in ink" —
 * and `.surface-dark` doesn't define every token POS reads (`--panel`,
 * `--inverse`), so the result was a genuine patchwork of dark page with
 * white panels and near-black buttons, not a clean dark theme. Confirmed
 * against real production screenshots as unacceptable, reverted the same
 * day. POS reads `[data-surface="iq"]` directly again — this component is
 * not applied to it. Do not reapply without a real design decision and
 * visual verification first, not code-comment archaeology alone — that's
 * exactly how the POS mistake happened.
 *
 * Currently used by KDS only, and KDS's own correctness here has not been
 * independently re-confirmed since the POS reversal — treat it as
 * provisional, not settled, until it gets the same visual verification.
 *
 * Reapplying the same `.surface-dark` class here, nested inside the shared
 * wrapper, redeclares every property it sets. Inheritance falls back to the
 * nearest declaration, so this shadows the inherited `[data-surface="iq"]`
 * values for whatever route renders it — without touching the shared
 * layout, its CSS, or any other `/app` route.
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
