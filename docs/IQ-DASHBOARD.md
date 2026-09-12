# /app/iq — layout spec

Redesign of the owner's home screen. Written before the build, per
`design-system/pages/README.md`'s process; this is the page-spec-shaped
document that process asks for, filed under `docs/` at the user's request
rather than `design-system/pages/` since it covers layout rationale more than
token overrides.

## A correction to make before anything else

`design-system/MASTER.md` and `tokens.json` describe FRYBIRD IQ as a dark
surface — Ember on Charred, Amber the one accent. That is not what is
actually wired up. `src/app/(app)/app/layout.tsx` stamps the whole staff area
with **both** `class="surface-dark"` **and** `data-surface="iq"` on the same
element, and in `globals.css` the `[data-surface="iq"]` block is declared
*after* `.surface-dark`, so at equal specificity it wins every custom property
both define. The IQ surface that actually renders today is light — white
panels, near-black ink, brand red as the one accent on white — and its own
code comment says so explicitly: *"FRYBIRD IQ — the staff and owner side.
Light, where the customer site is dark... measured, not eyeballed."* Every
existing IQ screen (this one, `/app/iq/pnl`, the menu admin) is already built
against that light palette through the same semantic tokens (`bg-surface`,
`text-primary`, `text-muted-foreground`), which is how a rebuild done purely
by reading MASTER.md would have silently shipped a screen that doesn't match
its own neighbours in the nav bar.

This redesign builds against the **live** `[data-surface="iq"]` tokens, not
MASTER.md's dark description, for that reason. MASTER.md and `tokens.json`
should be corrected to document the light IQ surface as its own row with its
own measured contrast table — flagged here, not fixed here, since that is a
design-system-wide correction outside a one-screen brief.

Practical consequence for the "one accent" rule: on this surface `--primary`
(brand red) is already the one accent — it is what `RevenueChart` uses for
its bars today. `--destructive` here is a distinct burnt orange
(`#c2410c`), not red, which is what this build uses for urgency/over-target
signalling, so "the accent" and "the alarm colour" stay visually distinct
without inventing a third hue.

## What the best dashboards share

Studied for pattern, not copied — this stack is Base UI (`base-nova`) +
Tailwind v4, and none of shadcn/blocks, Tremor, or Linear's stack belongs
here.

- **One KPI row, hairline-divided, not floating cards.** shadcn's dashboard
  block, Tremor's overview templates and Linear's Insights all avoid a wall
  of drop-shadowed cards — a single bordered grid with 1px dividers reads as
  one related band of numbers. This codebase already does this
  (`stat-tile.tsx` inside a `bg-border` grid) — kept, not reinvented.
- **One number is the hero per section; everything else is comparison
  context.** Stripe's home and Linear's Insights never present three
  equally-sized big numbers side by side without a clear primary — the eye
  needs one anchor. Matches the brief's "if three are big, none are."
- **Charts are axis-honest and single-series.** Tremor and Linear both scale
  a line chart to its own data range rather than forcing a 0-max axis, and
  both drop legends in favour of a directly-labelled line end. This is the
  exact shape of the food-cost chart below.
- **Secondary detail lives behind disclosure, not a second page.** shadcn's
  admin blocks and Linear both put the full data table one click away
  (an expandable row, a "view all") rather than shipping two competing
  levels of density on the same screen. `RevenueChart`'s `<details>` table
  already does this — the new `FoodCostChart` follows suit.
- **Status/alerts get their own quiet band, not colour bleeding into the
  KPIs.** Linear's Insights and Stripe's home both keep "needs your
  attention" as a distinct, separately-styled list rather than tinting a
  metric card red. This is why "needs attention" is its own section here
  rather than a red KPI tile.
- **Comparison is explicit in words, never just an arrow.** Every one of
  these products writes "vs last week" next to the delta rather than
  trusting colour alone — already this codebase's convention
  (`StatTile`'s `comparedTo`), extended here to carry two comparisons at
  once for "today."

## Layout, top to bottom

All widths `mx-auto max-w-6xl px-[var(--gutter)]`, section gaps `2rem`
(`tokens.json` → `density.dashboard.sectionGap`), stack gaps within a section
`1rem`. One elevation (`bg-surface` panels on `bg-background`), one radius
(`rounded-lg`), no nested cards.

### 1. Header (unchanged shape)

Title, `{range.label}, Sector 9`, section nav (Sales · P&L · Expenses ·
Rewards · Menu, permission-gated as today), period switcher
(Today/Yesterday/7 days/30 days). This still governs the "selling" section
below — it is a different question from "how did today go," which is always
about today regardless of this switcher.

### 2. Today, compared — priority 1

Three tiles, hairline-divided, matching the existing KPI grid: **Revenue**,
**Orders**, **Average order** — always for the current business day, each
carrying *two* deltas at once ("+12% vs yesterday", "+4% vs last Friday")
rather than the one the switcher happened to select. This is the one change
that couldn't be done by extending the existing single-delta tile without
touching it, so `StatTile` gained an optional `secondaryChangeBps` /
`secondaryComparedTo` pair — additive, so `/app/iq/pnl`'s tiles (which never
pass it) render identically.

