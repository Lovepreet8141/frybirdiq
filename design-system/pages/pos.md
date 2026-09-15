# POS

Route: `/app/pos`. Source of truth for this spec: `src/components/pos/*` (18 files), `src/lib/pos/pricing.ts`, `src/app/(app)/app/pos/page.tsx`, as they exist on `kit-radix-nova` — not a redesign, a record of what's actually built plus the specific gaps worth closing.

## Departs from Master

**Information architecture.** Two real tabs, not a single screen: **Order** (the counter — wrapped in `DeviceAgent` for printer/hardware registration) and **Tables** (`TablesView`, dine-in management). The Order tab is a fixed three-column grid: `220px` category rail · `1fr` product grid · `400px` order builder, collapsing to a stacked single column below `lg`. Master doesn't specify a POS information architecture — this is the whole of it.

The flow a cashier follows: pick order type (dine-in/takeaway) → optionally pick a table → tap products (a plain product adds one instantly with a 500ms confirmation flash on the tile; a product with modifier groups opens a picker instead, since "medium heat, large" can't be guessed) → adjust quantities in the builder → **Charge** opens the payment sheet (cash received → change → confirm → optional receipt print → next order). A customer phone number can be attached at any point, read by both the tender step and rewards lookup.

**Component authority.** `FRYBIRD-COMPONENT-MIGRATION.md` states it directly: *"POS product grid / cart / order builder / modifier picker — FRYBIRD's existing versions are already stronger (server-priced, offline-aware, live-polled)."* Confirmed against the code — this is not a stale claim. **The product grid, order builder, and modifier picker are FRYBIRD-authoritative. Do not replace them with a kit pattern.** Two exceptions are already kit-derived and should stay that way:

| Component | Origin | Note |
|---|---|---|
| `quantity-stepper.tsx` | Purchased `button-group14` composition | The −/count/+ control |
| `table-grid.tsx`, `table-detail-dialog.tsx`, `add-table-dialog.tsx`, `table-status-badge.tsx`, `tables-view.tsx`, `assign-order-to-table.tsx` | Adapted from the kit's `apps/pos-system/tables/*` | Layout/interaction shape only — every one rewritten against real repository types, never copy-pasted |

`modifier-picker.tsx` hand-rolls its own stepper rather than reusing `QuantityStepper` — a missed internal reuse, not a bug. Worth fixing next time that file is touched, not urgent enough to justify touching it solely for this.

**Zero client-side pricing, confirmed.** Grepped every POS component for price/subtotal/total arithmetic — none exists. `priceDraft` (`src/lib/pos/pricing.ts`) is the only path to a number; the client displays what the server priced and re-prices unconditionally on `placeCounterOrderAction` regardless of what the draft claims. This is the one rule in this document that is never a departure candidate — see CLAUDE.md's non-negotiables.

## Layout

**375px** — Order tab stacks to one column: category picker becomes a native `<select>` (not a horizontal scroller — a sideways-scrolling rail is easy to miss on a landscape tablet, so this is a deliberate width-based swap, not a lazy collapse), product grid below it, order builder as a bottom sheet or its own scroll section. Not the primary target device — POS is built for tablet — but must not break.

**768px (the real target)** — Full three-column grid: `220px` rail · `1fr` grid · `400px` builder. This is what "POS" means in practice; every touch-target and density decision below assumes this width.

**1440px** — Same three-column proportions, more breathing room in the product grid (more tiles per row), builder column stays `400px` fixed rather than growing — a wider counter screen should show more products, not a wider receipt.

## Component strategy — reusable primitives

- `Panel`/`KpiTile`/`DataTrust` (from `src/components/iq/ui`) are **not used here and should not be** — those are dashboard-density primitives for a screen read once a day, not a screen operated 200 times a shift. POS has its own vocabulary: `product-grid.tsx`, `order-builder.tsx`, `category-rail.tsx`, `quantity-stepper.tsx`, `modifier-picker.tsx`, `payment-sheet.tsx`, `rewards-keypad.tsx`, `customer-control.tsx`.
- The shared `src/components/states` set (`EmptyState`, `ErrorState`, `LoadingState`, `OfflineState`) **is** shared vocabulary and mostly used correctly here — see States below.
- `use-online.ts` (`navigator.onLine` via `useSyncExternalStore`) is the connectivity primitive both POS and KDS read from — despite living under `components/pos/`, treat it as cross-surface, not POS-private.

## States

`order-builder.tsx` and `product-grid.tsx` use all four shared state components correctly: `EmptyState` (no channel picked yet; empty search/category results), `ErrorState` (a pricing failure, with retry), `LoadingState` (mid-repricing debounce), `OfflineState` (disables the whole grid — offline on POS is not a degraded mode, it's the one state where nothing can be added, since nothing here queues yet).

**`payment-sheet.tsx` and `rewards-keypad.tsx` use none of the shared state components** — this is precisely what ROADMAP.md Phase 8 means by "POS payment sheet and rewards keypad… still on the old style." To be exact about what that means, since "old style" undersells it: touch targets and accessibility are *already correct* in both files (20 and 8 `aria-*` attributes respectively — actually denser than `order-builder.tsx`'s 6). The gap is component-vocabulary consistency, not a functional or accessibility defect. Closing it means routing their loading/error moments through the shared components, not a rewrite.

**Offline is real but narrower than BUILD-PLAN's eventual design.** `useOnline()` correctly detects a dropped connection and disables ordering with an honest message today. There is no IndexedDB queue, no service worker, no "three orders rung up while offline, all three sync when it's back" — that's ROADMAP Phase 10, confirmed unbuilt (no matching code anywhere under `src/lib/pos` or `src/components/pos`). Don't build toward that queue as part of closing the "old style" gap above — it's a separate, larger, already-scoped piece of work.

`permission denied` and `disabled` states were not independently confirmed in this pass — check before shipping anything that touches them.

## Interaction — POS-specific, beyond Master §7's baseline

- Touch targets: Master's 56px POS minimum is real and consistent — verified on every primary tap target (product tiles, stepper buttons, channel toggle, the charge button, the table-select trigger). No departure; stated here because it's the one Master rule most worth re-checking on every new POS component.
- Quantity entry is a two-tap stepper only, **deliberately no numeric keypad** — the code's own reasoning: *"a typed '50' is how a wrong order gets cooked."* A future component must not add a type-to-enter quantity path without revisiting this.
- A no-modifier product tap gets a 500ms confirmation flash on the tile, not a toast or a cart-drawer slide-out — cheaper, faster, doesn't interrupt the next tap.
- Category navigation is a vertical rail at width, a native `<select>` below `lg` — see Layout.

## Motion

Master's POS ceiling (nothing longer than 120ms) applies without departure. The 500ms product-add flash is the one apparent exception — it is a **state indicator held for legibility, not a transition**; the flash's own fade is within the 120ms budget, only its hold duration is longer. Worth stating explicitly so a future review doesn't flag it as a motion-budget violation by surface reading of the number alone.

## Accessibility — beyond Master §7's baseline

Real and consistent where checked: `role="group"` + `aria-label` on the channel toggle and quantity groups, `aria-pressed`/`aria-current` on toggles, `aria-live="polite"` on the quantity count and the offline banner, `role="alert"` on the rejected-items notice and `ErrorState`, `sr-only` labels on every icon-only input and button. **Not confirmed either way — check before relying on it:** skip-links or explicit focus-trap handling in the modal/sheet components (modifier picker, payment sheet). This needs code inspection this pass didn't cover, not a visual check.

## Copy

Follows `content.md` throughout — no departure. Sampled and correct: the offline message is Master's own example verbatim (*"You're offline. New orders will sync when connection returns"*) even though the sync half isn't built yet for POS specifically — worth a light copy review once Phase 10 lands, since the promise should match what actually happens.

## Resolved: POS is intentionally light, not a dark-theme defect

An earlier version of this section flagged POS as very likely wrongly rendering light instead of an intended dark theme, based on `.surface-dark`'s own comment ("staff look at this screen for a whole shift, a cream field is fatiguing") and the CSS cascade mechanism (`[data-surface="iq"]` overriding `.surface-dark` at equal specificity). That reasoning was **tested against a real fix and real screenshots, and turned out wrong.**

A dark-surface fix was shipped (2026-09-15, commit `741150f`) and confirmed live via production screenshots. The result was rejected as unacceptable — not a preference call alone: the fix was also visually broken, because `.surface-dark` doesn't define every token POS reads (`--panel`, `--inverse`), producing a patchwork of dark page, white panels, and near-black buttons rather than one coherent theme.

Deeper archaeology, done *after* the visual evidence rather than before: the commit that actually designed POS's current look ("Design phase 2, wave 3… POS touch polish") describes it in explicit, deliberate light-surface language — "the category rail is the **cream row** with the red bar," "the channel toggle settles in **ink**," "the price on a tile is **ink**." POS was never designed dark. `.surface-dark`'s comment describes an intent that was written but never actually executed or verified against real POS components.

**Reverted same day** (the dark layout wrapper for POS was deleted entirely). POS reads `[data-surface="iq"]` directly, as it always effectively has and was designed to. The lesson worth keeping, not just the fix: a plausible-sounding code comment and a clean CSS cascade explanation are not a substitute for a real look at the real screen — this section was wrong once already from the first without one.
