# IQ (Command Center)

Routes: `/app/iq/*` and `/app/admin/*` — confirmed to share one system, not two (`admin/restaurant/page.tsx` imports the exact same `Panel`/`PanelHeader`/`PanelBody`/`DataTrust` from `@/components/iq/ui` and the exact same `EmptyState`/`PermissionDenied` from `@/components/states` that every `/app/iq/*` page uses). This spec governs both. Source of truth: `src/components/iq/ui/*`, `src/app/(app)/app/iq/*`, `FRYBIRD-COMPONENT-MIGRATION.md`.

## Departs from Master

**Information architecture: three strip-navs, one pattern, never abstracted.** `CommandCenterNav` (Overview · Live operations · Activity · Alerts · AI brief — badges the live alert count on "Alerts"), `AnalyticsSectionNav` (Products & categories · Channels · Food cost & P&L · Expenses · Customers, the last conditionally hidden by permission, plus a disabled "Waste" item carrying a "Not connected" pill rather than being hidden — honest about what doesn't exist yet rather than pretending the tab isn't planned), and `AdminSectionNav` (Restaurant · Bill & Receipt · Printers & devices · Notifications · Audit log, each item independently permission-gated, the whole nav hiding itself if only one item would show). All three are real routes, not client-side tabs, and all three use byte-identical markup (`h-10 border-b-2`, active = `border-primary font-semibold`, inactive = `border-transparent text-muted-foreground`) without a shared component behind them. **This is the single clearest reusable-primitive opportunity this comparison found** — a `SectionNav` component taking a list of `{label, href, badge?}` would remove three copies of the same 20-odd lines. Low risk, real value, worth doing before writing a fourth copy for any new section.

**Component strategy: the Overview page names its kit source directly.** `iq/page.tsx`'s own comment: the grid is "the purchased Sales dashboard's first row (8-col chart + 4-col 2×2 KPIs) over the E-commerce dashboard's lower page (4/4/4, then 8/4, then 8/4)" — a specific, named adoption, not a guess this spec is inferring. Every chart (`cost-breakdown-donut.tsx`, `food-cost-chart.tsx`, `channel-chart.tsx`, `sales-trend-card.tsx`) routes through the purchased kit's `ChartContainer`/`ChartTooltip`/`ChartConfig` wrapper (`@/components/ui/chart`) over Recharts, consistently — this is the one kit primitive adopted wall-to-wall on this surface, and any new chart should use it too rather than a bespoke SVG.

**A real inconsistency worth naming, not yet worth an urgent fix:** most cards route through `Panel`/`PanelHeader`/`PanelBody`. Two do not — `iq/page.tsx`'s "Order health right now" section and `sales-trend-card.tsx` both use raw shadcn `Card`/`CardHeader`/`CardContent` directly. Two card systems coexist on the same page today. Worth converging the next time either file is touched for another reason; not worth a dedicated pass on its own given the visual difference is minor.

## The shared vocabulary — `src/components/iq/ui`

This is the primitive set every IQ and Admin page should reach for before building something new, per §11's "search this repo first":

| Primitive | What it's for |
|---|---|
| `Panel` / `PanelHeader` / `PanelBody` / `PanelFooter` / `SectionHeading` | The base card. Header is a 14/600 title + description + meta-or-action row; body is padded, or `flush` (no side padding) for a table. |
| `KpiTile` | A dashboard number: label, a serif `font-money` figure (28px mobile / 40px desktop) that optionally counts up, a delta chip, a note line, an optional foot link. `missing` renders "—" and "Not yet tracked" rather than a fake zero — never omit this prop when the underlying data can be genuinely absent. `emphasis` marks the one answer a card exists to give. |
| `DeltaChip` / `DeltaFromBps` | The gain/loss/flag/neutral tone system as a reusable atom, for any number that moves. |
| `StatusWord` | A single status word in tone. |
| `DataTrust` | A row of `StatusWord`s every data-heavy panel should end with: what it covers, how fresh, what it excludes. Master's own rule (§5) that every figure states its own trustworthiness — this is the component that rule is implemented as. |
| `SampleTag` | Marks a figure as illustrative, not real — used correctly on `iq/brief` where nothing is connected yet. |
| `InsightCard` | The "needs attention" card: dot + title + evidence + a bold impact line + primary/secondary action links. |
| `BarList` | Label / bar / share% / amount rows, bar fill from the warm neutral ramp or a gain/loss tone. |
| `CapabilityPanel` | The honest-about-gaps pattern: a connected/not-connected list with notes. Reach for this, not a fake feature list, whenever a screen describes capabilities that aren't all built yet. |
| `CountUp` | The one orchestrated motion moment on data screens — animates over 500ms via Motion's `animate()`, and correctly renders the final value instantly with no animation when `prefers-reduced-motion` is set. Confirmed actually paired with `KpiTile` everywhere the tile is used, not just documented. |