"Waiting on payment" is deliberately **not** in this row any more — see
§4. It's a thing to act on, not a fact about how today went, and having it
here diluted the row from three numbers to four with no shared subject.

### 3. Where the money goes — priority 2

One panel: **food cost % by week**, a line rather than a bar (a ratio's
trend matters, not any single week's magnitude), axis scaled to the data
(never 0–100), dashed target line **only when a target exists** — none is
set yet, so the line is absent and the panel says so under the chart rather
than guessing 30%.

Beneath it, two compact rows for the month so far: **Direct costs** and
**Operating expenses**, each as ₹ and % of revenue, sourced from the same
`getProfitAndLoss` the P&L page already uses (no second revenue or cost
figure invented) — with a single link to "See full profit and loss" for
anyone who wants the line-by-line breakdown, rather than duplicating that
page's table here.

Left out on purpose: the P&L's gross/net profit figures. This section
answers "where does the money go," not "how much is left" — that's a
different question the P&L page already owns, and repeating it here would
be a second, unlabelled place those figures could drift apart.

### 4. What's selling, what isn't — priority 3

Two columns at `lg:`, stacked below: **top sellers** (existing, by revenue,
for the switcher's period) and **not selling** — active, published menu
items with zero paid sales in that same period, matched by product ID so a
renamed item never falsely shows as a gap. Both cap at six rows; both are
genuinely fine when empty (a young menu with nothing yet, or — better — a
menu where everything sold).

The daily revenue chart and the delivery/collection split from the previous
design are **cut** from this screen. Revenue-by-day is folded into
"how did the period go" only implicitly via the KPI comparisons; the
delivery-vs-collection channel mix is a real, useful number but answers a
fifth question the brief didn't ask for, and re-adding it here would put a
fourth "big" visual on a screen that is supposed to have three sections and
restraint as the point. It can come back once this language propagates
to a channel-focused screen.

### 5. Needs attention — priority 4

A quiet list, not a red KPI: orders still waiting on a yes/no
(`ordersAwaitingDecision`, already used elsewhere for the same alert),
orders waiting on payment (moved here from the KPI row), and — only when a
food-cost target exists and this month is over it — a single line naming
the amount by which it's over. Empty is the *good* state here and is
worded that way ("Nothing needs your attention right now."), not "No data."

## A gate that was removed, on purpose

The previous build had one blanket empty state for the whole page: zero paid
orders and zero open orders in the selected period hid every section behind
"No sales recorded for this period." That doesn't fit a screen where "Today"
is now always visible regardless of the switcher — a genuinely quiet today
next to a normal "30 days" selection would have hidden the whole page for the
wrong reason. Each section now says what's missing in its own terms instead:
top sellers says nothing sold, the money panel says nothing's been recorded,
attention says nothing needs it. Slightly more text on a fully empty day;
correct on every other day, which is most of them.

## Sizes

- **375–414px**: everything single column; KPI tiles 1-up (was already the
  Tailwind default via `sm:grid-cols-2`, kept); food-cost chart full width;
  selling/not-selling stack.
- **768px**: KPI tiles 2-up; food-cost panel full width; selling/not-selling
  side by side starts here on wider tablets.
- **1440px**: KPI tiles 3-up (three tiles now, not four); selling/not-selling
  `lg:grid-cols-2`; max content width stays `max-w-6xl` — this is a reading
  screen, not a data-grid app, and a full 1440px table would be harder to
  scan than a bounded column.

## States, all eight

- **default** — described above.
- **loading** — `src/app/(app)/app/iq/loading.tsx`, skeleton blocks in the
  exact KPI/chart/list shapes, not a spinner.
- **success** — no distinct transient state beyond default; this is a
  read-only report, not a form.
- **error** — `src/app/(app)/app/iq/error.tsx`, client boundary rendering
  `ErrorState` with a retry.
- **empty** — three independent empties: no sales at all for the period
  (existing), no cost data recorded yet (food-cost panel), nothing needs
  attention (the good kind).
- **disabled** — not applicable. The only controls are navigation links
  (period switcher, section nav); a currently-selected link already
  communicates its state via `aria-current`, and there is no form control on
  this screen to disable.
- **offline** — not applicable, deliberately, not skipped: this is a Server
  Component with no client-side data fetching once rendered, so there is no
  live connection for the browser to lose after load. `OfflineState` exists
  in this codebase for `/app/pos`'s client-side queue, which is a genuinely
  different situation. Fabricating an offline banner on a page with nothing
  to re-sync would be decoration, which the brief explicitly rules out
  ("never invent data to make it look better" extends to inventing states).
- **permission denied** — upgraded from a silent `redirect` to rendering
  `PermissionDenied` in place, so a staff member without `analytics.view`
  sees why, per content.md's "say what happened."

## Motion

`MotionStagger`/`MotionStaggerItem` on the three KPI tiles at `each=0.04`
(~40ms, per the brief) instead of the primitive's 50ms default. `MotionReveal`
on section entrances (food-cost panel, selling/not-selling, attention),
duration from `DURATION.entrance` — no inline durations or bezier arrays
anywhere; both come from `src/components/motion/tokens.ts`, which already
mirrors `motion.md` exactly.
