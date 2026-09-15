# KDS

Route: `/app/kds`. Source of truth: `src/components/kds/kds-board.tsx` (221 lines — the entire client UI, board and ticket card in one file), `src/lib/kitchen/tickets.ts` (83 lines, pure, tested), `src/app/(app)/app/kds/page.tsx` (41 lines). A thinner surface than POS or the Command Center — this spec is correspondingly shorter, not less rigorous.

## Departs from Master

**Information architecture.** A single fixed board, no navigation within the page, no station lanes yet. Three hardcoded status columns left to right: **New** (order status `ACCEPTED`) → **Cooking** (`PREPARING`) → **Ready** (`READY`). Sort within a column is oldest-ticket-first, nothing else. This is not a simplified version of a richer design — it's confirmed, via the code's own comments, to be a deliberate placeholder: *"No station, no routing… the domain has none of those yet"* (`kds-board.tsx:43`). Stations, prep-time targets with an amber "nearly late" tier, and an expo board (BUILD-PLAN/ROADMAP Phase 4) are all genuinely absent — `products.kdsStation` and `products.prepMinutes` exist as schema columns and are read by nothing.

**A ticket, top to bottom:** order number (huge — see Typography) + fulfilment label (table name for dine-in, "Delivery", "Collection") on the left; a "Late" pill (icon + word + red — never colour alone) + minutes-waiting counter + "by HH:MM" promised time on the right; item list (qty × name, modifiers indented, muted); an optional highlighted notes banner; an inline per-ticket error line if the last advance failed; one full-width primary button advancing the ticket to its next kitchen status, or — for a `READY` ticket, since the counter closes those out, not the kitchen — a plain "Waiting for the counter to hand over" line instead of a button.

**Component authority: entirely FRYBIRD, and the one kit option considered is still blocked.** The purchased kit's Kanban board was evaluated for this exact screen and deferred: `FRYBIRD-COMPONENT-MIGRATION.md` documents `shadcn-ui-kit-dashboard/components/ui/kanban.tsx` as "structurally Radix-locked" — confirmed still true, it imports `Slot` from the old standalone `@radix-ui/react-slot` package, not the unified `radix-ui` package every FRYBIRD primitive migrated to in `b6d2aaa`. It was never copied into `src/components/ui/`; it exists only in the read-only kit reference. **Do not adopt it as-is.** If a station-lane board is designed later, either wait for the kit file to be fixed upstream or build the lane layout directly — don't route around the Radix conflict by vendoring a patched copy.

**A KDS-specific operational state that isn't one of Master's eight:** a stale-deployment banner. If polling detects the client is running an old build, a reload-prompt banner appears (`kds-board.tsx:112-117`). This exists because a KDS terminal is a screen nobody navigates back to — it can sit on an old build indefinitely otherwise. Worth naming explicitly since a future audit of "does every screen have all 8 states" shouldn't flag this as a stray, undocumented ninth state — it's deliberate, scoped to unattended-terminal screens.

## Layout

KDS is built for a fixed kitchen-mounted display, not a device someone resizes. No responsive breakpoint strategy was found in the code, and none should be invented for this spec — a kitchen display's physical size is knowable in advance in a way a customer's phone or a cashier's tablet is not. If a second physical display size is ever mounted, that's a real design decision (state it in this file when it happens), not a CSS media query to guess at now.

## Component strategy — reusable primitives

Almost nothing is shared with POS or the Command Center by component, but two things are shared **by concept** and worth naming so future work doesn't reinvent them:
- `useOnline()` (`src/components/pos/use-online.ts`) — the same connectivity hook POS uses. KDS's usage differs in kind, not in mechanism: POS disables input entirely when offline; KDS keeps stale tickets visible and adds a banner (see States).
- `useOrderEvents` (`src/lib/realtime/client.ts`) — the same realtime primitive the orders board and Command Center's Live section read from. KDS's specific pattern (immediate refetch on event, 60s fallback poll only while online, paused entirely offline, plus an independent 30s elapsed-time re-render) is worth reusing wherever else a screen needs "always current, survives a dropped socket."

New-ticket sound is a **local `useChime()` call, deliberately not the shared `new-order-alert.tsx`** the counter/orders board uses — the code states why: *"one burst, not the counter's persistent alarm… the cook is looking at this screen, the counter may not be."* Do not "fix" this into using the shared alert component; the difference is intentional and correct.

## States

Only `OfflineState` is reused from the shared set, and additively — it renders as a banner above the still-visible ticket columns rather than replacing them, so stale tickets stay on screen while offline instead of disappearing. `PermissionDenied` gates the page server-side before any client code runs. **`EmptyState`, `ErrorState`, and `LoadingState` from the shared set are not used anywhere in KDS**, and that's mostly correct, not a gap to close reflexively:

- Per-column empty text is a bare, borderless line — deliberately lighter than the shared `EmptyState` shell, and worded per column: *"Nothing waiting to go out"* for Ready specifically, *"Nothing here"* for New/Cooking. A kitchen screen showing "all caught up" needs to read at a glance, not carry a card border and an icon.
- No loading skeleton exists, and none is needed under the current architecture — the route is `force-dynamic`, data fetched server-side before first paint. If KDS ever moves to client-side initial fetch, `LoadingState` becomes the right call then, not before.
- A failed ticket-advance shows inline red text under that one card (`role` not confirmed — check before shipping a fix here), not a page-level toast. Correct pattern: one ticket failing to advance shouldn't disturb the read of the rest of the board.