Reach for these by name before building a new card, a new number, or a new "here's what's missing" panel anywhere in IQ or Admin.

## Layout

**375px** — KPI rows go 2-up (`grid grid-cols-2 gap-4`), confirmed identically in `iq/pnl/page.tsx` and `finance/page.tsx` — a real, consistent pattern, not a one-off. Section grids stack to one column.

**768px** — Same 2-up KPI row; section grids remain one column. **This is a real gap, not a design choice**: the Overview page's full grid is `grid gap-4 lg:grid-cols-12 lg:gap-6` with every section `lg:col-span-*`, meaning there is no intermediate tablet arrangement — a screen at 768–1023px gets the same stacked layout as a phone. Given Master's own framing ("the owner, once a day") this is a defensible simplification for now, but it is a limitation to record, not a pattern to extend on purpose into new pages without reconsidering it.

**1440px+ (the primary target)** — KPI rows go 4-up (`lg:grid-cols-4`); the Overview's 12-column grid resolves into its designed chart+KPI composition. Design new Command Center screens for this width first, phone-stack second, and treat anything tablet-specific as a known open gap rather than something already solved elsewhere to copy from.

## States

Sampled, not exhaustive: 15 of 24 `/app/iq/*` pages import from the shared `src/components/states` set; 9 don't. That's not necessarily 9 gaps — several likely redirect outright on a missing permission rather than render `PermissionDenied` inline, which is a legitimate alternative pattern, not a violation. **Before assuming a page is missing a state, check whether it redirects instead of rendering one — don't treat the 9 as a flat todo list.**

Empty-state copy sampled as genuinely good against Master's own rule (`pnl/page.tsx`: *"No costs recorded for this period,"* never "₹0" standing in for absence) — the pattern is established and correct where it's used; the remaining work is coverage, not quality.

## Data visualization

Recharts, always through the shared `ChartContainer`/`ChartTooltip`/`ChartConfig` wrapper — see Component strategy above. Colour always routes through CSS custom properties (`var(--primary)`, `chart-1`…`chart-5`), never a hardcoded hex inside a chart file — confirmed, no exceptions found. New charts: use the wrapper, use the chart tokens, and per Master §5, a data series draws in the neutral (`chart-1`) by default — red (`chart-5`) is reserved for an alert series and nothing else, never "the newest series" or "the brand-coloured one."

## Accessibility

Not independently audited beyond what Master §7 already requires everywhere (focus rings, no hover-only interaction). No IQ-specific departure found or ruled out in this pass — treat Master's baseline as authoritative here until a dedicated a11y review of this surface happens.

## Motion

No departure from `motion.md` found. `CountUp`'s reduced-motion handling (final value, no animation, not just a shorter one) is the one thing worth calling out by name as the correct pattern for any other animated number added to this surface.

## Copy

Follows `content.md`. `CapabilityPanel` and `SampleTag`'s honest-about-gaps language (`iq/brief`) is the reference example for how this product should ever talk about a feature that isn't finished — plain statement of what's connected and what isn't, no "coming soon" marketing voice.

## Needs visual verification before treating as settled

**This is the most consequential finding in all three specs, and it originates here.** `src/app/(app)/app/layout.tsx` applies both `className="surface-dark"` and `data-surface="iq"` unconditionally on one wrapper around the *entire* `/app/*` route tree — there is no route-specific layout for POS or KDS to isolate them from this. In `globals.css`, `[data-surface="iq"]` is declared after `.surface-dark` and redefines **every single token** the dark surface sets — background, foreground, every surface/card/popover/primary/secondary/accent/muted/destructive/success/warning/border/ring/radius value, confirmed line-by-line, full overlap. Both selectors carry equal CSS specificity, so declaration order alone decides, and `[data-surface="iq"]` comes second: **it wins everywhere under `/app/*`, not just on `/app/iq/*` pages.**

`docs/IQ-DASHBOARD.md` already diagnoses this mechanism correctly but only follows the consequence through for the IQ dashboard itself — it doesn't note that the same cascade also reaches POS and KDS, which is the actual scope of the problem. Given `.surface-dark`'s own code comment states the dark theme exists specifically because "the counter, the kitchen display… are looked at for a whole shift… a cream field is fatiguing," **this is very likely a live UX regression on the two most operationally time-pressured screens in the product**, not a cosmetic mismatch confined to a dashboard the owner checks once a day.

The CSS mechanism is unambiguous from source. **The actual rendered result was not visually confirmed — no browser tooling was available in this session, and this must not be treated as settled until someone loads `/app/pos`, `/app/kds`, and `/app/iq` in a real browser and looks.** If confirmed, resolving it is a Design Director-level call (per this session's earlier audit, recommendation #4: is dark-per-MASTER or light-as-shipped the intended state) plus a CSS specificity fix — not something to guess at from three spec documents.