**Gap actually worth closing:** there is no page-level "zero tickets anywhere" state — three columns each showing their own short empty line simultaneously is what a fully quiet kitchen looks like today. This is probably fine (each column's message is already honest and specific) but wasn't validated against what a cook actually wants to see on a dead Tuesday afternoon — flag for the next KDS-focused review rather than deciding here.

## Interaction — kitchen-specific, beyond Master §7's baseline

One interaction per ticket: tap the advance button. Nothing else on a card is tappable. The button is **64px tall — taller than Master's own 56px POS minimum**, not a typo: a cook's hands are wetter and moving faster than a cashier's, and the target is the only thing on the card that needs to be hit reliably.

## Typography — sized for distance, a real departure from Master's scale

A KDS ticket is read from a few feet away in a hot, busy kitchen — not held. Every size on a ticket is a step up from Master's standard scale: order number `text-3xl` (30px, `font-black`), minutes-waiting `text-2xl` (24px), item names/quantities `text-lg` (18px — Master's own "Body L" ceiling), modifiers and the notes banner one step down at `text-base` (16px, Master's plain "Body"). **Nothing on a ticket renders at Master's Small (14px) or Caption (12px).** This is the single most important departure in this document for anyone building a new KDS component: default to the dashboard's smaller table/caption sizes and it will be unreadable from kitchen distance.

## Motion — stricter than Master's own POS ceiling

Master caps POS motion at 120ms. KDS goes further: **nothing animates**, by explicit code comment — *"a screen a cook glances at two hundred times a shift must never be mid-transition."* Treat this as this page's own rule, not an inheritance from the POS number; a future motion pass that assumes "KDS gets the POS's 120ms budget" would be wrong.

## Colour — a real gap or a deliberate simplification, not yet decided

Master §5 defines order type tints (`type.dineIn/takeaway/delivery/online`) and status dots (`status.new/accepted/cooking/ready/outForDelivery`) specifically for telling order types and statuses apart at a glance. **KDS uses neither** — confirmed by direct grep for every one of those utility class names, zero matches. Today a ticket signals lateness with a binary destructive-red/neutral distinction only; type is shown as plain text, status is implicit in which column the ticket sits in. This may be a correct simplification (redundant with the column) or a genuine gap (a mixed-fulfilment kitchen might want the type tint at a glance without reading the label) — **this needs a decision, not an assumption**, before anyone builds a "consistency fix" that adds the tokens here.

## Accessibility

Not independently audited in this pass beyond what's stated above (the late pill pairs an icon and a word, never colour alone — correct per Master's own colour rule). Check aria roles on the per-ticket error line and the advance button's disabled/pending state before shipping any KDS accessibility work.

## Copy

Follows `content.md`. The per-column empty lines and the "waiting for the counter to hand over" line are both in the plain, specific register the voice guide asks for — no departure to record.

## Resolved: KDS is light, matching POS — decided, not re-derived from source alone

Decided 2026-09-15: KDS follows the same light direction as POS. Unlike the POS reversal, this wasn't re-diagnosed from a second screenshot — the decision was given directly, and this section's job is to record why it's correct on the actual token evidence, not just assert it.

**Correction to this section's own earlier claim:** an earlier version of this document said KDS's ticket cards don't depend on `--panel`, distinguishing it from POS's failure mode. That was wrong — direct reading of `kds-board.tsx:171` shows the ticket card uses `bg-panel` directly. KDS was carrying the exact same latent bug as POS: `.surface-dark` doesn't define `--panel`, so a dark-reapplied KDS would have rendered white ticket cards on a dark page, the identical "mixed dark/light surfaces" failure that sank the POS attempt — it simply hadn't been shipped and screenshotted yet to catch it. Worth stating plainly: the first version of this section reasoned from an incomplete grep rather than a full read of the file it was making a claim about.

**What KDS's actual token usage produces under full, consistent `[data-surface="iq"]` light values** (verified by reading `kds-board.tsx` directly, not inferred): column sections (`bg-surface`, `#ffffff`) sit on the page background (`--background`, `#f4f5f6`) — white-on-light-gray, clearly separated. Ticket cards (`bg-panel`, also `#ffffff`) sit inside, differentiated from each other and the column by a 2px border (`border-border` normal, `border-loss` — `#c2410c`, a distinct orange-red — when late) plus consistent gaps, not a background-colour difference; a common, clean card-list pattern, not a departure requiring new colours to be invented. The late pill uses `bg-destructive`/`text-destructive-foreground` (`#c2410c` on white) — deliberately not the brand ember red, keeping that reserved for the one primary action. The advance button uses `bg-primary text-primary-foreground` — `--primary: var(--iq-red)` (`#d92b2b`, brand ember) on white — exactly "strong FRYBIRD red for the primary action, nowhere else." None of this required a design change; removing the incomplete dark override was sufficient because the component was already written against these exact tokens.

Fixed (2026-09-15): `kds/layout.tsx` deleted, mirroring the POS revert. `DarkStaffSurface` itself deleted too — once neither POS nor KDS used it, it had zero remaining callers.

**Still genuinely unverified: the actual rendered result.** No browser tooling, no staff session available to this session either time. The reasoning above is sound and the token math checks out, but "the math checks out" was also true, incompletely, the first time — treat this as implemented-from-source-and-gated, not as visually confirmed, until it's actually looked at.
