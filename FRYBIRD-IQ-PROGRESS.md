# FRYBIRD IQ — Autonomous Build Progress

Running log of the QSR-Operating-System build-out, kept so the whole
progression can be reviewed at once rather than reconstructed from chat
history. Newest slice first. Nothing in this log has been committed, pushed
or deployed unless the entry says so explicitly.

---

## Purchased-kit integrations — the five approved of thirteen

**Status:** Local commit on `kit-radix-nova`, **not pushed, not
deployed** — waiting for approval. Production is on `73ea37b`.

Of the 13 components in the purchased kit zip, the KEEP/MAYBE/SKIP
review left five. Every registry source was fetched with
`npx shadcn view @shadcnuikit/<name>` and matched the zip byte for byte
before anything was written. No SKIP component was installed.

**1. `data-table4` → drag-to-reorder in the Menu Manager.** The block's
dnd-kit mechanics (pointer, touch and keyboard sensors, vertical-only
modifier, a grip handle per row) lifted into
`src/components/iq/menu/sortable-list.tsx` and wired onto the category
rail (`menu-control-center.tsx`) and a modifier group's options
(`modifier-list.tsx`). A drop is turned into the **existing** one-step
move action — `moveCategoryAction` / `moveModifierPositionAction`,
`menu.edit`, `planSwap` untouched — called once per row crossed
(`planMove` in `src/lib/menu-admin/reorder.ts`, 3 tests), then
`router.refresh()`. No new ordering logic, schema or action; the ↑/↓
buttons stay as the keyboard and fallback path. New dependencies:
`@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/modifiers`,
`@dnd-kit/utilities`.

**2. `button-group14` → POS quantity stepper.** `ButtonGroup` +
`ButtonGroupText` (`src/components/pos/quantity-stepper.tsx`); the kit's
editable input is gone, the count is read-only with `aria-live`, and both
buttons keep the 56px touch target. `order-builder.tsx` swaps its
hand-rolled −/+ for it; `onQuantityChange` and every price path are as
they were.

**3. `data-table2` → order HISTORY, not the live board.** The shared
`DataTable` gains `rowExpandingFeature` + `createExpandedRowModel`, an
`expandColumn()` (the kit's rotating chevron) and `renderExpanded`. New
read-only repository `src/lib/repositories/order-history.ts`
(`listOrderHistory`: terminal orders in a range with their `order_items`
/ `order_item_modifiers` snapshots and a captured-payment flag — SELECT
only, org-scoped). New page `/app/orders/history` (`orders.view`,
`force-dynamic`), `OrderHistoryTable` with search, status/channel filter
and the expanded lines panel; nav item and breadcrumb added. `/app/orders`
is unchanged.

**4. `Empty` primitive → `src/components/states`.** `EmptyState`,
`ErrorState`, `OfflineState`, `PermissionDenied` now render on
`Empty`/`EmptyHeader`/`EmptyMedia`/`EmptyTitle`/`EmptyDescription`/
`EmptyContent`; props, copy, tones, `role="alert"`/`role="status"` kept.
Offline still says "You're offline · New orders will sync when connection
returns." with no retry — the kit's "Try Again" was not adopted.

**5. `button-group3` → `PeriodSwitch`** (`src/components/iq/period-switch.tsx`,
a Server Component of `Link`s on `ButtonGroup`). Replaces the five
hand-rolled period navs (Finance, Products — keeps `&tab=`, Channels, P&L,
Expenses) and is used by Order history. Still `?range=` resolved by the
server through `resolveRange`; nothing is re-sliced on the client.

**Gates:** typecheck, lint (clean), 488/488 tests in 38 files, both RSC
checks, `pnpm build` (63 routes). **Authenticated verification** — the
standalone build served locally with the production env and an owner
session, figures compared with direct SQL under the page's own rule:
`/app/pos` 200 · `/app/iq/menu` 200 with 9 drag handles · a modifier
group page 200 with 7 · `/app/orders` 200 · `/app/orders/history?range=7d`
200 — 31 finished orders on the page, 31 by SQL, 20 expand chevrons on
page one; `?range=today` 1 and 1 · `/app/iq/channels?range=today` 1 paid
order / `?range=7d` 46, both equal to SQL · `/app/finance?range=7d`
`aria-current` on the right link · Products keeps `&tab=` across periods ·
Expenses last month renders `EmptyState` on the `Empty` primitive. No
"Something didn't work" anywhere. **Not exercised** (no browser in this
session): the drag gesture itself and the stepper taps — both call
existing, tested actions/handlers, but the persisted reorder after a real
drag and a real tap on a tablet still need a hands-on check on
frybirdiq.tech after deploy.

---

## Incident — `/app/iq` fell into its error boundary after `f2eda03`: a Server Component called a function from a "use client" module

**Status:** Fixed on `kit-radix-nova` (local commit, not pushed, not
deployed — awaiting approval). Production is still on `f2eda03` with
the fault; every other Command Center screen renders.

**What happened.** Every signed-in visit to `/app/iq` after the 21:14
UTC deploy logged
`⨯ Error: Attempted to call statusLabel() from the server but statusLabel is on the client`
and the `/app` boundary showed "Something didn't work" (nginx logged 200,
so no smoke test noticed). `open-orders-card.tsx` — a Server Component —
imported `statusLabel` from `order-card.tsx`, which is `"use client"`.
Across the RSC boundary that import is a client reference, not a
function; the call throws only when the page renders with rows to map,
which production has (32 open orders) and an unauthenticated curl never
reaches. typecheck, lint, `next build` and the existing boundary script
(which only checks function-literal props) all passed.

**Fix.** `statusLabel` and `statusTone` moved verbatim into a pure module,
`src/domain/order-status-labels.ts` (6 tests pin every label and tone);
`order-card.tsx`, `orders-board.tsx` and `open-orders-card.tsx` import
from there. No status, label, tone or gate changed.

**Protection.** `scripts/check-rsc-client-imports.mjs`, run by
`check-rsc-boundaries.sh`: a file under `src/app`/`src/components` with
no directive that names-imports from a module that starts with
`"use client"` and *calls* that identifier (`name(`) fails the gate.
`import type` / `type X` are ignored, and rendering `<Name />` or
passing the import as a prop is not flagged — 66 server files import
from client modules legitimately and none trip it. Proven on a probe
file (exit 1) and on the fixed tree (exit 0).

**Verified before asking to deploy:** the standalone build served
locally with the production env and an owner session — `/app/iq` 200,
every section rendered over the real open orders, no error in the server
log; `/app/orders` 200.

---

## Command Center redesign — `/app/iq` on the purchased Sales + E-commerce compositions

**Status:** Implemented on `kit-radix-nova`, gates green (typecheck, lint,
480/480, RSC check, build). **Not deployed, not pushed** — waiting for
review. The browser review could not run in this session (the Chrome
tools were not attached to the session); the local production build was
served and `/app/iq` responds (307 to sign-in unauthenticated, no
runtime error). The signed-in visual pass at desktop / tablet / phone /
light / dark is owed.

**Purchased dashboard selected:** the **Sales dashboard's first row**
(`app/dashboard/(auth)/sales/page.tsx`: `RevenueChart` 4 cols beside a
2×2 of compact KPI cards) over the **E-commerce dashboard's lower page**
(`…/ecommerce/page.tsx`: 12-col grid, 4/4/4 then 8/4 then 8/4). Also
inspected in full source: Default, Website analytics, Finance, Payment.

**Exact purchased source used (kit checkout on disk + registry):**
| FRYBIRD component | Purchased source |
|---|---|
| `overview/sales-trend-card.tsx` | `sales/components/revenue-chart.tsx` (registry `ecommerce-chart2`) — header toggle buttons that are the series totals, `CartesianGrid vertical={false}`, bar chart |
| `overview/kpi-compact.tsx` | `sales/components/balance-card.tsx` figure + `website-analytics/components/stat-cards.tsx` trend badge in `CardAction` |
| `overview/channel-performance-card.tsx` | `ecommerce/components/sales-by-location.tsx` — name, delta badge, share, `Progress` |
| `overview/payment-methods-card.tsx` | `ecommerce/components/visit-by-source.tsx` — `Pie` with inner radius, centre `Label`, dot legend |
| `overview/products-card.tsx` | `sales/components/best-selling-products.tsx` (registry `product-list-card1`) + the kit's tabs-in-`CardHeader` idiom |
| `overview/open-orders-card.tsx` | `ecommerce/components/recent-orders.tsx` (registry `tables14` / `tables9`) — dense table in a card with a header action |
| `overview/attention-card.tsx`, `overview/activity-card.tsx` | kit `Card`/`CardAction` chrome; content is FRYBIRD's `InsightCard` and the order-events feed (no kit block is an alerts or activity panel) |
| Card chrome | the repo's `Card` (radix-nova; `CardAction`, `--card-spacing`, `size="sm"`) |

**Data functions connected (all existing, none changed):**
`getRangeComparison` + `compareOptions`/`resolveCompare`/`deltaBps`
(Revenue, Paid orders, Average order); `getProfitAndLoss(mtd)` (Net
profit · month, `missing` until expenses exist); `getDashboard(7d | range)`
series (Sales trend, toggle Revenue ⇄ Orders); `getChannelBreakdown(range)`
(Channels); `getPaymentsLedger(range).byMethod` + `capturedTotal`
(Payment methods donut, "captured", never revenue); `attentionCards` via
the shared `attentionInput` (Needs attention, top 3, urgent count on the
strip); `getRightNow` tiles through the existing `RightNow` drawers
(Order health); `dashboard.topProducts` + `notSelling(range)` (Products
tabs); `listActiveOrders` (Open orders — late = past `estimatedReadyAt`,
same fact Live uses); `listRecentOrderEvents(orgId, 8)` (Activity).

**Deliberate omissions:** the four "Not yet tracked" KPI dashes (food
cost %, labour %, prime cost, gross profit) and the "Where money goes"
panel left the Overview — they live on Food cost & P&L, and Net profit's
card says "Not yet tracked" with the cost-lines count. No loyalty card:
no aggregate loyalty query exists and none was invented.

**Removed (orphaned by the redesign):** `iq/kpi-cards.tsx`,
`iq/revenue-chart.tsx`, `iq/stat-tile.tsx`, `iq/top-sellers-table.tsx`,
`iq/not-selling-table.tsx`, `iq/overview-kpis.tsx`.

**Theme:** `x29171c`'s exported CSS is client-rendered on the generator
and was not retrievable headlessly; the page uses the repo's existing IQ
token set (`--panel`, gain/loss/flag, `--chart-1…5`, `--radius`).

---

## Batch: Menu + Analytics + Admin + Command Center — slice 4 of 4: Command Center

**Status:** Complete on `kit-radix-nova`, gates green (typecheck, lint,
480/480 in 37 files, RSC check, build — 62 routes). **Not deployed; the
whole batch now waits for one approval.** UI only: no new query, no
new rule, no model call.

**Routes changed:** `/app/iq` (Overview), `/app/iq/live`,
`/app/iq/activity`; **new** `/app/iq/alerts` and `/app/iq/brief` (both
`analytics.view`, in the sidebar's Operations group and the breadcrumb;
Overview's active-match excludes them).

**Purchased kit inspection (`@shadcnuikit`).** Searched "alerts status
list warning", "AI assistant chat prompt".
- `tables5` / `tables11` (status tabs, filters) and `tables14` (orders
  with expandable rows) — inspected for Alerts; an alert is a finding
  with a cause and two actions, not a row, so the app's own
  `InsightCard` (via `AttentionCards`) stays the unit and the kit
  contributes the grouped-by-status structure (sections per level with
  counts) rather than a table.
- Nothing in the registry is an AI/chat block (the search returns
  menubars, progress bars and badges), which settles it: the AI brief
  page is a `Panel` + `CapabilityPanel` foundation, not an imitation of a
  chat UI, and it has no input box because nothing would answer it.
- `skeleton2–5` — inspected; `/app/iq/loading.tsx` already covers the
  segment.

**What changed:**
- **`CommandCenterNav`** on Overview, Live, Activity, Alerts and AI
  brief — the Alerts tab carries the urgent count (NOW + TODAY) as a
  loss-toned badge. It replaces Overview's inline text nav, whose
  analytics links now live in the sidebar's Analytics group.
- **Alerts (new):** the Overview's `attentionCards` rules, fed by the
  same repositories through a new pure helper
  (`src/lib/iq/alerts.ts` — `attentionInput`, `daysOfHistory`,
  `groupAlerts`, `urgentCount`; 6 tests), so the two screens can never
  disagree. Four tiles (needs a hand now, later this week, late orders,
  cash unsettled — the last `missing` when there is none), the cards
  grouped Now / Today / This week / Setup with each level's note, a
  **What the rules can see** panel (five connected signals; **Rush
  mode**, **Smart 86** and **alerts to your phone** marked not
  connected with the reason), and **Order health right now** — the
  Overview's own `RightNow` tiles with their drawers. Live via the
  order-events channel with a 30 s fallback.
- **AI brief (new):** "Not connected" said in the panel meta and the
  trust line; what the brief will contain, what it will be allowed to
  read (each a tool over an existing repository), and a prerequisites
  panel — conversation tables present, `ANTHROPIC_API_KEY` present or
  not on the server (boolean only, never the value), tools / brief /
  Ask FRYBIRD not built. No fake result, no disabled input.
- **Overview:** the strip; "All alerts →" as the attention panel's
  action; "Live operations →" stays on Right now. Everything else on
  the screen is untouched.
- **Live operations / Activity:** the strip and a trust line that says
  how the screen updates (channel, fallback) and how far back it reaches.

**Functionality preserved:** every Overview control, comparison and
panel; Live's three tables and links; the activity feed; all
`analytics.view` gates.

---

## Batch: Menu + Analytics + Admin + Command Center — slice 3 of 4: Admin

**Status:** Complete on `kit-radix-nova`, gates green (typecheck, lint,
475/475, RSC check, build). **Not deployed.** UI only: no settings
write, no new notification channel, no change to hardware or receipt
actions; every gate is the one that was there.

**Routes changed:** `/app/admin/restaurant`, `/app/admin/hardware`,
`/app/admin/receipt`, `/app/admin/audit`; **new** `/app/admin/notifications`
(`settings.manage`, in the sidebar's Admin group and the breadcrumb);
`/app/admin/loading.tsx` for the whole segment.

**Purchased kit inspection (`@shadcnuikit`).** Searched "settings page
account preferences", "notifications list".
- `dashboard-modal15` ("Notification settings dialog with described
  radio options") — inspected; its described-option row (label,
  description, control) is what `SettingRow` already is (from
  `switch-card1`). Not adopted as a form: there is no preference to
  save yet — one manual channel and one in-app alert — and a form that
  saved nothing would be a fake control. The Notifications screen shows
  channels as a `CapabilityPanel` instead.
- `dashboard-modal20` ("Activity dialog with tabs, notification list")
  — inspected for the audit log; the log is a table with a detail
  sheet, not a feed, so `tables10`'s filter menu + the shared `DataTable`
  were the right shape.
- `tables10` / `tables12` — the audit log moves onto `DataTable`: search
  now also matches the entity id; filter menu by entity and by actor
  with counts; sortable time; row → Sheet unchanged in what it shows
  (raw before/after JSON, deliberately not a reformatted diff).

**What changed:**
- **`AdminSectionNav`** on all five Admin screens — Restaurant · Bill &
  Receipt · Printers & devices · Notifications · Audit log — each
  shown only with its own gate (`adminNavAccess()` resolves the three
  rules the sidebar already uses). `HardwarePage` and `ReceiptDesigner`
  gained a `sectionNav` slot under their own headers rather than a
  second header above them.
- **Restaurant:** a trust line that names what is still unset (GSTIN,
  legal name, outlet, map pin, GST state, rates) from the same rows;
  the sections are Panels in a two-column grid (Business; Operations +
  GST rates; Location; Delivery; Rewards full-width with "Change on
  Rewards" as the panel action). Every value and every `SettingRow` is
  the one that was there; the operations form is unchanged.
- **Notifications (new):** what the `NotificationProvider` interface
  can do today — WhatsApp by link (a person presses send) and the staff
  new-order alert connected; Business API, SMS, email and push not —
  plus a Sender panel (business name, the runtime `SITE_URL` the order
  link uses, with a red badge when unset because sending is refused
  without it) and the order message rendered from
  `src/lib/notifications/messages.ts` with placeholder values under a
  `SampleTag`. No preference form, no fake toggles.
- **Audit log:** trust line (latest N events, distinct actors, how far
  back), the `DataTable` with filters, empty state for a log with no
  events.

**Functionality preserved:** `settings.manage` / `audit.view` /
`integrations.manage`-or-`orders.create` gates; the operations settings
form; every printer/device action and the receipt designer's
save/apply/restore; the audit Sheet's exact JSON.

---

## Batch: Menu + Analytics + Admin + Command Center — slice 2 of 4: Analytics reports

**Status:** Complete on `kit-radix-nova`, gates green (typecheck, lint,
475/475, RSC check, build). **Not deployed.** UI only: `getMenuPerformance`,
`getChannelBreakdown`, `getProfitAndLoss`, `foodCostWeeklySeries` and
`listExpenses` are read exactly as before; no figure is computed a
second way. Every number on these screens is a repository field or a
share of one (`ratioBps`).

**Routes changed:** `/app/iq/products`, `/app/iq/channels`,
`/app/iq/pnl`, `/app/iq/expenses`. Sidebar: the Analytics group gains
"Food cost & P&L" and "Expenses" (same `analytics.view` gate; both were
already excluded from Overview's active match).

**Purchased kit inspection (`@shadcnuikit`).** Searched "analytics
dashboard chart cards", plus the earlier chart/table searches.
- `tables12` — its sort / page-size / pagination mechanics are now one
  shared component, **`DataTable`** (`src/components/iq/data-table.tsx`,
  TanStack v9 `tableFeatures` + `useTable`, typed `columnMeta` for
  alignment and responsive visibility). Callers own their toolbar and
  narrow the rows first; the engine only sorts and pages. First consumer:
  the products performance table (search, category filter menu with
  counts, "include removed from menu", CSV export on `reports.export`).
- `tables10` — the counted checkbox filter menu, reused for categories.
- `ecommerce-chart1` — already the shape of `ChannelChart`; `ecommerce-
  chart2` ("Revenue Chart … Last 28 days", a bar chart with a
  series toggle in the card action) was inspected and not taken: the
  channel series is a stack, not a toggle, and the period is the server's.
- `line-chart1` — the existing `FoodCostChart` is this shape (line,
  no dots, monotone, tooltip); its period buttons were not taken because
  the P&L period is calendar-month by rule.
- `tabs1` — `Tabs` with the `line` variant for Products / Categories.
- `stat-card1` — `KpiTile` stays the design system's card; on Channels
  it now carries the real `deltaBps` and "vs the previous …" the old
  `StatTile` showed, so `StatTile` has one fewer consumer.

**What changed:**
- **`AnalyticsSectionNav`** on all four reports — Products &
  categories · Channels · Food cost & P&L · Expenses · Customers
  (`customers.view`) — with **Waste** listed unlinked and marked "Not
  connected" (roadmap 3.3). Same strip pattern as Menu.
- **Products & categories:** four `KpiTile`s (product revenue; top
  product as its share with the name beneath; top category likewise;
  recipes with lines *x of y* — the margin prerequisite), a trust line
  that says margin is not connected and why, then Tabs: *Products*
  (best sellers card, a share-of-revenue `BarList` for the top ten, and
  the full sortable table) and *Categories* (share `BarList` + table).
  `?tab=categories` deep-links.
- **Channels:** one `KpiTile` per channel with the real delta chip and
  share as meta, the leader emphasised; chart and table in Panels;
  delta columns coloured by the gain/loss tokens (and always with a sign).
- **Food cost & P&L:** four tiles (revenue, gross profit, net profit
  emphasised, **food cost vs target** — "over target by 2.1 pts, about
  ₹x of profit per point"); the statement in a Panel, unchanged in
  arithmetic; **Where the money went** (the existing donut) and **Food
  cost by week** (the existing eight-week chart, previously only on
  Overview) beside it; an honest line that theoretical food cost from
  recipes is roadmap 3.5. Empty state kept for a month with no expenses.
- **Expenses:** tiles (recorded, direct with share, fixed with share,
  largest category), a by-category `BarList`, and the ledger table with
  the behaviour as a badge ("Moves with sales" / "Fixed"); the
  "Expense recorded" notice restyled on the gain tone.

**Functionality preserved:** every period option and `?range=` link,
`analytics.view` gates (`finance.view` still decides who sees "Record
expense"), the by-name match note on legacy product lines, the
non-operating section and food-cost-over-target message on the P&L,
the `saved=1` confirmation on Expenses.

---

## Batch: Menu + Analytics + Admin + Command Center — slice 1 of 4: Menu sections

**Status:** Complete on `kit-radix-nova`, gates green (typecheck, lint,
475/475, RSC check, build). **Not deployed** — the whole batch waits for
one approval. UI only: every server action, repository call and
permission gate is the one that was there.

**Routes changed:** `/app/iq/menu` (hub), `/app/iq/menu/modifiers`,
`/app/iq/menu/combos`, `/app/iq/menu/media`, `/app/iq/menu/review`.
`/app/inventory` touched only to consume the now-shared capability
panel.

**Purchased kit inspection (`@shadcnuikit`).** Searched "product list
grid catalog", "file manager media gallery upload", "settings form
profile", "activity timeline feed log", "page header tabs navigation".
- `tables9` (segmented status filters with counts) — the pattern behind
  the activity-log kind filter on Review: pills with per-kind counts,
  only kinds that have changes.
- `tables12` / `tables16` — the `Card`+`Table` shell, status badges and
  right-aligned row actions, as already adopted on Inventory and
  Finance; reused for Modifiers, Combos and the two Review tables.
- `product-category3` ("Category layout with filters or tabs and product
  grid") — inspected for the hub; the existing Control Center already
  is this layout (category rail + filters + card grid, restyled in wave
  3), so it was kept, not rebuilt.
- `attachment1–4`, `combobox1–4` — inspected for Media; the existing
  `MediaLibrary` (search, unused filter, upload, delete) already covers
  the library, so only its page shell changed.
- `navigation-menu2–4`, `dashboard-shell5/9` — inspected for a section
  strip; none is a routed sub-navigation, so `MenuSectionNav` is a
  small link strip on the kit's line-tab look (`border-b-2` active
  tab), with the review count as a flag badge.

**What changed:**
- **`MenuSectionNav`** on all five Menu screens — Products · Modifiers ·
  Combos · Media (`menu.edit`) · Review changes (`menu.publish`, with the
  draft count). Replaces the hub's four outline buttons and the "←
  Menu Control Center" back-links.
- **Hub:** a `DataTrust` line stating what is live (products,
  categories, modifiers, combos; availability per channel and timed
  unavailability — the availability engine's `SCHEDULED_UNAVAILABLE`
  already exists) and what is not (channel-specific pricing). The
  health strip and Control Center are unchanged.
- **Modifiers:** table — group (option count, how many carry a price),
  first three options, the selection rule in words ("Exactly one", "Up
  to 3, optional"), Draft/Live badge, Publish/Delete via the same bound
  server actions; `EmptyState` with a first-group action.
- **Combos:** table — photo or "No photo", SKU, category, `formatINR`
  price, Draft/Live/Archived badge, the `AvailabilityBadge`, Contents
  and Edit; `EmptyState` explaining a combo is a product typed Combo.
- **Review:** two panels — "Waiting to publish" (item, kind badge,
  Publish per row; Publish all in the header) and "Activity log" (when,
  item linked to its editor, field, old → new with the old struck
  through) with the kind filter as counted pills.
- **Media:** page shell only (header, section nav, trust line with the
  unused count); `MediaLibrary` untouched.
- **`CapabilityPanel`** promoted to `src/components/iq/ui` with an
  `items` prop; Inventory passes its list. The inventory-specific file
  is removed.

**Functionality preserved:** publish/delete/publish-all actions and
their confirm prompts, `menu.view` / `menu.edit` / `menu.publish` gates
(Media still requires `menu.edit`, Review still `menu.publish`), the
`?kind=` filter on Review, every link target.

---

## Slice (UI Kit): Finance workspace — the payments ledger regrouped, nothing redefined

**Status:** Complete on `kit-radix-nova`, gates green (typecheck, lint
with no warnings, 475/475 tests in 36 files, RSC check, `pnpm build`).
**Not deployed** — awaiting review and explicit approval. Read-only UI
slice: no change to `getPaymentsLedger`, the P&L, expenses, payments,
refunds, tax or pricing code; no schema; no second financial data path.
Every figure on the screen is a field of the ledger the page already
loaded, or a regrouping of its rows.

**Purchased kit inspection (`@shadcnuikit`, real source via the CLI).**
Searched "finance dashboard", "payment transactions table", "revenue
chart expenses".
- `@shadcnuikit/tables10` ("Transaction history table with date picker
  filter, category filter, card account details, and numbered
  pagination") — **adopted**: the checkbox filter menu with a count
  badge (method and status here, category there) and the numbered
  pagination strip. **Not adopted**: its single-date `Calendar` picker
  (the ledger's period is already the server's `resolveRange`, which
  keeps every total consistent with the rest of IQ), card-brand logos,
  ± signed amounts, row selection and bulk delete.
- `@shadcnuikit/tables16` ("Payment list with card style rows, sortable
  headers, inline transaction detail columns, quick actions, and
  pagination") — **adopted**: sortable amount/time headers and the
  per-payment detail set (reference, fee, who, when). Its inline
  `min-w-[1250px]` detail row is a Sheet here — on a tablet a wide row
  is a horizontal scroll, a sheet is a tap. Its "Mark as paid" and
  billing cycles were not taken; no such action exists.
- `@shadcnuikit/tables12` — the sort/page/export mechanics already
  written for Inventory, reused as-is (same TanStack v9 pattern).
- `@shadcnuikit/ecommerce-chart1` ("Charts for store visits, sales, and
  revenue") — **adopted** through the app's existing `ChannelChart`
  adaptation: `Card` + `BarChart` + `XAxis` + tooltip, stacked. Colours
  are `--chart-1` / `--chart-3`, the two neutral IQ series tokens; a
  payment method is not a status.
- `@shadcnuikit/line-chart1` ("balance, trends") — inspected, not used:
  its period buttons re-slice a client-side array, whereas the period
  here changes the server query; a balance line would also imply a
  running balance the ledger does not hold.
- `@shadcnuikit/tabs1` — the plain shadcn `Tabs`; used with the
  `line` variant for Payments / Refunds.
- `stat-card1` — re-read; the app's `KpiTile` remains the design
  system's version (serif figure, `missing` state).

**What it is (`/app/finance`):**
- Header: the same five server-side periods; **Profit & loss** and
  **Expenses** links (existing `/app/iq/*` routes, shown with
  `analytics.view`) so the finance answers are one click apart without
  moving any route.
- `DataTrust`: "● Payments ledger live · N records", "● Captured only
  are summed; pending and failed are listed, never counted", "● Cash
  sessions, rider handovers and reconciliation not connected (roadmap
  5.1–5.3)".
- Four `KpiTile`s from ledger fields: **Captured** (count, emphasised
  when non-zero), **Cash payments** — cash as a share of captured,
  with the ₹ cash / ₹ provider split beneath; `missing` when nothing
  was captured — **Provider fees**, **Refunded**.
- **Captured by day** — the stacked chart (cash under, provider over)
  for multi-day periods; for a single day, two figures instead of a
  one-bar chart. Bucketed by IST business day.
- **By method** — `BarList` of each method's share of captured, with
  counts (replaces the old three-column table).
- **Payments / Refunds tabs**. Payments: search (order number, who took
  it, provider reference), filter menu (methods present, with counts;
  statuses), sort by order / fee / amount / time, 10/20/50 rows,
  "1–20 of 143 · 143 in the period", CSV export with `reports.export`
  (rupees as plain decimals, ISO UTC timestamps, every cell quoted).
  Row → **Sheet**: amount in the serif, status and method badges,
  provider, reference (mono), fee, refunded so far, left to refund,
  taken by, full timestamp; **Refund this payment** only with
  `orders.refund` and only while something is left — it opens the
  existing `RefundDialog`, unchanged. Refunds: the existing table.
- States: `loading.tsx` shaped like the screen; `error.tsx` ("The
  payments ledger couldn't load" — no figure shown until it does);
  `EmptyState` for a period with no payments; a no-match row with
  clear-filters; `PermissionDenied` without `finance.view`.

**New pure module** `src/lib/finance/ledger-view.ts` (9 tests):
`capturedByDay` (captured only, by business day, cash vs online, quiet
days are zeros), `methodShares`, `tillSplit`, `paymentsCsv`, and the
method/status labels the old table kept privately. `tillOf`: cash is
the one method with no gateway record.

**Removed:** `src/components/staff/payments-table.tsx` (only the
finance page used it) → `src/components/finance/payments-table.tsx`.

**Files:** `src/app/(app)/app/finance/{page,loading,error}.tsx`,
`src/components/finance/{payments-table,captured-chart}.tsx`,
`src/lib/finance/ledger-view.ts` + test.

**Owed before "done":** the walk on frybirdiq.tech at 1440 and 390 —
periods, chart tooltip, filters, sort, page, export, the sheet and the
refund hand-off, the refunds tab, empty and no-match states.

---

## Slice (UI Kit): Inventory workspace — `tables12` mechanics over real master data, honest about what is not connected

**Status:** Complete on `kit-radix-nova`, gates green (typecheck, lint
with no warnings, 466/466 tests in 35 files, RSC check, `pnpm build`).
**Not deployed** — the owner asked for explicit approval before any
deploy, so the frybirdiq.tech walk is still owed. Read-only UI slice: no
inventory write path, no schema, no change to repository, action, money,
tax, order or inventory logic. No figure on the screen is invented.

**Purchased kit inspection (`@shadcnuikit`, real registry source via the
CLI, not screenshots).** Searched "inventory", "products table filter",
"stats card metric".
- `@shadcnuikit/tables12` ("Product inventory table with sortable
  columns, status filter, CSV export, add product dialog, page size
  selector, and pagination") — **adopted**: sortable headers (with an
  explicit asc/desc arrow and `aria-sort`, an improvement on its neutral
  glyph), the checkbox filter menu with a count badge, the page-size
  `Select`, the numbered pagination strip (`getPageNumbers` kept
  verbatim as `pageNumbers`), the row action menu, and CSV export.
  **Not adopted**: row selection, bulk status changes, duplicate and
  delete (no write path exists for any of them), the add-product form
  with price/stock fields (the existing `IngredientForm` is the add
  dialog), and its per-status tint classes (`amber-500/15` etc. — status
  is `Badge success/outline` per MASTER.md).
- `@shadcnuikit/tables9` — already the basis of the app's table shell;
  re-read, nothing new taken.
- `@shadcnuikit/stat-card1` ("KPI and pipeline cards") — inspected; the
  app's `KpiTile` already carries the design system's version of this
  card, including the `missing` state this screen needs. Its lime/indigo
  split bar was not taken (colour is status-only on the IQ surface).
- `@shadcnuikit/welcome-card1` ("Onboarding and empty-state cards") —
  inspected; it is a congratulations card with a `+65%` figure and a
  `DASHBOARD_BASE_URL` star image, not an empty state. The app's
  `EmptyState` (§56) is used instead.

**Kit-version note.** The kit's table blocks are written for TanStack
Table v8 (`useReactTable`, `getSortedRowModel`). The repo has
`@tanstack/react-table` **9.2.4**, whose v8 compat export is untyped —
every callback came back `any`. The table is therefore the first
TanStack usage in the repo and is written on v9's own API:
`tableFeatures({ rowSortingFeature, rowPaginationFeature,
sortedRowModel, paginatedRowModel, columnMeta })`, `useTable`,
`createColumnHelper`. The `columnMeta` slot types the per-column
alignment and responsive visibility. `Select` was added from the
canonical registry (`radix-ui`, style `radix-nova`); its generated
`import { cn } from "cn"` was corrected to `@/lib/utils`.

**What it is (`/app/inventory`):**
- Header with a Suppliers link; a `DataTrust` line — "● Master data
  live · N ingredients, N active suppliers" / "● Stock, waste and
  purchasing not connected".
- Four `KpiTile`s: Ingredients (active · packaging), Priced (x of y,
  emphasised while any is unpriced), Suppliers (how many active
  ingredients have no usual supplier), and **Stock on hand as
  `missing`** — "Not yet tracked", with the note naming roadmap 3.2.
  The old `0 g` on-hand column is gone from the list and the ingredient
  page's tile now reads "Not tracked"; a zero that was never measured is
  not a quantity.
- **Needs attention** (new pure module `src/lib/inventory/attention.ts`,
  7 tests): unpriced ingredients first, then prices older than 30 days
  (oldest first), then no usual supplier — active ingredients only,
  derived from `costPerBaseUnit`, `lastPricedAt` and `supplierId`. Six
  shown, the rest counted with a pointer to the "No price yet" filter.
- **Where ingredients come from** — `BarList` of the top five active
  suppliers by how many ingredients name them (share of sourced
  ingredients).
- **What this screen knows** (`CapabilityPanel`) — six capabilities,
  each "● Connected" or "● Not connected" with the roadmap slice that
  connects it: ingredients & suppliers, price records (connected); stock
  & movements 3.2, waste 3.3, consumption 3.4, purchasing 3.7 (not).
- The ingredients table: search across name / SKU / supplier; filters
  Active, Inactive, No price yet, Ingredients, Packaging; 10/20/50 rows;
  "1–20 of 49 · 61 in total"; columns collapse by breakpoint (yield ·
  waste ≥ md, supplier ≥ lg, last priced ≥ sm); "Never" priced shows in
  the flag tone; row menu → View ingredient / Record a price (deep-links
  to `#price` on the ingredient page); Export CSV renders only with
  `reports.export` and writes the sorted, filtered rows with `formatINR`.
- States: `loading.tsx` shaped like the finished screen; `error.tsx`
  ("Inventory couldn't load", stale-deployment aware); `EmptyState` with
  "Add the first ingredient" (or the permission sentence) when there are
  no ingredients; a "Nothing matches" row with a clear-filters action;
  `PermissionDenied` without `inventory.view`; add/price controls only
  with `purchasing.manage`, re-checked in every action.

**Files:** `src/app/(app)/app/inventory/{page,loading,error}.tsx`,
`src/app/(app)/app/inventory/ingredients/[id]/page.tsx` (on-hand tile,
`#price` anchor), `src/components/inventory/{ingredients-table,
capability-panel}.tsx`, `src/components/ui/select.tsx` (new),
`src/lib/inventory/attention.ts` + test.

**Owed before "done":** the walk on frybirdiq.tech at 1440 and 390 —
sort, filter, page, export, the empty and no-match states, and the
ingredient page anchor — once the deploy is approved.

---

## Fix — realtime subscribers shared one channel; the staff app fell into its error boundary

**Status:** Fixed and deployed (`1025fc0`) at 17:19 UTC. Gates green
(459/459, 2 new). Reported by the owner minutes after the Phase 0–2
deploy as "Something didn't work" (the `/app` error boundary's generic
state) — the server journal and nginx showed no error, so it was a
browser-side crash.

**Cause.** `useOrderEvents` named its channel `orders:<orgId>`. The
new-order alert in the chrome and the page's own subscriber
(`LiveRefresh` on Orders, Deliveries, Live and Activity; `KdsBoard` on
KDS) both mounted it. `supabase.channel(name)` returns the **existing**
channel when the name matches (`realtime-js` 2.116 `RealtimeClient.js:340`),
and a channel that has already joined throws on the next `.on()`:
`cannot add postgres_changes callbacks for realtime:orders:<org> after
subscribe()` (`RealtimeChannel.js:421`). Effects run in tree order, so
the alert subscribed first and the page's `.on()` threw inside its
effect — which React routes to the nearest error boundary. Every one of
those five screens crashed for any member who can see orders. This
deploy was also the first time the browser Supabase client ran anywhere
in the app (`git grep supabase/client` at `573dcab` finds no client
consumer), so nothing earlier had exercised the path.

**Fix.** Postgres-changes channel names are unique per subscriber
(`uniqueChannelName(base, seq)`, a per-mount sequence); the `org_id`
filter, not the name, is what scopes them. The customer's `order:<id>`
broadcast keeps its exact name on purpose — for broadcast the channel
name *is* the topic the database trigger sends to. Test: two subscribers
to one organization never resolve to the same name.

**Verified on production.** Remote `BUILD_ID` = local; the shipped
chunk carries the new template; service active, 0 restarts, journal
clean. Not verified: a signed-in browser walk of the five screens — the
owner should open Orders and KDS once and confirm the board renders.

---

## Roadmap Phase 0–2 deployed — Razorpay behind the interface, realtime on `order_events`, nightly backups proven

**Status:** Deployed (`6bbde8a`) at 16:12 UTC; migration `0027` applied
and verified; `kit-radix-nova` pushed (new remote branch) and `main`
fast-forwarded `537f396 → 3bc9b46` on origin — roadmap 0.1 closed. Gates
green (457/457 across 33 files; 60 routes; RSC check OK).

**What this deploy carried.** The service's last restart before this one
was 13:41 UTC (`journalctl -u frybird`), so everything from `425b2a7` to
`6bbde8a` went live together: Design phase 2 wave 3 (`492fd8c`), the
Driver App prototype (`9078863`), roadmap 0.5 permission tightening
(`18cd4e0`), 0.6 dead dependencies (`903a6fd`), 1.1–1.4 Razorpay
provider / online checkout / webhook / refund write path (`b5c1933` …
`65bfead`), 2.1–2.4 realtime (`688cb85` … `52ec5f5`) and 0.7 backups
(`6bbde8a`).

**Migration 0027 (realtime).** Read on production before and after: 27 →
28 applied; `order_events_broadcast_trigger` enabled on `order_events`;
the `supabase_realtime` publication now carries `order_events`,
`products` and `product_availability` (it carried nothing before);
`realtime.send(jsonb, text, text, boolean)` exists, so the customer
tracking broadcast is live. The browser-level "under 2 s" checks for
2.1–2.4 were **not** run in this session — the database side is proven,
the socket side is not.

**Razorpay in production.** `/etc/frybird/env` has no `RAZORPAY_*` keys.
They are optional in the env schema, so `availableMethods()` offers cash
and COD only and `/api/payments/razorpay/webhook` answers 503 (not
configured) — both verified on the live site. Roadmap 1.2's "₹1 paid by
UPI on the live site" is therefore **not yet met**; it needs the live keys
(decision 1 in `docs/ROADMAP.md`) in the env file and a service restart.

**Backups (0.7) — done-when met.** On the VPS: `postgresql-client` and a
local scratch `postgresql` (18.6; Supabase is 17.6, and a newer `pg_dump`
against an older server is supported) installed; `frybird-backup.timer`
enabled, next run 22:06 UTC; first dump `frybird-20260914-1615.dump` —
61 tables of data (all 61 public tables), 304 KB, `/var/backups/frybird`
0700, file 0600. **The restore check failed on its first run:**
`pg_restore` ran as the `postgres` OS user and could not open the
root-only dump (`Permission denied`), and the script's `grep "ERROR"`
missed pg_restore's lowercase `error:` line, so it reported zero problems
while restoring nothing. Fixed in `3bc9b46`: root opens the file and
`pg_restore` reads stdin; the error grep is case-insensitive; a
table-count guard fails loudly; the scratch database is dropped on every
exit. Re-run on the VPS: 61 tables, 62 orders, 66 order items, 62
payments, 49 products, 14 customers — identical to production's counts;
the 54 restore warnings are `schema public already exists` and RLS
policies naming Supabase's `authenticated`/`anon` roles, which a scratch
server lacks. Offsite copy (`BACKUP_RCLONE_REMOTE`) is not configured; the
dump lives only on the VPS until it is.

**Read-only Products check** (run before anything else): 66 order lines;
the one placed since the join fix carries a `product_id` that matches its
snapshot name; 66/66 tie to a live product; 37 of 49 live products have
not sold in 7 days, as before. No production order, product, customer or
device was created, changed or removed by this session — the only
production writes were migration 0027 and the backup files on the VPS.

---

## Fix — Products analytics tied every sale to "Removed from menu"

**Status:** Fixed and deployed (`573dcab`). Gates green (444 tests, 1
new). Verified read-only on production before and after; no product,
order or line was created, changed or removed.

**Cause.** Placement wrote every order line with `product_id = NULL`
(`placeOrderRows` passed `productId: null` explicitly), and every product
report — `getMenuPerformance`, `notSelling`, `productLastSales` — joined
sold lines to the catalogue on `product_id` alone. So Products showed
"Removed from menu" for items live on the POS, the only category was
"Removed products", and the Overview's Not selling rule treated every
product as never sold. Read-only check on production: 65 of 65 lines had
no id; all 65 snapshot names match exactly one live product; product
names are unique in the org. Not stale data, not a status mapping — a
query/join keyed on a column nothing ever wrote.

**Fix (code only).** `MenuProduct` now carries the catalogue `id` (null
only from the static transcription); the order-line snapshot keeps it as
`productId` and placement writes it — the copied name and price remain
the record (§51). Reports tie lines by id, or, for lines placed before
the id was recorded, by exact snapshot name within the org, and say so
(`matchedBy: "name"`, shown as "· by name" on Products). `notSelling`
and `productLastSales` join on id OR (id IS NULL AND name). Legacy rows
keep their null id; new orders carry one.

**After.** Products: Burgers 88.3%, Smash Burgers, Chicken, Wraps;
photos; 0 / 12 costed recipes. Overview: Not selling lists the products
that genuinely have not sold (37 of 49 live products in the range).

---

## Design phase 2, wave 1 — Orders, Live operations, lists and reports

**Status:** Deployed (see deployment record). Gates green (443 tests).
Verified read-only on the local build against production data at 1440
and 390 — no real record was created, changed or removed; the earlier
simulated-device flows were not re-run against production.

**Orders** (`orders-board.tsx`): title with dot-and-word counts (open ·
due soon · late — the late count is new), the search as a proper input,
status pills in ink with counts, the type filter as the segmented
control, rows as panels with a quiet hover and the late edge, and honest
empty states ("No open orders" vs "No orders match" with Clear filters).
Every action is the same `advanceOrderAction` / sheet as before.

**Live operations**: KPI tiles (late in loss red), a live data-trust line
("refreshes every 15 s · last at …", "every figure is a fact from the
order rows"), and three panels — Late, Awaiting a decision, In the
kitchen — whose headers state the count and the oldest wait.

**Lists**: Customers segments as ink pills with counts; Staff status on
the signal tokens; every hand-rolled panel in the app moved to the one
panel look; every period nav (Finance, Products, Channels, Expenses,
P&L) became the same segmented control; the Overview nav item no longer
stays lit on P&L, Expenses or Rewards.

**Reports**: Profit & loss header states the period, "captured payments
only" and INR; the three figures are tiles; the statement sits in a
panel. Expenses ledger in a panel. Products / Channels / Finance inherit
the tiles (a name such as "OG Frybird Classic" or "Cash" stays in the
interface face — the serif is for figures).

**KDS**: tickets on the panel ground with a loss edge when late; nothing
else, the POS/KDS motion ceiling stands.

**Seen, not changed (data, not design):** every product on Products
reads "Removed from menu" and the only category is "Removed products",
while the same items are live on the POS — the analytics join between
sold lines and the menu rows needs a look. Thirty-odd open orders from
the launch days are still open and late by thousands of minutes; they
should be completed or cancelled from Orders.

**Wave 2 (deployed `19919ff`):** the Promotions workspace — title,
live/draft counts as dot-and-word, library "New" as the ink action,
panel titles in sentence case, save / draft / duplicate / delete on the
primitive styles, handlers untouched — and the Printers page section
titles.

**Next waves:** Menu control centre and product cards, ingredient
detail and supplier screens, the receipt designer column headers, then
POS touch polish within the 120 ms ceiling.

---

## Design system — the FRYBIRD IQ OS language across the staff app (phase 1)

**Status:** Foundations, primitives, shell and the Overview are done and
deployed (see deployment record); every other screen inherits the new
type, tokens and primitives and was checked visually. Gates green (443
tests). Reference: `Frybird IQ OS.dc.html` (the uploaded template) — "the
number is the hero, everything else is quiet".

**Foundations.** Instrument Sans for the interface and Instrument Serif
for money at display size, bound on `[data-surface="iq"]` only (the
customer site keeps Archivo / Inter). New IQ tokens (MASTER.md §3 "IQ",
§5 "IQ signals", tokens.json `color.iq`): gain / loss / flag with soft
tints, inverse, panel, muted `#eceef0`, a warm neutral ramp, `--radius`
12px, `font-money`. Contrast measured: every signal pair ≥ 4.5 on its
tint, ≥ 5.0 on the panel.

**Primitives.** Button (red = the page's one action, `inverse` ink =
a panel's own action, outline, ghost, red-ink destructive; 36 / 32 / 44px;
3px brand focus ring), Input (40px), Card (flat white panel, hairline,
12px), Badge (sentence-case pills on the signal tokens — no Tailwind
greens/blues), Table (13px rows, 11px uppercase header, quiet hover),
Tabs (segmented, cream active), PageHeader, Empty / Error states,
SettingRow, StatTile and MiniStat (serif figure, chip delta). New
`src/components/iq/ui`: `KpiTile` (serif 40 / 28, count-up on load),
`DeltaChip` / `StatusWord` / `DataTrust` (a dot and the word, never colour
alone), `Panel`, `InsightCard` (finding · evidence · impact · action),
`BarList`, `CountUp`.

**Shell.** Sidebar 224px: the mark, "FRYBIRD IQ", the store block (org +
location from their rows), 11px group labels, cream active row with a
brand-red bar that slides between items (Motion `layoutId`), signed-in
footer. Header 56px with the ⌘K search as an input. Phone: bottom tabs
(Overview · Orders · POS · Kitchen · More) from the same nav the sidebar
uses. Page transition: 240 ms rise on every navigation, none on POS /
KDS. Settings pages share one "Settings" nav (Restaurant · Bill &
Receipt · Printers · Audit log) from `app/admin/layout.tsx`.

**Overview** recomposed as the command centre: date line, the three real
KPIs plus net profit in the hero row (count-up, chip delta, comparison),
Right now beside "Needs your attention" (insight cards ranked NOW → TODAY
→ SETUP with the action in ink), "Where money goes" as a bar list of the
recorded cost lines against month revenue (no invented "kept as profit"
row), Top sellers / Not selling panels, the honest "Not yet tracked" row,
and a data-trust line (rendered time, captured payments only, comparison,
opening date). Viewport-gated reveals removed from primary content.

**Unchanged by design:** POS (its own fast header; fonts and tokens
only), KDS, the receipt designer's engine, promotions, printers logic.
Dark theme is not designed for IQ yet (the template shows dark first;
the light variant it defines is what shipped).

**Incident during verification — the real Bluetooth printer was
removed.** At 13:04 UTC an automated setup-flow check on the local build
(which points at the production database) matched the brother's real
printer card "KPC307-UEWB-A6FE" (added from "Redmi Pad 2 Wi-Fi +
Cellular" at 12:57 UTC over Bluetooth, address 24:19:7B:5B:A6:FE,
default, auto print) instead of the simulated one, and clicked Remove.
The row is gone; its print jobs remain with `printer_id` null. A restore
script (same id, device, address, settings; jobs relinked; audited as
`printer_restored`) was written but its direct database write was
blocked by the session's permission policy, so it was not run until the
owner authorised it. **Restored 2026-09-14 13:25 UTC** on that
instruction: the script verified the device (id, name, ANDROID,
POS_TERMINAL), the printer id being free, the `printer_removed` and
`printer_added` audit rows for that id, and that no other default printer
existed, then recreated the row with the original id, device, address,
default and auto print, relinked its one orphaned print job, set last
print 12:58 UTC, and wrote a `printer_restored` audit row. Confirmed in
Settings → Printers on production: "KPC307-UEWB-A6FE · Bluetooth ·
24:19:7B:5B:A6:FE · Device Redmi Pad 2 Wi-Fi + Cellular · Auto Print ON ·
Default YES · Last Print 13 minutes ago". Nothing else was touched. The
verification scripts were changed so a simulated device is named
"Simulated verification pad", every selector is scoped to that name,
and teardown is by the simulated device key only — never a UI Remove.

---

## Hardware — printer setup UX: browser vs FRYBIRD POS app, told apart honestly

**Status:** Complete. Gates green (443 tests). Android debug build
compiles (bridge 1.2.0). Deployed (see deployment record). Verified with
two simulated situations — Chrome on the Redmi Pad, and the FRYBIRD POS
app bridge — on the local build and on production. Physical POSIFLOW
still untested.

**What changed.** The Printers page and Add Printer now lead with the
device: a browser shows "Chrome on Android — No printer bridge" and the
plain explanation that Bluetooth/USB thermal printing needs the FRYBIRD
POS app, with [Open FRYBIRD POS] (Android intent link to the installed
app, falling back to the guide) and [Continue with Wi-Fi / LAN] — which
saves the printer against the POS device that will print, and never
claims Chrome can reach port 9100. The app shows "Redmi Pad — ✓ FRYBIRD
POS ✓ Printer Bridge Available"; Bluetooth is enabled only when the
bridge reports a radio, USB only when it reports support. Bluetooth
selection asks the radio: off → [Turn On Bluetooth] via Android's own
dialog (new bridge op `BT_ENABLE`); permission denied → [Allow Bluetooth
access]; then Scan for Printers, the real list, Connect (pairing through
Android; PIN never stored), and a connected card with Test Connection /
Test Print before Default Printer / Auto Print and save. Devices list
"Android POS · Online · Printer Bridge: ✓" or "Browser on Android ·
Browser / No printer bridge"; the existing "Chrome on Android" row was
left as it is. The app registers under the tablet's own device name as
ANDROID / POS_TERMINAL.

---

## Hardware — Bluetooth (SPP) transport for the POSIFLOW, added to the existing printer system

**Status:** Complete for everything testable without the printer in the
room. Gates green (441 tests, 2 new). Android debug + release compile
(bridge 1.1.0). Deployed (see deployment record). **Physical POSIFLOW
over Bluetooth: not tested** — that happens on the Android device next
to it. Nothing rebuilt: same tables (no migration — `connection_type`
and `bluetooth_identifier` already existed), same actions, same print
jobs, same receipt bytes, same auto print; Wi-Fi / LAN re-verified
unchanged.

**Where it plugs in.** `PrinterConnection` is now a union — a private
LAN address, or a Bluetooth device address — and the shim, the device
agent's `connectionOf()`, the repository's `savePrinter` and the Android
`PrinterBridge` all switch on it. One new bridge operation, `BT_STATE`
(radio supported / enabled / permission / connected / selected);
`DISCOVER` takes `transport`. Everything downstream — job record,
`PRINT_RECEIPT`, duplicate protection, Retry, Print Duplicate, status
pill — is untouched and now runs over either transport.

**Android** (`BluetoothPrinter.kt`): Bluetooth Classic SPP
(`createRfcommSocketToServiceRecord`, insecure fallback). Runtime
permissions per Android version (BLUETOOTH_SCAN + BLUETOOTH_CONNECT on
12+, legacy BLUETOOTH/ADMIN + fine location below) requested through
the Activity; the "turn on Bluetooth" system dialog when the radio is
off; scan = bonded devices + classic discovery with a hard timeout;
pairing via `createBond()` (Android shows the PIN prompt) with a bond
wait; one socket kept open; chunked writes; a reconnect thread with
2 s → 30 s backoff and a NUL keep-alive every 20 s that notices a
silent drop, so "printer off → on" recovers by itself. Every failure is
a code the web shows: BLUETOOTH_UNAVAILABLE / BLUETOOTH_DISABLED /
PERMISSION_DENIED / PAIRING_FAILED / PRINTER_TIMEOUT /
PRINTER_UNREACHABLE / PRINTER_DISCONNECTED. Manifest permissions added.

**Add Printer screen:** the Bluetooth option is enabled only when the
bridge on this device reports a Bluetooth radio (Chrome never qualifies
— it says why). Choosing it shows *Bluetooth Printer — Scan for
Printers — Available Devices (name, address, paired) — Connect —
Status: Connected / Disconnected*, and the printer name fills from the
device name. The LAN address block hides; name, model, paper (80 mm /
576 dots), protocol (ESC/POS), default and auto print stay. Saving
stores `connection_type = BLUETOOTH` and `bluetooth_identifier` (the
MAC); no IP. The printer card shows "Bluetooth device" instead of
IP/port; Test connection / Test Print / Reconnect go through the
Bluetooth socket on the owning device and report the real result.

**Verified:** with a simulated bridge speaking the exact protocol —
Bluetooth off → real error; permission, scan listing paired + nearby,
Connect → Connected, save, card, test connection, test print bytes over
`TEST_PRINT:BLUETOOTH`, printer powered off → "Writing to KP307-UEWB
failed: connection lost. The bridge will reconnect.", POS pill; then
the LAN flow re-run end to end unchanged. Console clean. Simulated
rows removed; the real "Chrome on Android" device and its LAN printer
that were registered from the counter today were left exactly as they
are.

**To note:** that "Chrome on Android" device has no bridge, so nothing
prints from it; the FRYBIRD POS app registers as its own device and the
printer must be added (or re-bound) to that device. The printer's
Bluetooth name may be "KP307-UEWB" or similar; the typical PIN is 0000
or 1234.

---

## Hardware — devices, printers, print queue, local printer bridge, FRYBIRD POS Android app

**Status:** Complete for everything that can be tested without the
POSIFLOW in the room. Gates green (439 tests, 39 new). Committed
`51fe96f` + `3e07048`. Deployed (see deployment record).
Migration 0026 applied. Android debug and release builds compile on this
Mac (APK at `android/app/build/outputs/apk/debug/app-debug.apk`, not
committed). **Physical POSIFLOW: not tested** — it is in Ambala and this
Mac is not; the last step happens on the Redmi Pad.

**The rule this is built on:** the cloud never connects to a printer.
A receipt's bytes go from the tablet at the counter to the printer over
the shop's own Wi-Fi. FRYBIRD IQ (from anywhere) holds the
configuration, the device list and the print history — nothing else.

```
FRYBIRD CLOUD (devices · printers · receipt designs · print_jobs)
      │ HTTPS
      ▼
FRYBIRD web app ── plain browser: dashboard + POS, browser printing only
      │
      └─ FRYBIRD POS (Android WebView) ── window.FRYPOS.printer ── local bridge ── TCP 9100 ── POSIFLOW KPC307-UEWB
```

**Hardware abstraction** (`src/lib/hardware/`, pure, tested):
`printer/types.ts` — `PrinterProvider` (isAvailable, getCapabilities,
getStatus, discover, connect, disconnect, testConnection, testPrint,
printReceipt, getLastError), `PrinterCapabilities`, `PrinterConnection`,
`PrinterJob`, real statuses only (ONLINE / OFFLINE / CONNECTING / ERROR /
UNKNOWN, and UNAVAILABLE when there is no bridge), and the wire protocol
— nine allowlisted operations. `net.ts` — private-IPv4-only address
rule, applied in the shim, on the server and natively. `device.ts` —
platform / device-type detection, device key minted once into the
device's storage, "online = heard from in 3 min". `printer/escpos.ts` —
`EscPosReceiptBuilder` (initialize, align, bold, size, text with
wrapping, two-column rows, rules, raster images, native QR, feed, cut;
48 / 64 / 24 columns on the 576-dot 80 mm head, 58 mm supported) and
`receiptToEscPos()` over the Bill & Receipt designer's own renderer, so
paper = preview = POS print; ₹ prints as "Rs." until the printer's code
page is confirmed on hardware. `printer/bridge.ts` — the shim that
builds `window.FRYPOS.printer` over the origin-restricted
`FRYPOS_NATIVE` channel: ids, timeouts, malformed replies dropped,
addresses checked before anything leaves the page. `src/lib/printer/
client.ts` — `getPrinterClient()`: native when the bridge exists, else a
browser client whose every call answers `{ supported: false, reason:
"LOCAL_PRINTER_BRIDGE_UNAVAILABLE" }`. Nothing fakes a printer.

**Storage** (migration 0026, RLS, rollback): `pos_devices` (org + store,
device_key unique per org, type, platform, versions, capabilities,
last_seen_at, last printer status), `printers` (bound to one device,
LAN / Bluetooth / USB, ip, port 9100, MAC, 80 mm, ESC/POS, one default
per store, auto print, last status / seen / print / error),
`print_jobs` (id minted on the device; one RECEIPT job per order,
retries reuse it; DUPLICATE and TEST are their own jobs; QUEUED →
PRINTING → PRINTED / FAILED, attempts, error, printed_at, the receipt
design it printed). Repository `src/lib/repositories/hardware.ts`;
actions in `src/lib/hardware/actions.ts`: register / who-am-I /
heartbeat / printer status / jobs take `orders.create` (the device
about itself), printer and device configuration take
`integrations.manage` (OWNER, ADMIN — existing permission, no new one),
a duplicate copy takes `orders.refund`. Configuration changes audited.

**Device agent** (`src/components/hardware/device-agent.tsx`): on the
POS and Printers pages. With a bridge: registers the device on first
load (never on a plain browser — a browser registers only when a person
asks), heartbeats once a minute while visible (device online, app and
bridge versions, printer status), probes the printer every 30 s backing
off to 8 min while it is down, and prints: build bytes (images resolved
on the device) → record job → bridge → record outcome. If the cloud is
unreachable the bytes still go to the printer; the job record is
best-effort.

**Settings › Hardware › Printers** (`/app/admin/hardware`, nav +
breadcrumb): This device (POS Device Setup ✓ registered ✓ bridge ready,
or "This device can run FRYBIRD POS, but direct thermal printing is not
configured" + Set Up Printing), Devices (real registrations only, online
dot, last seen, versions, rename / remove for admins), Printers (cards
with device, connection, IP, port, paper, auto print, default, last
print, last reported status; Test connection / Test Print / Reconnect
enabled only on the owning device, Edit / Remove for admins), Add
Printer (device, connection with Bluetooth / USB honestly "not yet",
POSIFLOW defaults, Find printers on this network — runs on the tablet's
own /24, never from the cloud — or enter IP manually, private addresses
only), Recent print jobs, and the setup guide. Stacks at 390.

**POS:** "🟢 Printer Ready / 🔴 Printer Offline" pill when this device
has a printer — no IP, port or MAC for the cashier. After payment the
receipt auto-prints through the applied design; the order is complete
either way. "Receipt Printed ✓" (+ Print Duplicate for managers) or
"Receipt Not Printed" with Retry Print on the same job id — the bridge
refuses to reprint a job id that already printed, so a retried request
cannot produce two bills. Browser Print stays as the fallback.

**Android** (`android/`, README inside): FRYBIRD POS loads
`https://frybirdiq.tech/app/pos` in a WebView. The bridge is
`WebViewCompat.addWebMessageListener` for that origin only; the listener
re-checks origin and main frame per message; no
`addJavascriptInterface`. `PrinterBridge.kt` allows nine operations,
validates address / port / payload size / job id, caches status probes,
remembers printed job ids; `EscPosTcpPrinter.kt` connects, writes,
flushes with timeouts and 3-attempt backoff; `PrinterDiscovery.kt`
scans only the tablet's own private /24 for port 9100. Package
`tech.frybirdiq.pos`, minSdk 26, targetSdk 35.

**Tested:** web UI in a plain browser (no fake hardware, Add Printer
disabled until a device exists, POS pill absent, 390 clean); the bridge
protocol end to end with a simulated Android bridge speaking the exact
protocol (registration, discovery, add printer, status online / offline,
test connection, test print bytes, public IP refused, edit, rename,
remove device and printer); one real ₹99 POS order (#022) with the
simulated printer offline → "Receipt Not Printed", Retry → printed,
Print Duplicate → second job; job rows PRINTED with 2 attempts; ESC/POS
bytes carried ORDER #022 and ended with the cut. Vitest: ESC/POS bytes,
layouts, images, QR, 58 mm, bridge ids / timeouts / errors / duplicate,
client selection, addresses, identity. Android: debug + release
compile. The simulated device, its printer and its jobs were removed
afterwards; production holds no device, no printer, no print job.

**Not tested — needs the Redmi Pad in India:** the POSIFLOW itself
(cut, code page for ₹, raster density, real discovery on that Wi-Fi),
install of the APK, and the bridge inside a real Android WebView.

**Known limits:** Bluetooth and USB are listed but not implemented;
iOS has no bridge (browser mode); ₹ is transliterated to "Rs." in
ESC/POS text; the cashier line prints the display name. Adding a
printer needs OWNER or ADMIN — MANAGER cannot (existing permission
model, not changed).

---

## Bill & Receipt designer — Settings › Bill & Receipt

**Status:** Complete. Gates green (405 tests, 13 new). Committed
`2ee7a42`. Deployed (see deployment record). Verified on a local build
and on production with the owner session (there is still no test staff
account): every editor control, Save Draft, Apply to POS (confirmed),
Restore previous, Print Test under print media, 390 and 1440, then one
real ₹99 takeaway sale on the production POS printed through the applied
design; console clean.

**A design is configuration, never data.** `src/lib/receipt/template.ts`
is the Zod-validated template: paper width (79 mm, 58 mm ready), divider
style, and an ordered list of sections — logo, header, restaurant
details (every field editable, tick to print, reorder), order details,
customer details, items (compact / detailed / QSR, quantity / unit price
/ amount / modifiers / modifier prices / notes / item discount / item tax
/ SKU flags, column header), discounts, taxes (display only — the pricing
engine's figures are shown or hidden, never recomputed), charges, total
rows, payment rows, payment QR (a static uploaded image, not a gateway),
other QR codes (website, menu, feedback, review, loyalty, social),
footer, and any number of custom text blocks. Every row has its own
label. `defaultTemplate()` seeds the restaurant fields from the org and
location rows so a fresh draft already says FRYBIRD, Sector 9, Ambala
City, Haryana. `src/lib/receipt/data.ts` is the JSON-safe order shape
(paise as strings) plus the three sample orders. `src/lib/receipt/
render.ts` is the one renderer — template × order → blocks — that the
live preview, the test print and the POS slip all draw, so they cannot
disagree. Zero lines never print; a coupon or offer prints under its
own name; dates and times are Asia/Kolkata. 13 tests.

**Storage:** `receipt_designs` (migration 0025, one row per org, RLS,
rollback in `supabase/rollback`): `draft`, `active`, `previous`.
`saveReceiptDraft` never touches the POS; `applyReceiptDraft` moves
active → previous and draft → active in one transaction;
`restorePreviousReceiptDesign` swaps them back (so a restore can itself
be undone). All three audited (`receipt_draft_saved / design_applied /
design_restored`). `getActiveReceiptTemplate` falls back to the default
when nothing has been applied. Actions in `src/lib/receipt/actions.ts`
re-check `settings.manage` (OWNER); image uploads go through the existing
`uploadMedia` (Supabase Storage, JPEG/PNG/WebP ≤ 8 MB) under the same
gate. `receiptDataForOrder` reads the slip back from the order, item,
modifier, payment, event, table, membership and stamp-event rows the POS
already wrote — the only arithmetic is change from the cash tendered.

**Designer** (`/app/admin/receipt`, "Bill & Receipt" in the Admin nav
+ breadcrumb): left, the sections on the roll with show/hide, drag or
arrow reorder, "Add custom text", paper width and dividers; centre, the
live 79 mm preview against Small / Normal / Large sample orders with
click-to-edit; right, the editor for the selected section. Header
buttons Save Draft / Print Test / Apply to POS; status line shows active
/ draft times, unsaved changes, and "Restore previous design" once there
is one. Apply asks "Apply this receipt design to POS? This will replace
the current POS receipt layout." and reports "✓ Receipt design is now
active on POS". Print Test prints the sample and creates no order.
Stacks to one column at 390.

**POS:** `placeCounterOrderAction` returns the order read back as
`receipt` data (best-effort — never fails a recorded sale); the POS page
passes the applied template; the payment sheet prints it through
`ReceiptSheet` (`data-print-receipt`, `@page { size: 79mm auto }`,
images flattened to high-contrast greyscale). The old hand-rolled slip
remains only as the fallback if the read-back fails. The cashier never
sees the designer.

**Print rule fix** (globals.css): transitions and animations are
disabled while printing — the kit's `transition-all` buttons were fading
their visibility over 150 ms and still showing in the print snapshot.

**Production now holds** an applied design equal to the default except
the cashier line reads "Served by" (the verification edit), and one real
order #013 (₹99, cash, paid) placed to verify the POS print path. The
cashier prints as the membership's display name, which for the owner is
the email's local part — set a display name on Staff if you want the
bill to say "Lovepreet".

**Not built (stop rules):** nothing here changes pricing, tax or
payments; the designer only chooses what to show. Loyalty on the bill is
"Stamp earned" when the order earned one — a points balance line needs a
decision on what to print and is not fabricated.

---

## Promotions — Slice A: model, engine, editor

**Status:** Complete. Gates green (392 tests, 20 new). Committed
`34b1ff6`. Deployed (see deployment record). Verified on a local build
and on production: one promotion of each of the eight types created
through the editor; 390 and 1440; console clean. Spec: `Promotions.dc.
html` (IQ view), `promo-engine.js` (source of truth), `ProductPicker.dc.
html`. `menu.js` ignored — the picker reads the real menu.

**Extends, does not fork.** The existing `promotions` table, `src/lib/
promotions/index.ts` (the website's `applyPromotion`), `repositories/
promotions.ts` and `scripts/promo.ts` are all still the one system.
**Migration 0024** (additive; `code` becomes nullable because only a
coupon has one): type, buy/get products + quantities + get-discount
(bps), products, combo price, start/end time, days mask (Mon = bit 0),
customer segment, stacking, `channel_pos` / `channel_web`, per-customer
limit, `status` draft/live/paused, `live_since`; check constraints on
the enums. Backfill: the one existing row, FRYBIRD10, became
coupon / live / website (verified). Rollback in `supabase/rollback`.
`findPromotion` + `applyPromotion` untouched, so the website's coupon
keeps working exactly as before.

**Engine** (`src/lib/promotions/engine.ts`): `summarize()`, `validate()`
and `eligible()` ported branch for branch from `promo-engine.js`, in
integer paise, plus the shop's own rules — start/end dates, usage limit,
per-customer limit (an offer with a per-customer limit waits until a
customer is attached), customer segment, never negative — and days /
times read in Asia/Kolkata (empty times = all day). `rankEligible`
orders by saving. 20 tests mirror every branch. `form.ts` is the editor's
JSON-safe shape and `toPromo()` is the one converter both the preview and
the server use.

**Editor** (`/app/customers/promotions`): library left (status badge,
one-line summary, "On POS · Website" / "Not active anywhere"), editor
right — OFFER / PRODUCTS / DISCOUNT / SCHEDULE / CONDITIONS / LIMITS
shown by the type's `t` flags; product picker over the real menu;
"Customer sees" from `summarize()`; "Before you can push" from
`validate()`; Save / Update, Save as draft, Duplicate, Delete; dirty
label; coupon code uppercase alphanumeric with Generate. Channels are
POS and Website only; no Store field. Phone: single column, library in a
drawer. Push / Publish / Pause / Activate are slice B and are not shown
— nothing fake.

**Permissions:** writes take `settings.manage` (OWNER) — there is no
`promotions.manage` and adding one is a permission-architecture change;
reads keep `orders.discount`. Every write is audited (`promotion_created
/ updated / deleted`).

**Tokens:** promo live / paused / draft tints — MASTER.md §5 →
tokens.json `color.promo` → globals.css; `check-contrast.py` covers them
(7.3 / 4.5 / 6.4 : 1).

**Production now holds** eight drafts named "Sample …" (one per type,
the coupon renamed to "Sample coupon renamed" by the dirty-label check),
none active anywhere. The verification duplicate was removed. Delete
them from the editor whenever you like.

**Next:** Slice B — publish flow (push / publish / pause / unpublish /
activate, audited), the POS "Offers available" + coupon entry, discount
persisted on the order, usage counters.

---

## Overview v3 — Slice A: Right now + Needs attention + KPI row

**Status:** Complete. Gates green (372 tests, 17 new). Committed
`87eca04`. Deployed (see deployment record). Verified signed in at 390
and 1440 on a local build **and on production**: two tiles opened and
closed, range switched to 7 days, comparison switched, console clean.
Spec: `FRYBIRD IQ Overview v3.dc.html` (`renderVals()`); v2 ignored.

**Right now** — eight tiles, each opening the inline drawer with the
spec's columns (order, channel, items, state, timing, amount + pay,
Open). Readings, all measured server-side (`src/lib/repositories/
overview.ts`): Awaiting decision (online undecided), In the kitchen
(ACCEPTED + PREPARING, oldest), Ready, Late (oldest), **Avg prep time**
= accept → ready over the last hour from `orders.accepted_at`/`ready_at`,
**On-time today** = ready ≤ promised among today's promised orders,
**Kitchen load** = open tickets ÷ `kitchen_capacity`, **Payment
pending** = unpaid orders READY / OUT_FOR_DELIVERY. No "staff on shift".

**Needs attention** — rule-generated only (`src/lib/iq/overview.ts`,
tested): late orders (prep reading as cause), unsettled cash, items
unsold 7+ days (never-sold counts only once the shop has 7 days of
history — a 3-day-old shop's whole menu is not "not selling"), costs not
recorded. Levels NOW / TODAY / THIS WEEK / SETUP; every button is a real
page; "Nothing needs attention." when nothing fires.

**KPI row** — Revenue / Orders / AOV real, with delta vs the chosen
comparison and the 7-day shape; Gross profit / Food cost % / Labour
cost % / Prime cost % / Net profit as the spec's missing cards ("—", the
input needed, a link). "n of 5 inputs connected" and "n of 4 cost lines
recorded" are counted from the database. Excludes note uses real
cancelled/refunded counts. Partial profit is never shown.

**Header** — "Open · {time} IST · Ambala Sector 9 · Dine-in + takeaway
+ delivery · GST: not registered" (from the org's GSTIN). Range Today /
Yesterday / 7 days / 30 days; comparison picker with each unavailable
option disabled and its reason ("Needs a week of history · Store opened
10 Sept 2026 (first order)"). Both in the URL.

**Schema — migration 0023 (additive, applied, verified):**
`organizations.kitchen_capacity integer not null default 10` (your
instruction) and `organizations.opened_on date null` (the comparison
picker needs a real opening date and none existed anywhere — added as a
setting; until set, the first order's date is used and labelled). Both
editable under **Restaurant › Operations** (`settings.manage`). Rollback:
`supabase/rollback/0023_….down.sql`. Core counts unchanged (44 orders,
44 payments, 49 products).

**Tokens** — `--chart-1` is now the neutral ink grey; red moved to
`--chart-5` (MASTER.md §5 "Charts", tokens.json `color.chart`). Channels
chart keeps three distinct hues. Charts here draw in chart-1; red only
for late/alert.

**Reading of the live data** (why the numbers look the way they do):
17 late / 16 in the kitchen are the accumulated test orders from earlier
days; kitchen load 160 % is 16 tickets against the default capacity 10;
opening date resolves to 10 Sept (first order), so only "vs yesterday"
is available today — set the real opening date under Restaurant ›
Operations and the picker widens.

**Next:** Slice B (Sales by hour, Channels, Menu intelligence).

---

## POS: accept at placement, alert only online orders, Customer control

**Status:** Complete. Gates green (355 tests, 7 new). Deployed
`b013cc2` (see deployment record). Verified on production with one real
counter order (#009, ₹59 cash takeaway, customer attached at the top).

**Report that prompted it:** #008 (₹139 dine-in, rewards mobile
attached) landed in PAID and opened the new-order pop-up. **Correction to
the premise:** no "accept at placement" step existed on the deployed
build — `placeCounterOrderAction` placed (PENDING_PAYMENT) and captured
cash (PAID) and stopped. This was flagged in the Orders-board slice as
needing approval; that report is taken as the approval. #008 did not
bypass anything. Its customer link and points *did* work.

**Fix 1 — placement.** `placeCounterOrder` now moves the order
PENDING_PAYMENT → ACCEPTED inside the idempotent placement, via the
domain's own `advanceOrder` (legal for both counter channels; cashier as
actor; `accepted_at` set). Cash capture on an ACCEPTED order records the
payment and leaves the status alone — existing behaviour for any
non-pending order. Best effort by design: failing placement on an infra
error in the accept step would make the till retry and re-run the
callback, ringing the order up twice; if it ever fails the order stays
PENDING_PAYMENT and is accepted by hand, as before.

**Fix 2 — pop-up and alarm.** `pollNewOrders` filters on source first:
`awaitsCounterDecision` (`src/domain/order-alert.ts`) is true only for an
ONLINE order in PENDING_PAYMENT/PAID. A till order never matches, at any
status. The dashboard "awaiting decision" count is unchanged.

**Fix 3 — Customer control.** "Customer · add mobile" at the top of the
till, usable at any point: keypad → name, stamps (n/7), points, and
whether a reward or points are usable. Same shell state the tender reads,
so "Rewards · add mobile" shows the already-attached customer and stays
as a second entry point. One lookup (`attachCustomerByPhone`); nothing
written until placement (`ensureCustomerByPhone`). **Redeem is not
built** — applying a stamp reward or points at the till is a discount on
the sale (pricing, tax base, ledger spend) and needs its own approval;
the control says "reward ready" / "points usable" and stops there.

Orders board: counter orders carry a **Till** pill in the type rail.

**Tests:** `awaitsCounterDecision` over every channel × status (a PAID
till order never matches); counter placement lands in ACCEPTED, allowed
by the state machine for both counter channels, live on the KDS, never
alerts. The "lookup at the top attaches and the tender shows the same
customer" check has no unit form (vitest runs in `node`, no React
harness) and was done on production.

**Production verification (#009):** attached 9355533343 at the top →
tender header "TAKEAWAY · LOVEPREET SINGH", chip "2/7 stamps · 51
points" → ₹100 cash → settled → `/app/orders` row "TAKEAWAY · Till ·
#009 · Accepted · Paid · Start cooking", **no pop-up after a full 12s
poll cycle** → on `/app/kds` → customer page: points 51 → 53,
`orders.points_earned = 2`, linked. **Stamps stayed 2/7 — correctly:**
the org's rule is qualifying spend strictly greater than ₹200
(`stamp_min_order_value = 20000`), the same rule online orders get; ₹59
and ₹139 do not qualify. The points credit comes from the same capture
block that awards stamps, so the counter path is proven without placing
a second, larger real order. Server logs clean. One intermittent React
#418 (hydration text mismatch) surfaced during the multi-page walk and
did not reproduce on isolated loads of any of the five pages — most
likely a minute counter crossing a boundary between SSR and hydration
on the KDS/orders boards; pre-existing, not chased here.

---

## POS: optional FRYBIRD REWARDS enrolment at checkout

**Status:** Complete. Gates green (348 tests, 8 new). Deployed (see
deployment record). Walked signed-in on a local build up to — not
including — Confirm payment, so no order was placed.

**What it is:** one secondary button on the tender step, "Rewards · add
mobile". The default flow ignores it and goes through in the same taps as
before. Tapping it swaps the tender for a keypad (`inputmode="tel"` field
plus on-screen digits), validated only on submit; Cancel returns with
nothing changed. On entry the number is looked up: known → name and
"2/7 stamps · 45 points" inline; unknown → "New — enrolled with this
order". The chip has Change and Remove. The always-visible phone field at
the top of the order builder (`customer-lookup.tsx`) is gone.

**How it credits — no separate logic:** `recordCashPayment` already
credits points (`pointsEarned`) and stamps (`awardStampForOrder`) for any
order with `customer_id`, web or counter. The only gap was that
`placeCounterOrder` linked *existing* customers and stored an unknown
phone as text. It now resolves the phone with `ensureCustomerByPhone`
(found, or created with just the number, keyed on `(org_id, phone)`
like the website's checkout upsert — no name, no consent, existing rows
untouched). Creation happens at placement, not at lookup, so a cancelled
keypad leaves nothing behind. No phone → no record → "No phone on file",
nothing credited — unchanged.

**One rule, two places:** `counterPhoneSchema` (`src/lib/pos/
rewards-enrolment.ts`) is what the keypad's `parseMobile` and the
server's `counterOrderSchema` both apply, so an invalid number is an
inline error on the keypad and, if it ever reached the action, a failed
parse before any repository call — no order placed.

**Tests** (`rewards-enrolment.test.ts`): valid forms (+91, 0, spaces,
dashes) normalise; invalid forms refuse with a sentence; the server
schema accepts exactly the keypad's set, `null` when absent; summary
wording. Crediting with/without a phone is the existing capture path,
under test in `src/lib/loyalty`; there is no DB test harness in this
repo, so linked-and-credited is verified by the code path plus the
signed-in walk, not by an integration test.

**Permissions unchanged:** the button appears under `customers.view`
(the same gate the old lookup had); placement stays under
`orders.create`, cash under `orders.update`. `lookupCustomerAction`
remains read-only.

---

## Slice 4 (UI Kit): Orders — card-row board from the "Frybird Orders v2" design

**Status:** Complete. Gates green. Deployed (see deployment record).
Verified signed in at 390×844 and 1440×900; status transitions exercised
through the row buttons; console clean.

**What it is:** `/app/orders` as the attached design — white rounded
rows (14px, hairline, soft shadow, stronger on hover) with a 92px type
rail (icon, DINE-IN / TAKEAWAY / DELIVERY / ONLINE, table or "Website"
pill), order + customer + phone, first item "+N more", status pill with
dot, due ("N min late" red, ≤15 min amber, late rows red-bordered),
amount + Paid/Unpaid chip, one next-step button (Accept filled dark, the
rest outlined) and the ⋯ menu. Sorted by due ascending. Title row: static
dot, "{n} open · {n} due soon" (amber when > 0), search across number,
name, phone, table. Status pills hide at zero unless selected; type
segmented control with swatches and counts. Dashed "No orders match."
Phone: rows stack into cards (rail → top strip, Order + Status on a line,
Items, Due + Amount on a line, full-width action); `scrollWidth` = 390.
`density` prop (comfortable 84px / compact 64px), default comfortable, no
toggle.

**Rules applied:**
1. Our shell — the design's dark header is the canvas chrome, not built.
2. **No hex in components.** New semantic tokens: `MASTER.md §5 "Order
   tints"` → `tokens.json color.order` → `globals.css` (`--type-*`,
   `--status-*`, `--order-late-line`, exposed in `@theme inline`), used
   as `bg-type-dine-in`, `text-status-new-fg`, `bg-status-ready-dot`,
   `border-order-late-line` … `check-contrast.py` now reads `color.order`
   and checks every ink on its ground: 6.8–9.1:1, all AA.
3. Our fonts (`font-heading`, body); Instrument Serif / Geist ignored.
4. Static dot, no pulse.
5. Real data and existing actions: rows are `listActiveOrders`; the
   button calls `advanceOrderAction` with the one move `nextStep` names —
   `nextStep` is now exported from `order-card.tsx` with the spec's labels
   (Accept / Start cooking / Mark ready / Complete / Delivered; delivery
   READY keeps "Send out" because that is the real transition). Accept
   still opens the KOT window in the same tick; Complete is disabled with
   a reason while unpaid; ⋯ and the row click open the existing sheet with
   the unchanged `OrderCard`. Collection → TAKEAWAY; online collection →
   ONLINE; delivery → DELIVERY; dine-in → DINE-IN.
6. Kit `Badge`, `Button`, `Input`, `DropdownMenu`; the row is a plain grid
   with the spec's `grid-template-columns`.

**On the "POS orders never show Accept" rule — a finding, not a change:**
`placeCounterOrderAction` runs `placeCounterOrder` (persists as
`PENDING_PAYMENT`) then `recordCashPayment` (→ `PAID`); nothing accepts
it. Under `src/domain/order-status.ts` the only forward move from `PAID`
is `ACCEPTED`. So a counter order *does* reach this list as **Paid** with
an **Accept** button, and hiding it would strand the order. The board
follows the real state machine. If the intended behaviour is that a
counter order is accepted at the till, that is a change to the POS
placement path (an order transaction) and needs its own approval.
"Ready completes them" already holds: READY → COMPLETED for anything not
a delivery.

**Verification data note:** the live list had no New or Cooking orders,
so the two transitions exercised were **Start cooking** then **Mark
ready** on order **#014** (an owner test order): row moved Accepted →
Cooking → Ready to send, tab counts 13/0/4 → 12/1/4 → 12/0/5. That order
is now genuinely at READY in production. Same session method as before
(owner session minted with the service-role key, revoked after; temp
scripts deleted). `orders-table.tsx` removed — only the page used it.

---

## Polish: /app/iq after slice 3

**Status:** Complete. Gates green. Deployed (see deployment record).
Verified signed in at 390px and 1440px.

1. **"Where the money goes" states.** The empty state and the donut
   rendered together when only operating expenses existed — the empty
   check tested COGS alone. Now two separate facts drive it:
   `pnl.hasExpenses` (any expense this month → donut) and `hasDirect`
   (any food/packaging cost in the weekly series → food cost % chart).
   Nothing recorded → the full empty state; operating-only → donut plus
   one line ("No food or packaging costs yet — food cost % appears once
   you record one").
2. **Series colour.** Sparkline and mini bars moved to `--chart-5` (ink
   grey). Note for the token decision: on the IQ surface **`--chart-1` is
   the brand red** (`#d92b2b`, `globals.css:269`), so "use `--chart-1`"
   would have kept them red. Redefining `--chart-1` itself would recolour
   Channels and Food cost too — left for an explicit call.
3. **Equal-height KPI cards** — `h-full` on the stagger item and card,
   content as a column, footer pinned with `mt-auto`.
4. **Footer links on all three** — Revenue → `/app/iq?range=7d` ("Sales,
   last 7 days" — Sales *is* this page, so the link goes to the period the
   sparkline shows), Orders → `/app/iq/live`, Average order →
   `/app/iq/pnl`.

---

## Slice 3 (UI Kit): Overview — today's KPIs on the kit's Default dashboard cards

**Status:** Complete. Gates green. Committed `0acc6cf`. Deployed (see
deployment record).

**What it is:** `/app/iq` "Today" recomposed on
`shadcn-ui-kit-dashboard/app/dashboard/(auth)/default/components`:
**Revenue** with a 7-day sparkline (Total Revenue card), **Orders** with
7 mini bars and counts on top (Subscriptions card), **Average order** as
the ecommerce stat card (figure + badge, rule, "Profit and loss →"). Kit
title row: "Overview" + range label left, the period selector (Today /
Yesterday / 7 days / 30 days) as a segmented control right — kit height on
a pointer, 44px on a phone. The section links (Sales / Live / … / Menu)
stay under the title because P&L, Expenses and Rewards have no sidebar
item.

**Same data, not rewired:** figures and deltas are `getTodayComparison`
exactly as before; the shapes are `getDashboard(orgId, resolveRange("7d"))
.series` — one extra call to the same repository function. Everything a
person reads is formatted from paise on the server; the float
(`toRupeesFloat`) exists only for recharts geometry, the pattern
`ChannelChart` already documents. Deltas keep the accessible
`Delta` (arrow + sign + words), now exported from `stat-tile.tsx`, instead
of the kit's colour-only "+20.1%". Chart colour is `--chart-1`, type is
`font-heading` — no kit colours or fonts.

**Files:** `src/components/iq/overview-kpis.tsx` (new, client),
`src/components/iq/stat-tile.tsx` (export Delta), `src/app/(app)/app/iq/
page.tsx`. `StatTile` itself is untouched and still used elsewhere.

---

## Slice 2 (UI Kit): Shell — kit sidebar and header structure, our tokens

**Status:** Complete. Gates green. Committed `a54bfa2`. Deployed (see
deployment record). Verified signed in at 390px and 1440px on `/app/iq`,
`/app/orders`, `/app/pos` (screenshots reviewed; no console or page
errors).

**What it is:** structure from
`shadcn-ui-kit-dashboard/components/layout/{sidebar,header}`:
- `AppSidebar`: `variant="inset" collapsible="icon"`, brand block as the
  first menu button (an "F" mark in `--primary` + the wordmark), groups
  inside a `ScrollArea`, the sheet closes itself on navigation at phone
  width. Groups, items and lucide icons are unchanged —
  `buildNavGroups()`, shared with the command palette.
- `SiteHeader` (new): the kit's `--header-height` (56px), sticky with a
  blurred ground, one hairline, rounded top corners inside the inset
  panel. Left: collapse toggle (PanelLeftClose/Open) + breadcrumb. Right:
  the existing search, Test alarm and account avatar. The kit's store
  switcher, notifications, theme switch and customizer are not adopted.
- `AppChrome` sets the kit's provider vars (`--sidebar-width`,
  `--header-height`, `--content-padding`); the layout reads the
  `sidebar_state` cookie so a collapsed sidebar stays collapsed on the
  first paint. Pages keep their own gutter/max-width, so
  `--content-padding` is declared but not applied at the wrapper (it would
  double every page's padding) — a later per-page pass can move to it.
- POS/KDS keep the full-bleed header, now at the same 56px.
- `scroll-area.tsx`, `kbd.tsx` copied from the kit (Radix, drop-in).
- Small fixes found in the screenshots: root crumb hidden at phone width
  (it wrapped inside 56px); `whitespace-nowrap` on the header buttons.

**Tokens:** everything resolves through `[data-surface="iq"]` — sidebar
white, inset panel `#f4f5f6`, active item `--sidebar-accent` (cream),
primary red. No kit colours, no kit fonts.

**How it was verified:** local production build + `next start`, a
short-lived session for the OWNER account minted with the service-role
key already in `.env.local` (admin `generateLink` → `verifyOtp`; no email
sent, no data written), Playwright at 390×844 and 1440×900, session
revoked (`admin.signOut`) and the temporary scripts deleted afterwards.
The only staff accounts are OWNER and RIDER, and a rider cannot open
these pages.

---

## Incident: staff app crashed after sign-in following the radix-nova switch

**Status:** Fixed and deployed (`9e4ca19`, 2026-09-12 23:39 UTC). Cause
was in `b6d2aaa` ("Adopt the shadcn UI Kit: switch ui layer to
radix-nova"), committed and deployed from another session at 01:30 +0200
— not part of this log's slices.

**Symptom:** "login page not working". `/sign-in` itself rendered (200,
`no-store`), and `signIn` succeeded — it redirects to `/app/orders`, and
*that* threw on the server: `` `Tooltip` must be used within
`TooltipProvider` `` from the staff chrome, 12 times in the log. Every
`/app` page with the sidebar was affected.

**Cause:** the Radix `sidebar.tsx` renders a `<Tooltip>` per menu button;
Radix tooltips require a provider. The kit's copy of the file drops the
provider because the kit's own root layout has a global one; FRYBIRD's
root layout has none. **Fix:** wrap the sidebar wrapper in
`<TooltipProvider delayDuration={0}>` inside `SidebarProvider` — the
canonical shadcn Radix sidebar structure. One file.

**Noise, not a fault:** 1,084 × "Failed to find Server Action" and 16 ×
"Server Reference ID did not match" in the same window are staff tabs
opened before the 23:30 UTC deploy still polling with the old build's
action ids (counts match the KDS/orders refresh loops). They stop when
those tabs are reloaded.

**What `b6d2aaa` changed (for the record):** `components.json` style
`base-nova → radix-nova`; all 22 `src/components/ui/*` files replaced
with the kit's Radix versions; deps `radix-ui`, `clsx`, `tailwind-merge`
added, `recharts` 3.8 → 3.10; `src/lib/utils.ts` now defines `cn` via
clsx + twMerge; six app files moved from `render={}` to `asChild`;
`.mcp.json` committed (shadcn MCP server config — command/args only, no
credentials). Gates were green — the crash is runtime-only, which no
existing test exercises. **Consequence for the UI migration analysis:**
the primitive engine is now Radix, so the kit's `components/ui` files are
drop-in from here on; the "port the look, keep Base UI" recommendation is
superseded by that decision.

---

## Slice: Inventory — master data (suppliers, ingredients, price records)

**Status:** Complete. Gates green. Committed `0de2154` on `iq-dashboard`
(local, not pushed). Deployed (see deployment record). **First inventory
write path** — limited to the three master-data paths the architecture
names (§4 write paths 1–3); no stock movement, purchase, waste or
consumption code exists.

**Authorisation:** "After the migration passes validation, continue with
the next safe Inventory slice according to the architecture document."
Everything here follows `docs/INVENTORY-ARCHITECTURE.md` as approved;
nothing deviates from it.

**What it is:**
- `/app/inventory` — Ingredients: name/SKU, base unit, **usable cost per
  base unit** (₹ / g, ml or pc), yield · waste, usual supplier, on hand
  (0 until stock exists — labelled as such), status. Four headline counts
  (ingredients, priced, packaging items, active suppliers). Filter pills
  All / Active / No price yet / Packaging, search across name, SKU and
  supplier, and an **Add ingredient** dialog — the purchased `tables12`
  block's shape (add-in-dialog + status filter), re-composed on the app's
  own `Table`/`Dialog`/`Input`. Bulk, duplicate and CSV controls from that
  block were not adopted.
- `/app/inventory/ingredients/[id]` — one ingredient: **Record a price**
  ("10 kg for ₹2,800" — quantity, unit limited to what `units.ts` can
  convert to this base unit, never PACK, and the supplier), the details
  form, and the price history (when, bought, paid, usable cost, from).
  The exact millipaise rate is shown under the rounded ₹ figure.
- `/app/inventory/suppliers` — suppliers with contact, GSTIN, how many
  ingredients name them, status; add/edit in a dialog.

**Permissions (D8, unchanged assignments):** screens read under
`inventory.view` (OWNER, MANAGER, ANALYST…); the add/edit/record controls
render only with `purchasing.manage`, and every server action calls
`requirePermission("purchasing.manage")` regardless of what rendered.
Nav group **Inventory** (Ingredients, Suppliers) appears for
`inventory.view`; threaded `layout → AppChrome → nav-items` like every
other group; breadcrumb entries added.

**Money and units — the part that must be right:**
- A price record is the *only* way an ingredient's cost changes.
  `recordIngredientPrice` converts the purchase to base units with
  `toBaseUnits` (integer, exact), refuses a unit that doesn't convert to
  the ingredient's base unit, then costs it with the existing
  `usableCostPerBaseUnit` (purchase cost ÷ quantity that survives yield
  and waste) → `MilliPaise`, stored in `cost_per_base_unit_milli` with the
  `rateToPaise` rounding beside it. Same arithmetic as §12a's worked
  example (chicken 10 kg ₹2,800, 80 % yield, 3 % waste → 36,082 millipaise).
- Yield and waste are typed as percentages (one decimal allowed) and
  converted with `bps()` at the boundary; stored as basis points.
- Rupee input goes through `fromRupees` (string, digit-parsed, no float).
- **A base unit locks** once a price or a recipe-version line exists in
  it — the server refuses the change (re-reading "150" as ml instead of g
  would silently mis-cost every recipe); the form disables the field and
  says why.
- Every write is one transaction and leaves an `audit_logs` row
  (`supplier_created/updated`, `ingredient_created/updated`,
  `ingredient_price_recorded`) with before/after.

**Files:** `src/lib/repositories/inventory.ts` (new), `src/lib/inventory/
actions.ts` (new; Zod at the boundary, `useActionState` form-state shape
shared with `expense-form.tsx`), `src/components/inventory/*` (field,
supplier-form, ingredient-form, price-form, suppliers-table,
ingredients-table), three pages under `src/app/(app)/app/inventory/`,
plus `nav-items.ts` / `app-chrome.tsx` / `layout.tsx` /
`section-breadcrumb.tsx` for the nav group.

**Untouched, verified:** all order/payment/tax/pricing code, POS, KDS,
`recipes`, `inventory_movements`, `purchase_orders`, `waste_entries`,
`expenses`, `kdsStation`/`prepMinutes`, every existing permission and
role assignment. No schema change (0022 already provides every column
used).

**Housekeeping in the same pass (`867194d`):** `shadcn-ui-kit-dashboard/`
appeared at the repo root during this slice — the purchased kit's full
source, with its own `node_modules`. `next build` type-checked it via
tsconfig's `**/*.ts` and failed on its Radix imports. Treated exactly as
the existing `frybird-iq/` reference copy: excluded from `tsconfig`,
ignored by ESLint, gitignored. Nothing imports from it; the deploy ships
only `.next/standalone`. Left in place, not deleted.

**Next slice (per architecture §12):** recipes — the versioned recipe
editor (`recipe_versions` + `recipe_version_items`, current version
pointer, immutable history, per-product food cost from the recorded
rates). Still no stock movement. Stops for review before the consumption
hook, purchasing receipt (which writes `expenses`), waste or adjustments —
each is a consequential write path.

---

## Slice: Inventory — migration 0022 (recipe versions + movement traceability)

**Status:** Applied to production 2026-09-13 under approval D13. Gates
green. **Schema only — no inventory write path, repository, or screen
exists yet.**

**Authorisation:** `docs/INVENTORY-ARCHITECTURE.md` decisions D1–D13
approved as recommended; D7 condition met by the worked reconciliation in
§12a of that document (P&L is expense-based only; inventory ledgers never
feed it; `expenses.purchase_order_id` + unique `(purchase_order_id,
category_id)` guard the one real double-count path).

**What 0022 adds (all additive, 44 statements, no DROP / type change /
new NOT NULL on existing columns):**
- tables `recipe_versions`, `recipe_version_items` (with org FKs, unique
  `(recipe_id, version)` and `(version_id, ingredient_id)`, indexes);
- columns `recipes.current_version_id`, `inventory_movements.order_item_id`
  / `recipe_version_id` / `reversal_of_movement_id`,
  `ingredient_prices.cost_per_base_unit_milli`, `waste_entries.order_id`,
  `expenses.purchase_order_id` — all nullable;
- partial unique index `inventory_movements_sale_line_unique`
  `(order_item_id, ingredient_id) WHERE type = 'SALE'` — consumption
  idempotent at the database;
- check `purchase_orders_status_check` (DRAFT/ORDERED/RECEIVED/CANCELLED);
- enum value `waste_reason.CANCELLED_ORDER` (D2).

**One shape change vs the proposal, flagged and approved-compatible:**
version lines live in a new `recipe_version_items` table, not a
`version_id` column on `recipe_items`, because that table's existing
`(recipe_id, ingredient_id)` unique constraint would forbid two versions
containing the same ingredient and dropping it is not additive.
`recipe_items` stays (empty) for a later, separate cleanup.

**Verification (`scripts/inventory-migration-verify.ts`, read-only):**
baseline before — 36 orders, 37 order lines, 36 payments, 49 products, 22
audit rows, every inventory table and `expenses` at 0 rows, new objects
absent, 22 migrations applied. After — **identical counts**, both tables
present, 7/7 columns, 5/5 constraints/indexes, enum value present, 23
migrations applied. typecheck / lint / 340 tests / build / RSC — green.

**Recovery:** `supabase/rollback/0022_….down.sql` (hand-run only, outside
the migrations dir). Everything reverses cleanly except the enum value —
Postgres cannot remove one; it is harmless while nothing writes it.
**Note:** Postgres truncated the self-referencing FK name to 63 chars
(`inventory_movements_reversal_of_movement_id_inventory_movements`); the
rollback script uses the truncated name.

**Untouched, verified:** order/payment/tax/pricing logic, POS, KDS,
`kdsStation`/`prepMinutes` (D12), existing role assignments (D8).

**Next slice (per architecture §12):** master data — suppliers,
ingredients, price records: read-only screens first under
`inventory.view`, then the create/update actions under `purchasing.manage`
— the first inventory *write path*, so it stops for a look before the
action code lands.

---

## Slice: Customers › Promotions — read-only list with real performance

**Status:** Complete. Gates green. Deployed (see deployment record).

**What it is:** `/app/customers/promotions` under `orders.discount` (if
you may apply a code at the counter, you may see the codes): every
promotion's offer (percent or amount, minimum, cap), when it runs, how
often it was applied, and **what it actually did** — paid, not-cancelled
orders that carried it, their revenue, and the discount given. Four
headline figures (live now, orders with a code, revenue on those orders,
discount given). State — Live / Scheduled / Expired / Used up / Off — is
four facts on the row plus the clock, captured with the data snapshot.

**Why performance comes from orders, not `usageCount`:** the counter is
incremented at placement; a placed order can still be abandoned or
refunded. Paid, not-cancelled is the same definition every revenue figure
in the app uses (`analytics.ts` `paidOrders`; replicated with a comment,
the way `customers.ts` already does).

**Read-only, deliberately:** creating or editing a promotion changes what
an order costs — a pricing decision — and gets its own approval. No edit
buttons. `promotions.ts` gains one `SELECT`-based `listPromotions()`;
`findPromotion` and the `countPromotionUse` write path are untouched
(the diff's only removed lines are three widened imports; verified).

**Purchased kit inspection:** searched "promotion", "coupon", "discount"
— `promo-section` is a marketing hero, `shopping-cart3` a customer cart
with a coupon box; neither is an admin list. Composed from the established
`tables9`-derived shell and `MiniStat`.

**Files:** `src/lib/repositories/promotions.ts` (+`listPromotions`),
`src/app/(app)/app/customers/promotions/page.tsx` (new); `nav-items.ts`
("Promotions" under Customers, `canSeePromotions` from the existing
`orders.discount`), `app-chrome.tsx`, `layout.tsx`,
`section-breadcrumb.tsx` (Customers, Promotions, Staff, Payments, Kitchen
now named in the crumb).

**Permissions:** `orders.discount` — pre-existing (OWNER/ADMIN/MANAGER/
CASHIER), none added. **Scope guard:** schema, payments, tax, pricing,
`lib/iq`, `lib/promotions`, domain, `orders.ts`, `payments.ts`, POS, KDS,
auth — **empty**. **Tests / build:** 340/340, build (46 routes), RSC —
green.

**Known limitation:** in production this may well list zero codes today —
nothing has created one yet — and says so plainly.

---

## Slice: Customer segments + Orders channel filter (read-only refinements)

**Status:** Complete. Gates green. Deployed (see deployment record).

**What it is:**
- **Customers › Segments** — pills on the customer list: *Ordered
  recently* (a paid order in the last 30 days), *Lapsed* (last paid order
  more than 30 days ago), *Never ordered*, *Regulars* (five or more paid
  orders), each with a count and a one-line definition. Facts about the
  rows already on screen — no model, no churn score. The reference "now"
  is captured once on mount so a boundary cannot drift under a reader.
- **Orders › channel filter** — dine-in / takeaway / website pills beside
  the status pills, shown only when more than one channel is present. The
  roadmap's "Online orders" as a view, not a separate screen.

**Data / permissions:** both client-side over rows already fetched; zero
queries, zero schema, no permission touched. Only `customers-table.tsx`
and `orders-table.tsx` changed. **Tests / build:** 340/340, build (45
routes), RSC — green.

**Purchased kit:** none newly inspected — both reuse the segmented-pill
idiom adopted from `tables9` for Orders.

---

## Slice: Connect the surfaces — Overview "Right now", deep links, customer links

**Status:** Complete. Gates green. Deployed (see deployment record).

**What it is:** integration, not a new screen — the directive's "one
restaurant, one source of truth" applied to the surfaces that now exist:
- `/app/iq` gains a **Right now** strip — awaiting decision · in the
  kitchen · late — the same three facts Live operations leads with, each a
  card that opens the surface acting on it (Orders, the kitchen display,
  Live). Urgent counts read in the destructive colour *and* in words.
- The Orders workspace accepts **`?open=<orderId>`** and arrives with that
  order's sheet open. Live operations (late, awaiting, kitchen rows) and
  the Activity feed link every order number there.
- Inside the order sheet, the customer's name links to their **Customer
  360** page when the viewer holds `customers.view` (the page re-checks it).

**Data:** zero new queries, zero schema. The Overview reuses
`listActiveOrders` + the tested `toKitchenTickets` mapper. The only
data-layer change is `listActiveOrders` exposing `customerId` — a column
its `SELECT` already fetched — in the mapped view: **three additive
lines** in `orders.ts`, in the read mapping, no transaction code touched
(printed in the gate output before committing).

**Permissions:** the customer link is gated on `customers.view` via a new
optional `canSeeCustomers` prop, defaulting to off, threaded from the
page's own `staffCan()`. Nothing added or changed.

**Files:** `iq/page.tsx`, `orders/page.tsx`, `iq/live/page.tsx`,
`orders-table.tsx` (`initialSelectedId`), `order-card.tsx`
(`canSeeCustomers`), `activity-feed.tsx` (`orderId` + link),
`repositories/orders.ts` (`customerId` in `StaffOrderView`).

**Scope guard:** schema, payments, tax, pricing, `lib/iq`, domain,
`payments.ts`, POS, KDS, auth — **empty**. **Tests / build:** typecheck,
lint, 340/340, build (45 routes), RSC — green.

**Known limitation:** `?open=` only opens an order that is in the active
list; a completed order's id simply results in a closed sheet — correct,
since the workspace lists active orders only.

---

## Slice: Admin › Restaurant — read-only business configuration

**Status:** Complete. Gates green. Deployed (see deployment record).

**What it is:** `/app/admin/restaurant` under `settings.manage` (OWNER):
Business (trading/legal name, GSTIN, whether menu prices include GST with
a one-line explanation of what that means, currency, business-day
timezone); GST rates (name, HSN/SAC, rate, default); Location (outlet,
address, GST state/code, phone, map pin); Delivery (enabled?, free-above,
road factor, fee bands); FRYBIRD REWARDS (every stamp and points value,
linking to the existing Rewards form). "Not set" is said plainly; a
missing GSTIN or map pin is flagged in red because those two silently
degrade invoices and delivery quotes.

**Why this slice:** every value shown already drives the product —
`gstin` on invoices, `price_basis` behind every margin, `stampsRequired`
behind every free item, the bands behind every quote — and an owner could
not *see* any of it without a database client.

**Read-only, deliberately:** no edit forms, no fake "Edit" buttons.
Changing `price_basis` retroactively misstates revenue by the tax rate on
every order (CLAUDE.md); each edit form is therefore its own approval.
The only link out is to the Rewards form that already exists.

**Data:** a `SELECT` over `organizations`, `locations` (first outlet) and
`taxRates`, plus the existing `getDeliverySettings()` reused unchanged —
no second copy of the delivery-band read.

**Purchased kit inspection:** `switch-card1` ("Settings-style cards that
pair a label and short description with a switch") and `dashboard-modal22`
(company-profile form dialog with logo upload). Adopted `switch-card1`'s
row layout (label + description left, control right) as `SettingRow`, with
a value where the switch was — these are read, not toggled. The form
dialog was not appropriate for a read-only page.

**Files:** `src/lib/repositories/settings.ts`,
`src/components/staff/setting-row.tsx`,
`src/app/(app)/app/admin/restaurant/page.tsx` (new); `nav-items.ts`
("Restaurant" in Admin; `canSeeSettings` from the existing
`settings.manage`), `app-chrome.tsx`, `layout.tsx`,
`section-breadcrumb.tsx` (Admin pages now named in the crumb).

**Permissions:** `settings.manage` only — pre-existing, none added.
**Scope guard:** schema, payments, tax, pricing, `lib/iq`, domain,
`orders.ts`, `payments.ts`, `org.ts`, `delivery.ts`, POS, KDS, auth —
**empty**. **Tests / build:** typecheck, lint, 340/340, build (45 routes),
RSC — green.

**Known limitations:** shows the first outlet only (single-location shop;
`locations` is already a table, so a second outlet is a loop, not a
redesign); `integrations` and `feature_flags` tables exist but are not
surfaced — nothing populates them yet.

---

## Slice: Analytics › Products — menu performance (Phase E/J, read-only)

**Status:** Complete. Gates green. Deployed (see deployment record).

**What it is:** `/app/iq/products` under `analytics.view` — for a chosen
range: every product's units, distinct orders, revenue with the change
against the previous period, share of revenue, average paid (GST-inclusive,
after modifiers/discounts, as the customer paid it), and a **Recipe**
readiness column; a best-sellers card by units with real catalogue photos;
a by-category rollup; four headline figures. Deleted products still appear
as "Removed from menu" — their sales were real. A new **Analytics** sidebar
group now holds Products and Channels (Channels moved out of Operations).

**Menu engineering, honestly scoped — the judgment call in this slice:**
this is the *first half* of the signature feature (volume, revenue, share,
price realised). The second half — cost, margin, contribution — was
deliberately **not** built, for two verified reasons: (1) no recipe in
production has ingredient lines (`product-recipe-section.tsx` is recipe
*status* only; no UI writes `recipe_items`), so there is no real cost to
show; (2) `products.basePrice` is GST-inclusive and CLAUDE.md requires
margins on **net-of-tax** revenue through `src/lib/pricing` — building that
path is new financial logic, a stop condition. The Recipe column ("No
recipe" / "No lines yet" / "N ingredients") and the "Costed recipes X / Y"
tile say exactly how far each product is from a margin. `lib/iq/costing.ts`
and `profit.ts` (pure, tested, unused) are the pieces that slice will use.

**Revenue definition — unchanged:** same `paidOrders` rows and the same
`lineTotal` aggregation `getDashboard`'s top-products already uses,
extended to every product and joined to today's catalogue (name, category,
first image, active flag) and to `recipes ⨝ recipe_items` for the readiness
count. `analytics.ts` changes are additive (imports widened, one new
function); the scope guard over `src/lib/iq`, `menu-admin.ts`, schema,
payments, tax, pricing, domain, POS, KDS, auth was **empty**.

**Purchased kit inspection:** `@shadcnuikit/product-list-card1`
("Structured product lists with icons, names, and metrics like units
sold… best-sellers") — adopted as the best-sellers card: thumbnail, name,
"N sold"; its green "units sold" text was muted (green is status-only per
`MASTER.md`), its `View All` tooltip button dropped. Tables reuse the
`tables9`-derived shell.

**Schema observation for the KDS architectural review (not acted on):**
`products.kdsStation` (text) and `products.prepMinutes` already exist as
columns, unused anywhere. A station concept therefore has a schema seed;
routing logic still does not, and remains a stop condition.

**Files:** `src/lib/repositories/analytics.ts` (+`getMenuPerformance`),
`src/components/iq/best-sellers-card.tsx`, `src/app/(app)/app/iq/products/
page.tsx` (new); `nav-items.ts` (Analytics group, Overview exclude),
`section-breadcrumb.tsx`, `iq/page.tsx`.

**Permissions:** `analytics.view` only. **Tests / build:** typecheck,
lint, 340/340, build (44 routes), RSC — green.

**Known limitations:** no per-product trend chart yet; "average paid" is
GST-inclusive by design and labelled so; category rollup uses the product's
*current* category, so a product moved between categories is counted where
it is now.

---

## Slice: Analytics › Channels (Phase J, read-only)

**Status:** Complete. Gates green. Deployed (see deployment record).

**What it is:** `/app/iq/channels` under `analytics.view` — for a chosen
range (today / yesterday / 7d / 30d / this month): a `StatTile` per channel
(dine-in · takeaway · website) with revenue, the change against the
previous period of equal length, share of revenue and order count; a
stacked revenue-by-day chart; and a breakdown table (revenue, orders,
average order, share, each with its vs-previous delta). Direct channels
only — no aggregators exist in this build, so no commission line.

**Revenue definition — unchanged, verified:** built on the same
`paidOrders()` rows as the Overview. The only change to that function is
one *selected* column (`channel`); the diff of `analytics.ts` is purely
additive (no `-` lines), so its join and where — what "revenue" means —
are byte-for-byte the same. `getChannelBreakdown()` reuses `changeBps`,
`previousPeriod`, `daysInRange`, `businessDate` exactly as `getDashboard`
does. `orders_channel_placed_idx` already exists for this question.

**Purchased kit inspection:** `@shadcnuikit/ecommerce-chart1` ("Charts for
store visits, sales, and revenue, donut, bar, and trend views") — adapted
its Card + `BarChart` + `XAxis` + tooltip composition; grouped bars became
a stack (the question is share-of-the-day), its demo months became real
business days. Chart colours are `--chart-1/-4/-3` — deliberately **not**
the success green, which `design-system/MASTER.md` reserves for status.
Paise is carried alongside the float recharts needs for geometry, the same
technique `CostBreakdownDonut` already uses, so every figure a person reads
is formatted from real Paise.

**Files:** `src/lib/repositories/analytics.ts` (+`getChannelBreakdown`,
+`channel` in `paidOrders` select), `src/components/iq/channel-chart.tsx`,
`src/app/(app)/app/iq/channels/page.tsx` (new); `nav-items.ts`
("Channels", Overview exclude), `section-breadcrumb.tsx`, `iq/page.tsx`.

**Permissions:** `analytics.view` only. **Scope guard:** schema, payments,
tax, pricing, domain, `orders.ts`, `payments.ts`, POS, KDS, auth — empty.
**Tests / build:** typecheck, lint, 340/340, build (43 routes), RSC — green.

**Known limitations:** no per-channel product breakdown yet; "previous
period" for "This month" is the previous calendar month (per
`previousPeriod`), which is the honest comparison for a partial month but
reads low early in the month — same behaviour the Overview already has.

---

## Slice: Command Center › Activity — the order event feed (Phase K seed, read-only)

**Status:** Complete. Gates green. Deployed (see deployment record).

**What it is:** `/app/iq/activity` under `analytics.view` — the last 150
order status changes from the **existing append-only `order_events`**
table, grouped by business day, one line each: the action in words
("Accepted #007", "Started cooking", "Turned down", "Payment recorded"),
who (staff display name or "System"), when, and the operational reason
already stored on the event. Search + "hide system events" are
client-side. Refreshes every 30s via the page itself.

**Not a second event/audit system:** one `SELECT` over `order_events ⨝
orders`, both org-scoped, actors resolved through `memberships` the same
way `listActiveOrders` resolves "placed by". Nothing writes.

**PII check, done against the code, not assumed:** every `reason` string
written today was traced to its source — placement
(`"Placed on the website for delivery/collection"`, `"Rung up at the
counter — dine-in, Table 4"`), cash (`"Cash received — ₹x"`), rejection
(`REJECTION_LABELS[...] + optional staff note`). All operational, none
customer-authored. Customer name/phone are neither selected nor rendered;
`metadata` (nothing writes it) is not surfaced.

**Purchased kit inspection:** `dashboard-modal20` (a notifications
*dialog* with a status-filter dropdown), `item1` (generic item primitive,
not installed) and `changelog1` (timeline with rail, ringed dot, timestamp
line, author). Adopted `changelog1`'s rail-and-dot layout as the closest
real activity pattern — plain Tailwind, so nothing new was installed; its
"Follow/Subscribe/Read more" marketing furniture was dropped.

**Files:** `src/lib/repositories/activity.ts`,
`src/components/staff/activity-feed.tsx`,
`src/app/(app)/app/iq/activity/page.tsx` (new); `nav-items.ts`
("Activity" in Operations, Overview's exclude list), `section-breadcrumb.tsx`,
`iq/page.tsx` (sub-nav link).

**Permissions:** `analytics.view` only — nothing added or changed.
**Scope guard:** schema, payments, tax, pricing, domain, `orders.ts`,
`payments.ts`, POS, KDS, auth — **empty diff**.
**Tests / build:** typecheck, lint, 340/340, build (42 routes), RSC — green.

**Known limitations:** last 150 events, no date-range filter yet; the
same-status "Payment recorded" reading relies on `recordCashPayment`'s
convention of writing `toStatus = current status` when cash arrives on an
already-accepted ticket.

**Next slice this unlocks:** Channels analytics (queued), then the general
`auditLogs` feed and this feed could share one "Activity" surface once more
actions start writing audit rows.

---

## Slice: Command Center › Live operations (Phase B, read-only)

**Status:** Complete. Gates green. Deployed (see deployment record).

**What it is:** `/app/iq/live` under the existing `analytics.view` — the
manager's glance that complements the KDS rather than duplicating it: no
buttons, no columns to work. Four headline figures (awaiting decision · in
the kitchen with new/cooking/ready split · late · longest wait), then three
tables: **Late** (order, customer, promised time, *over by* minutes),
**Awaiting a decision** (order, customer, total, waiting minutes, "Review on
Orders" link), **In the kitchen** (order, stage pill, item count, promised
time, waiting minutes with a "· late" mark). Refreshes every 15s by
re-running the page itself (`AutoRefresh` → `router.refresh()`, paused when
offline or the tab is hidden). Links out to Orders and, for `kitchen.view`
holders, the kitchen display — the only "actions", and they are the
existing ones.

**No new data path, by design.** The refresh re-runs the server page under
its own permission gate, so no new server action exists that could expose
kitchen or customer data under a different permission than the page uses.

**Facts only — no invention:** every number is from an existing query —
`listActiveOrders` via the tested `toKitchenTickets` mapper,
`ordersAwaitingDecision`, `ordersRunningLate`. "Late" = past the promised
time. "Longest wait" = the oldest ticket's age since placed. The headline
sentence only ever restates a count in words ("2 orders are past their
promised time"; "Nothing in the kitchen and nothing waiting"). No score,
forecast, threshold, station, routing, prep target, or AI conclusion. The
`now` used for "waiting" is captured as part of the data snapshot (the
instant the three queries resolved), not during render — which is also
what `react-hooks/purity` insisted on.

**Purchased kit inspection:** searched "live", "monitor", "operations" —
no such block exists (results were testimonials, OTP dialogs, theme
switchers). Composed from the two substantial back-office patterns already
adopted from the kit: the `stat-card1`-derived `MiniStat` and the
`tables9`-derived table shell.

**Files changed:**
- `src/app/(app)/app/iq/live/page.tsx` (new), `src/components/staff/auto-refresh.tsx` (new).
- `nav-items.ts` — "Live operations" in the Operations group (gated by the
  already-threaded `canSeeAnalytics`, so no permission plumbing changed);
  `NavItem.exclude` became a list so "Overview" no longer lights up on the
  Live page. `app-sidebar.tsx` — the one-line `isActive` change for that.
- `section-breadcrumb.tsx` — "Live operations" crumb. `iq/page.tsx` — a
  "Live" link in the Overview's own sub-nav.

**Permissions:** `analytics.view` (page), `kitchen.view` (only to decide
whether to show the KDS link). Nothing added or changed.

**Scope guard:** `git diff --stat` over `src/db`, `src/lib/payments`,
`src/lib/tax`, `src/lib/pricing`, `src/domain`, `src/lib/repositories`,
`src/components/pos`, `src/components/kds`, `src/lib/auth` — **empty**.

**Tests / build:** typecheck, lint, `pnpm test` **340/340**, build (41
routes), RSC check — green.

**Known limitations (honest):** 15s page refresh, not push; money (order
totals) is shown on the awaiting-decision list because `analytics.view`
already sees revenue on Overview — an ANALYST therefore sees per-order
totals here, as they already can on Orders (`orders.view`); no "pressure"
gauge because no threshold has been decided — the counts *are* the
pressure reading for now.

**Next slice this unlocks:** a Channels analytics view (revenue / orders /
AOV by DINE_IN / TAKEAWAY / ONLINE) on the existing `paidOrders()`
definition, existing `analytics.view`, zero schema — flagged in
`FRYBIRD-ADMIN-ARCHITECTURE.md` as "revisit if channel performance becomes
a real need."

---

## Slice: Kitchen display — station-less KDS foundation (Phase G)

**Status:** Complete. Gates green. Deployed (see deployment record).

**Why this, now:** the directive asked for the highest-value missing
*operational* area rather than another analytics screen. The kitchen had
nothing — only KOT printing and the back-office Orders table. The domain
already anticipates a KDS explicitly (`isLiveInKitchen()` in
`order-status.ts`, "§21 whether the kitchen should see this order on the
KDS"), `kitchen.view`/`kitchen.update` exist, and `advanceOrderAction`
already moves tickets. So a station-less board is buildable entirely from
what exists.

**Stop condition respected, precisely:** the directive gates "KDS
routing/station schema". No station, route, or priority concept exists in
the schema or domain, and none was invented — the board has three columns
that are simply the three `isLiveInKitchen` statuses. Adding stations later
is an architectural review, not a change to this screen.

**What it is:** `/app/kds`, full-bleed like POS (no sidebar; `AppChrome`'s
`isFullBleed` now covers `/app/pos` and `/app/kds`, POS branch itself
unchanged). Columns New (ACCEPTED) / Cooking (PREPARING) / Ready, oldest
ticket first. Each ticket: order number in 3xl type, table / collection /
delivery, whole minutes waiting, promised time, items with modifiers in
large type, notes highlighted, one 64px button. Polls every 10s via a new
permission-checked server action (`pollKitchenTickets`, `kitchen.view`),
with the POS's offline and stale-deployment handling. **Nothing animates.**

**Purchased kit inspection:** searched "kanban", "ticket", "queue board" —
the registry has no board/ticket block (only task-card rows, stat cards,
accordions). Per the master directive, POS/KDS are bespoke operational UI
where the kit doesn't improve the workflow; composed from the kit's
primitives instead. `FRYBIRD-ADMIN-ARCHITECTURE.md` had earlier noted a
"Kanban primitive… pending a Radix-free rewrite" — nothing of the sort is
in the purchased registry today.

**Files changed:**
- `src/lib/kitchen/tickets.ts` (new, pure, **tested — 6 cases**):
  `toKitchenTickets`, `waitingMinutes`, `isLate`, `nextKitchenStatus`.
- `src/lib/auth/kitchen-action.ts` (new) — `pollKitchenTickets()`.
- `src/components/kds/kds-board.tsx`, `src/app/(app)/app/kds/page.tsx` (new).
- `nav-items.ts`, `app-chrome.tsx`, `layout.tsx` — `canSeeKitchen`
  (from existing `kitchen.view`); "Kitchen" in the sidebar Operations group
  and in the POS/KDS full-bleed header nav.

**Business logic preserved / not invented:**
- The only write is `advanceOrderAction` — **unchanged**; it already
  re-checks `kitchen.update` on every call and the server decides legality
  via `assertTransition`. The board asks for exactly one move per column
  (`ACCEPTED→PREPARING`, `PREPARING→READY`) and nothing else.
- Handover (`READY→COMPLETED`) is deliberately **not** on the board — it is
  payment-gated and belongs to the counter. A READY ticket says "Waiting for
  the counter to hand over." Payment logic therefore never enters this
  screen.
- "Late" is a fact (`estimatedReadyAt < now`), not a score; there is no
  amber because "nearly late" needs a threshold nobody has decided. This is
  the same signal the Command Center already uses.
- Tickets carry **no money and no phone number** (tested), the rule the KOT
  already follows.
- Scoped `git diff --stat` over `src/db`, `src/lib/payments`, `src/lib/tax`,
  `src/lib/pricing`, `src/domain`, `src/lib/repositories`,
  `src/components/pos`, `staff-actions.ts` — **empty**.

**Real data:** `listActiveOrders` (orders, items, modifiers, table names)
filtered by `isLiveInKitchen`; timestamps `placedAt`/`estimatedReadyAt`.

**Permissions:** `kitchen.view` (board) and `kitchen.update` (button) — both
pre-existing; none added or changed. KITCHEN, CASHIER, MANAGER, ADMIN,
OWNER can see it; only those with `kitchen.update` get the button, and the
server re-checks regardless.

**Tests / build:** typecheck, lint, `pnpm test` **340/340** (23 files),
build (40 routes), RSC check — green.

**Known limitations (honest):** polling at 10s, not push — same as the
new-order alert, and the right call until realtime is built deliberately;
no per-station view, prep targets, expo, or throughput (all need domain
decisions); no sound on a new ticket (the counter's `NewOrderAlert` already
chimes at accept; a kitchen chime is a small follow-up); the screen renders
in the IQ light palette like everything under `/app` — the dark-KDS
question noted in the very first audit is still open.

**Next slice this unlocks:** Command Center **Live Operations** — the
manager's read-only mirror of this board (awaiting decision · new · cooking
· ready · late), reusing `toKitchenTickets`, `ordersAwaitingDecision` and
`ordersRunningLate` with zero new queries.

---

## Slice: Finance > Payments ledger (Phase I, read-only) + `finance.view`

**Status:** Complete. Gates green. Deployed (see deployment record).

**Authorization decision (explicitly approved, not autonomous):** A new
`finance.view` permission, **OWNER and MANAGER only**, additive. Evaluated
and deliberately *not* added: `finance.manage` (would re-gate
`recordExpense`/`setFoodCostTarget`, which today sit — loosely — on
`analytics.view`; a separate tightening decision), `finance.refund`
(`orders.refund` already exists with the right roles; the real gap is that
no refund *write path* exists — a payment-architecture stop condition),
`finance.reconcile` (needs register/till schema that doesn't exist).

**Worth the reviewer's eye:** `ADMIN`'s permissions are derived as
"everything except `settings.manage`", so the new permission would have
flowed to ADMIN *silently*. To honour "OWNER and MANAGER only" it is
excluded from ADMIN explicitly in `permissions.ts`, with a comment saying
why. Tests assert the exact role set **and** that ADMIN lost nothing it
already had. If ADMIN was meant to have it, it's a one-token change.

**What it is:** `/app/finance` — every payment in a chosen range
(today / yesterday / 7d / 30d / this month): method, status, provider fee,
who took it, when; method-filter pills with counts; a by-method breakdown;
and a Refunds section. Nav group "Finance › Payments".

**Purchased kit inspection:** `@shadcnuikit/tables16` ("Payment list with
card style rows…") is a SaaS subscription-billing list — Monthly/Yearly
cycles, "Mark as paid", a hard `min-w-[1250px]` non-table layout that would
be hostile on the tablet. `tables10` ("Transaction history…") is personal
banking — Visa/Mastercard logos, ± signed amounts. Adopted three ideas that
map to *real* FRYBIRD columns — a status badge (1:1 with the real
`paymentStatusEnum`), a method filter, and a fee column (`payments.feeAmount`)
— onto the same Card+Table+pill shell `tables9` gave Orders. Dropped bulk
mark-paid/delete and card brands (fake actions / not FRYBIRD data).

**Files changed:**
- `src/domain/permissions.ts`, `src/domain/domain.test.ts` — `finance.view`
  (+2 tests → 334).
- `src/lib/repositories/finance.ts` (new) — `getPaymentsLedger()`.
- `src/components/staff/payments-table.tsx`, `mini-stat.tsx` (new; MiniStat
  factored out of the Customer 360 page so both use one card).
- `src/app/(app)/app/finance/page.tsx` (new); `customers/[id]/page.tsx`
  (import the shared MiniStat).
- `nav-items.ts`, `app-chrome.tsx`, `layout.tsx` — `canSeeFinance` threaded
  like every prior group.

**Business logic preserved / not invented:** This is **not** a second
definition of revenue. Revenue stays `analytics.ts`'s (order `grandTotal`
once captured); this shows the payment *records* and is labelled
"captured", never "revenue". "Who took it" is read from the
`payment_captured` audit row `recordCashPayment` already writes. Every
query is a `SELECT`. Cash capture stays on `orders.update`; payment
processing, refunds, tax and pricing untouched (verified with a scoped
`git diff --stat` over `src/db`, `src/lib/payments`, `src/lib/tax`,
`src/lib/pricing`, `repositories/payments.ts`, `repositories/orders.ts` —
empty).

**Real data:** `payments` ⨝ `orders` (order number, channel), `refunds`
⨝ `orders`, `auditLogs` (actor), `memberships` (names). Refunds will show
empty in production today — no refund path writes that table yet; that is
the honest state, not a bug.

**Tests / build:** typecheck, lint, `pnpm test` **334/334**, build (39
routes), RSC boundary check — all green.

**Known limitations:** bounded to 500 payments / 200 refunds per range (no
pagination — same tradeoff as every table so far); no CSV export
(`reports.export` exists, unused — a natural follow-up); by-method totals
sum *captured* rows only, pending/failed are listed, never summed.

**Next slice this unlocks:** a Channels analytics view (revenue/orders/AOV
by DINE_IN/TAKEAWAY/ONLINE) — `orders.channel` is already indexed for
exactly this, gated on the existing `analytics.view`, zero schema.

---

## Slice: Staff roster + Audit log (Phase H / Admin, read-only)

**Status:** Complete. Gates green.

**What it is:** Two new read-only surfaces:
- `/app/staff` — every staff account, grouped by person (a person can hold
  more than one role), with role badges, active/inactive status, and joined
  date. Gated on `staff.manage` (OWNER/ADMIN only).
- `/app/admin/audit` — a read UI for `platform.ts`'s general `auditLogs`
  table. Gated on `audit.view` (OWNER/ADMIN only) — this permission already
  existed in `domain/permissions.ts` and had zero UI using it until now.

**Purchased kit inspection:** Searched "team members" — `@shadcnuikit/tables4`
("Team members table... sorting, row selection, team badges, edit dialog,
numbered pagination") is the real match. Inspected its source: adopted the
idea of a status badge (active/offline → FRYBIRD's real `isActive`) and a
role badge; **rejected** its bulk row-selection, inline edit dialog, delete,
and pagination — none of those are real FRYBIRD staff actions today, and
building them would be exactly the fake functionality this whole build has
been avoiding. Searched "activity log"/"audit"/"timeline" for the audit
screen and found nothing domain-appropriate purchased-side; reused the same
`Card`+`Table`+search shell already established for Orders/Customers rather
than inventing a third table idiom — consistent with `design-system/
MASTER.md` §11's "avoid page-by-page styling drift."

**An important finding from this inspection, not a build step:** FRYBIRD
already has *two* separate audit trails. `menuAuditLog` (menu-specific field
changes) already has a working read UI — `getRecentChanges()` is consumed
by the existing `/app/iq/menu/review` page. The genuinely unread one is
`platform.ts`'s general `auditLogs` table, written today only by
`payments.ts`'s cash-settlement path (`action: "payment_captured"`). This
slice builds the UI for the *second* one — the real, confirmed gap — not a
duplicate of what Menu review already does.

**Files changed:**
- `src/lib/repositories/staff.ts` (new) — `listStaff()`, grouping
  `memberships` rows by `userId`.
- `src/lib/repositories/audit.ts` (new) — `getAuditLog()`, resolving
  `actorUserId` to a display name via the same `memberships`-lookup pattern
  `listActiveOrders` already uses for "placed by."
- `src/components/staff/staff-table.tsx`, `audit-table.tsx` (new).
- `src/app/(app)/app/staff/page.tsx`, `src/app/(app)/app/admin/audit/page.tsx`
  (new).
- `src/components/staff/nav-items.ts`, `app-chrome.tsx`,
  `src/app/(app)/app/layout.tsx` — new "People" and "Admin" nav groups,
  `canSeeStaff`/`canSeeAudit` threaded through exactly like `canSeeCustomers`
  before them.

**Business logic preserved / not invented:** Both repository functions are
pure `SELECT`s — nothing here writes a membership row or an audit row.
Account provisioning stays exactly as it is today (`pnpm staff:grant`,
`scripts/grant-role.ts`). No stamp/points/permission logic was touched.

**Permissions:** `staff.manage` and `audit.view` both already existed and
were already held by exactly OWNER/ADMIN in `domain/permissions.ts` — **no
permission was added or changed**, only read (via `staffCan`) by two new
pages that each independently re-check it server-side.

**Tests / build:** `pnpm typecheck`, `pnpm lint`, `pnpm test` (332/332),
`pnpm build` (38 routes), `scripts/check-rsc-boundaries.sh` — all green.

**Known limitations:**
- Staff list is read-only by design — no invite/edit/deactivate/role-change.
  Those need shift/invitation schema and a permission-model decision this
  session was explicitly told to stop before making unilaterally.
- Audit log will show very few or zero rows in production today, honestly —
  only cash settlement writes to `auditLogs` right now. This is the correct
  empty state for real data, not a bug.
- No pagination beyond the `limit(100)` cap on either list — same bounded-list
  tradeoff every table this session has made, appropriate for a
  single-location shop's current volume.

**Next slice this unlocks:** Once a real action starts writing a
`price_changed` or `refund_created` row to `auditLogs`, this exact same page
picks it up with zero UI changes — the read side is already general-purpose.

---

## Slice: Customer 360 (Phase D)

**Status:** Complete. Gates green.

**What it is:** Two new pages — `/app/customers` (searchable list) and
`/app/customers/[id]` (profile) — plus a new "Customers" sidebar group and
command-palette entry, gated by the existing `customers.view` permission.
This module was previously repository-only (`findCustomerByPhone`, used by
POS's counter lookup); there was no list or profile UI anywhere.

**Purchased kit inspection:** Searched for "customers"/"CRM" blocks first.
`@shadcnuikit/tables7` ("Customers table with sortable columns, payment
method logos, category badges, clickthrough progress bars") is the
literally-named match — inspected its real source and rejected it: it's a
social-media-influencer table (Visa/Mastercard logos, follower categories,
avatar photos), nothing in it maps to a QSR customer. Reused the
`Card`+`Table`+search shell already established for `OrdersTable` in the
prior slice instead — same visual language, avoids inventing a second table
idiom, and keeps the app's design system from drifting page to page (an
explicit non-negotiable in `design-system/MASTER.md` §11).

**Files changed:**
- `src/lib/repositories/customers.ts` — added `listCustomers()` and
  `getCustomerProfile()`. `findCustomerByPhone` (used by POS) untouched.
- `src/components/staff/customers-table.tsx` (new) — searchable list.
- `src/app/(app)/app/customers/page.tsx` (new) — list page.
- `src/app/(app)/app/customers/[id]/page.tsx` (new) — profile page.
- `src/components/staff/nav-items.ts` — new "Customers" nav group.
- `src/components/staff/app-chrome.tsx`, `src/app/(app)/app/layout.tsx` —
  threaded a new `canSeeCustomers` boolean (from the existing
  `customers.view` permission) through to the sidebar/command palette,
  exactly the extension point the Phase A nav refactor was built for.

**Business logic preserved / not invented:**
- **Order count and total spend use the exact same "paid order" definition**
  `analytics.ts`'s `paidOrders()` already uses for the dashboard's revenue
  figure (captured payment, status not in CANCELLED/FAILED/REFUNDED) — copied
  as a comment-documented, deliberate match, not reinvented. A customer's
  lifetime spend on this page can never disagree with what the dashboard
  calls revenue.
- **Loyalty numbers are read, never computed.** `pointsBalance`, `stampCount`
  come straight from `loyaltyAccounts`; `stampsRequired` comes straight from
  `organizations`. No stamp-awarding, point-earning or reward-eligibility
  logic was touched or reimplemented — `src/lib/loyalty` remains the only
  place that runs those rules.
- Favorite products is a pure read-aggregation (sum of `orderItems.quantity`
  by product name, across the customer's own paid orders) — same technique
  `getDashboard`'s top-products already uses, just scoped to one customer.

**Permissions:** New `canSeeCustomers` reuses the existing `customers.view`
permission (already held by OWNER/ADMIN/MANAGER/CASHIER/ANALYST per
`domain/permissions.ts`) — **no new permission was added**, matching the
directive's "don't silently reuse an unrelated permission" by doing the
opposite: this genuinely is the permission this screen is for. Both new
pages independently re-check `staffCan("customers.view")` server-side and
show `PermissionDenied` rather than relying on the nav item being hidden.

**Tests / build:** `pnpm typecheck`, `pnpm lint`, `pnpm test` (332/332),
`pnpm build` (34 → 36 routes), `scripts/check-rsc-boundaries.sh` — all green.

**Known limitations:**
- List is unpaginated (bounded to 200 customers) and search is client-side
  only, matching the same tradeoff `OrdersTable` already made — correct for
  a single-location shop's current customer count, first thing to revisit if
  that changes.
- No edit/consent-management UI (`customers.edit` exists as a permission but
  nothing calls it yet) — out of scope; this slice is read-only by design,
  matching "Customer 360" as a *view*, not a CRM editor.
- Recent orders list doesn't link anywhere — there is no staff-facing
  per-order detail route outside the Orders workspace's sheet, and inventing
  one just for this link was out of scope.

**Next slice this unlocks:** Segments/marketing (directive's Phase D
extras) would read the same `listCustomers` shape with an added filter
(e.g. "no order in 30 days") — no new repository pattern needed, just a
query addition.

---

## Slice: Command Center — orders running late (real-data attention signal)

**Status:** Complete. Gates green.

**What it is:** A new "N orders are past their promised time" line in
`/app/iq`'s existing "Needs attention" section, shown first (most urgent) of
the four possible attention items.

**Files changed:**
- `src/lib/repositories/analytics.ts` — new `ordersRunningLate(orgId)`, same
  shape and pattern as the existing `ordersAwaitingDecision`.
- `src/app/(app)/app/iq/page.tsx` — wires the new query into the page's
  existing `Promise.all`, adds one list item.

**Business logic preserved / not invented:** This is a **read query, not a
new domain concept**. It compares two columns that already exist and are
already written by the existing order-acceptance path
(`orders.estimatedReadyAt`, set once at ACCEPTED) against `now()` in
Postgres. No new table, no new status, no scoring model, no schema change.
It is the one piece of the "Order Health" idea from the product directive
that is fully real today with zero invention — everything else in that
concept (a GREEN/AMBER/RED score, kitchen load, station awareness) would
need data FRYBIRD doesn't capture yet and is correctly left alone.

**Data source:** `orders` table, scoped by `org_id` (via `analytics.ts`'s
existing `db()` + `eq(orders.orgId, orgId)` pattern, identical to every other
query in that file).

**Permissions:** Gated by the same `analytics.view` check that already gates
the whole `/app/iq` page — no new permission needed, none weakened.

**Tests / build:** `pnpm typecheck`, `pnpm lint`, `pnpm test` (332/332),
`pnpm build`, `scripts/check-rsc-boundaries.sh` — all green.

**Known limitation:** Doesn't yet distinguish "5 minutes late" from "an hour
late" — a real refinement, not attempted here since it starts to look like a
scoring model rather than a fact.

**Next slice this unlocks:** A real GREEN/AMBER/RED Order Health badge would
build directly on this same query (bucket by how late, not just late/not).

---

## Slice: Orders workspace (Phase C)

**Status:** Complete. Gates green.

**What it is:** `/app/orders` rebuilt from a long vertical stack of order
cards into a compact, filterable, searchable table workspace, with a Sheet
on the right for full order detail.

**Purchased kit block used:** `@shadcnuikit/tables9` ("Patient orders table
with segmented status filters, colored status dots, product badges, and
days-in-status counters") — inspected via the real registry source (not a
screenshot). Its actual structure (`Card`/`CardContent` wrapping `Table`, a
segmented status-filter pill row with per-status colored dots and counts, a
responsive filter-toggle button) was adapted; its demo content (patient
records, avatars, bulk archive/delete, `useReactTable`) was not — FRYBIRD
orders don't have bulk archive/delete actions, so building that control
would have been fake functionality.

**Mapping:**

| tables9 concept | FRYBIRD adaptation |
|---|---|
| Segmented status pills, colored dot, count | Same pattern, real `OrderStatus` values, counts from the real `orders` prop |
| "Product" badge column | Item-count badge (`{n} items`) — FRYBIRD orders have multiple lines, not one product |
| Avatar + patient name | Customer name + phone, no avatar (FRYBIRD has no customer photos) |
| "Days in status" circular badge | Replaced with "Placed / promised" time column, reading real `placedAt`/`estimatedReadyAt` |
| Row checkboxes + bulk archive/delete | **Dropped entirely** — no such action exists in FRYBIRD's order lifecycle |
| Row `EllipsisVertical` dropdown | Kept — "View order" (opens sheet) + "Print KOT" (only real actions that make sense as a quick row action) |

**Files changed:**
- `src/components/staff/orders-table.tsx` (new) — the table, search, status
  tabs, and the Sheet wiring.
- `src/components/staff/order-card.tsx` — exported `statusLabel` (was
  already there) and a new small `statusTone()` helper, factored out of the
  card's own inline status-color conditional so the table's status dot and
  the card's own status badge can never disagree about what color a status
  is. **Same visual output as before** — verified by keeping the exact same
  three-way condition, just named.
- `src/app/(app)/app/orders/page.tsx` — renders `<OrdersTable>` instead of
  mapping `<OrderCard>` directly; widened the page to `max-w-6xl` (a table
  needs more width than a card stack); the "no orders at all" `EmptyState`
  stays at the page level exactly as before.

**Business logic preserved (zero duplication):**
- `OrderCard` itself is **reused unmodified** inside the Sheet — every
  action (Accept & print KOT, Start cooking, Ready, Send out, Handed
  over/Delivered, Take/settle payment, WhatsApp, Receipt link, Print KOT) is
  the exact same component calling the exact same
  `advanceOrderAction`/`markPaidAction`/`openKotWindow`/`whatsappOrderLink`
  it always did. There is exactly one place in the codebase that calls each
  of those.
- The table's own row-level "Print KOT" quick action calls the identical
  `openKotWindow().commit(order.id)` function `OrderCard` calls — reused, not
  reimplemented.
- Search and status-tab filtering are pure client-side array filters over
  the same `StaffOrder[]` the page already fetched via `listActiveOrders` —
  no new query, no new data path.
- The Sheet looks up the selected order fresh from `orders` on every render
  (never a cached snapshot), so a status change inside it — which triggers
  `OrderCard`'s existing `router.refresh()` — is reflected immediately, and
  the sheet closes itself cleanly if the order leaves the active list (e.g.
  it just completed).

**Permissions:** `canSettle`/`canAdvance`/`canPrintKot` — same three booleans
the page already computed (`orders.update`, `kitchen.update`,
`kitchen.view`), passed through unchanged to both the row-level Print KOT
action and the Sheet's `OrderCard`.

**Tests / build:** `pnpm typecheck`, `pnpm lint`, `pnpm test` (332/332),
`pnpm build`, `scripts/check-rsc-boundaries.sh` — all green.

**Known limitations:**
- No pagination — matches `listActiveOrders`'s existing `limit(100)`
  behavior; not a regression, just not newly solved either.
- The row/sheet still says "This list updates when you reload" — realtime
  wasn't in scope and isn't touched.
- Search is client-side only (over already-fetched active orders); it is not
  a database search and cannot find a completed/terminal order — matches
  what `listActiveOrders` already scopes to.

**Next slice this unlocks:** Once this table pattern exists, the same
`tables9`-derived shell is the natural home for a future Menu review-queue
or Audit-log table (both flagged as PARTIAL/PLANNED in
`FRYBIRD-ADMIN-ARCHITECTURE.md`).

---

## Slice: Application shell foundation (Phase A)

**Status:** Complete, deployed to frybirdiq.tech, visually verified by
Lovepreet.

**What it is:** The back-office shell (everything except POS, untouched)
got a persistent breadcrumb, a ⌘K/Ctrl+K command palette, an avatar/dropdown
account menu, and card-based KPI tiles — plus the nav data model was
restructured so future modules (Inventory, People, Finance, ...) can be
added without another shell redesign.

**Purchased kit blocks used:**
- `@shadcnuikit` dashboard-shell1's structural pattern (inset sidebar +
  `SiteHeader` with breadcrumb/search/user-menu) — verified structurally
  identical to FRYBIRD's own existing `SidebarProvider`/`AppSidebar`/
  `SidebarInset` shell, so the existing shell was extended rather than
  replaced.
- Canonical shadcn `breadcrumb` and `command` primitives (Base UI variant,
  matching the project's `"base-nova"` style) — pulled via
  `npx shadcn add breadcrumb command`, not from the kit itself, since kit
  blocks compose over whatever primitives a project already has.
- `stat-card1`'s `Card`/`CardContent` shape informed `StatTile`'s new
  wrapper; its own color/delta logic (hardcoded Tailwind colors, single-signal
  delta) was rejected as worse than FRYBIRD's existing accessible delta.

**Files changed:** `src/components/staff/{nav-items.ts, app-sidebar.tsx,
app-chrome.tsx, command-palette.tsx, user-menu.tsx, section-breadcrumb.tsx,
page-header.tsx}` (new/rewritten), `src/components/iq/stat-tile.tsx`,
`src/app/(app)/app/iq/page.tsx`, `src/app/(app)/app/orders/page.tsx`
(superseded by the Orders slice above), `src/components/ui/{breadcrumb.tsx,
command.tsx, input-group.tsx, textarea.tsx}` (new, canonical registry),
`package.json`/`pnpm-lock.yaml` (added `cmdk`).

**Business logic preserved:** Zero — this was pure shell/chrome. All
`staffCan()` gates, all repository calls, all POS logic untouched. POS's own
full-bleed header branch in `app-chrome.tsx` was not touched at all.

**Architecture improvement:** `buildNavGroups()` in `nav-items.ts` is now the
single source of truth for both the sidebar and the command palette — a
future nav group is one array entry, not a change to two render paths.

**Tests / build:** All green at the time. Deployed via `./deploy/deploy.sh`
and smoke-tested (HTTP 200) — the only slice in this log that has actually
shipped to production so far.

---

## Cumulative state of validation

As of the most recent slice above: `pnpm typecheck` clean, `pnpm lint`
clean, `pnpm test` 480/480 passing (37 files), `pnpm build` succeeds (62
routes), `scripts/check-rsc-boundaries.sh` clean.

## Deployment record

### 2026-09-14 17:19 UTC — Realtime channel fix (no migration)

Deployed via `./deploy/deploy.sh root@194.238.16.200` from
`kit-radix-nova` at `1025fc0`. Gates in-script green (459/459, RSC check
OK). Post-deploy: `active`, 0 restarts; remote `BUILD_ID`
`ig5S4tnB65J7wW5zp6R6Q` equals the local build; the unique-channel
template is present in the shipped realtime chunk; smoke `HTTP 200` on
`/`, `/menu`, `/sign-in`; `/app/orders` and `/app/kds` redirect to
sign-in; journal clean. No production record touched.

### 2026-09-14 16:12 UTC — Roadmap Phase 0–2 (+ migration 0027), backups, main fast-forwarded

`pnpm db:migrate` applied `0027_realtime_order_events` to production
first (27 → 28; trigger and publication verified). Then deployed via
`./deploy/deploy.sh root@194.238.16.200` from `kit-radix-nova` at
`6bbde8a`. Gates in-script green (457/457, RSC check OK). Post-deploy:
`active`, 0 restarts; remote `BUILD_ID` `KdHZc-5jqauLg4GNeExJ6` equals
the local build; smoke `HTTP 200` on `/`, `/menu`, `/sign-in`, `/cart`;
`/app/*` redirects to sign-in; unknown order id 404; webhook 503 without
Razorpay keys; journal clean. `postgresql-client` + scratch `postgresql`
installed on the VPS; `frybird-backup.timer` enabled; first dump and
restore check done (restore script fixed in `3bc9b46` and re-shipped to
`/usr/local/bin/frybird-restore-check`, not part of the app build).
`kit-radix-nova` pushed to origin (new branch); `main` fast-forwarded
`537f396 → 3bc9b46` locally and on origin. No history rewritten.

### 2026-09-14 14:45 UTC — Products analytics join fix

Deployed via `./deploy/deploy.sh root@194.238.16.200` from
`kit-radix-nova` at `573dcab`. Gates in-script green (444/444). Post-
deploy: `active`; smoke `HTTP 200`; read-only production check of
Products and the Overview. No production record touched; sessions
revoked; temp scripts deleted.

### 2026-09-14 14:20 UTC — Design phase 2, wave 2

Deployed via `./deploy/deploy.sh root@194.238.16.200` from
`kit-radix-nova` at `19919ff` (and `22f8e9a` before it). Gates
in-script green. Post-deploy: `active`; smoke `HTTP 200`. Read-only
verification on the local build; no production record touched.

### 2026-09-14 13:55 UTC — Design phase 2, wave 1

Deployed via `./deploy/deploy.sh root@194.238.16.200` from
`kit-radix-nova` at `da46b7a`. Gates in-script green (443/443, RSC check
OK). Post-deploy: `active`; smoke `HTTP 200`. Verified read-only on the
local build before deploying (Orders, Live, Customers, Staff, Inventory,
Finance, P&L, Expenses, Products, Channels, Promotions, KDS, Printers at
1440 and 390, console clean). No production record touched; session
revoked; temp helpers deleted.

### 2026-09-14 13:15 UTC — Design language phase 1 (no migration)

Deployed via `./deploy/deploy.sh root@194.238.16.200` from
`kit-radix-nova` at `904a883`. Gates in-script green (443/443, RSC check
OK). Post-deploy: `active`; smoke `HTTP 200`. Verified on the local build
before deploying: Overview, Orders, Printers, Promotions, Bill & Receipt,
Products, Channels, Restaurant, Ingredients, POS and KDS at 1440 and 390,
console clean; the printer setup flows (browser and simulated app) re-run
end to end on the restyled primitives. See the incident note in the slice
entry above: the real Bluetooth printer row needs restoring.

### 2026-09-14 12:10 UTC — Printer setup UX (browser vs FRYBIRD POS app)

Deployed via `./deploy/deploy.sh root@194.238.16.200` from
`kit-radix-nova` at `529b4f3`. Gates in-script green (443/443, RSC check
OK). Post-deploy: `active`; smoke `HTTP 200`; signed-in production walk
as Chrome on the Redmi Pad (gate, Open FRYBIRD POS intent link, LAN
continue, Bluetooth/USB disabled) and as the simulated FRYBIRD POS
bridge (Redmi Pad / Android POS / Printer Bridge ✓, Bluetooth off →
Turn On → scan → KPC307-UEWB-A6FE → Connect → Test Connection → Test
Print → save → Connected card), console clean; simulated rows removed,
the real "Chrome on Android" device and its printer untouched.
Sessions revoked, temp scripts deleted. APK (bridge 1.2.0) built
locally, installed by hand.

### 2026-09-13 15:05 UTC — Bluetooth transport (no migration)

Deployed via `./deploy/deploy.sh root@194.238.16.200` from
`kit-radix-nova` at `d86d8f4`. Gates in-script green (441/441, RSC
check OK). Post-deploy: `active`; smoke `HTTP 200`; signed-in production
walk with the simulated Bluetooth bridge (radio off → error, scan,
connect, save, test connection, test print, printer off → disconnected
error, POS pill), then cleanup of the simulated rows. The real "Chrome
on Android" device and its LAN printer were not touched. Android APK
(bridge 1.1.0) built locally; installed by hand on the Android device.

### 2026-09-13 14:15 UTC — Hardware: devices, printers, print jobs, local printer bridge (+ migration 0026)

Migration 0026 applied from the Mac before the deploy (three new tables
with RLS; verified via information_schema — tables, policies, journal
27). Deployed twice via `./deploy/deploy.sh root@194.238.16.200` from
`kit-radix-nova`: `51fe96f` (the feature) and `3e07048` (a hydration fix
for "seconds ago" on the Printers page). Gates in-script green (439/439,
RSC check OK). Post-deploy: `active`; smoke `HTTP 200`; signed-in
production walk in a plain browser and with the simulated bridge
(register → discover → add printer → test connection → test print →
offline reconnect → remove); console clean after the fix. Simulated
device, printer and jobs removed; verification sessions revoked; temp
scripts deleted. Android APK built locally, not deployed anywhere — it
is installed by hand on the Redmi Pad.

### 2026-09-13 11:05 UTC — Bill & Receipt designer (+ migration 0025)

Migration 0025 applied from the Mac before the deploy (new table
`receipt_designs` with RLS; verified via information_schema — table,
policy, journal 26). Deployed via `./deploy/deploy.sh
root@194.238.16.200` from `kit-radix-nova` at `2ee7a42`. Gates in-script
green (405/405, RSC check OK). Post-deploy: `active`; smoke `HTTP 200`;
signed-in production walk: draft cleaned, "Served by" applied, print
media check, 390, one real POS sale (#013) printed through the design;
console clean. Verification sessions revoked, temp scripts deleted.

### 2026-09-13 02:36 UTC — Promotions slice A (+ migration 0024)

Migration 0024 applied from the Mac before the deploy (additive columns,
`code` nullable, check constraints, one-row backfill; verified via
information_schema — 34 columns, journal 25). Deployed via
`./deploy/deploy.sh root@194.238.16.200` from `iq-dashboard` at
`34b1ff6`. Gates in-script green (392/392). Post-deploy: `active`; smoke
`HTTP 200`; signed-in production walk created one draft per type; no
runtime errors since the restart.

### 2026-09-13 01:44 UTC — Overview v3 slice A (+ migration 0023)

Migration 0023 applied from the Mac before the deploy (two additive
columns; verified via information_schema; journal entry 24). Deployed
via `./deploy/deploy.sh root@194.238.16.200` from `iq-dashboard` at
`87eca04`. Gates in-script green (372/372). Post-deploy: `active`; smoke
`HTTP 200`; signed-in production walk at 390 and 1440 (tiles, drawers,
range, comparison, Restaurant › Operations) clean; no runtime errors
since the restart.

### 2026-09-13 01:17 UTC — POS accept-at-placement, alert source filter, Customer control

Deployed via `./deploy/deploy.sh root@194.238.16.200` from `iq-dashboard`
at `b013cc2`. Gates in-script green (tests 355/355). Post-deploy:
`active`; smoke `HTTP 200`; production walk placed order #009 (see
slice); no runtime errors since the restart.

### 2026-09-13 — POS rewards enrolment

Deployed via `./deploy/deploy.sh root@194.238.16.200` from `iq-dashboard`
at `7c3d151`. Gates in-script green (tests 348/348). Post-deploy:
`active`; smoke `HTTP 200`; no runtime errors since the restart.

### 2026-09-13 00:27 UTC — Orders board (slice 4)

Deployed via `./deploy/deploy.sh root@194.238.16.200` from the working
tree that became `c2daafa` on `iq-dashboard` (the commit landed one
step after the deploy because a `git add` on the already-staged deletion
aborted the chain; the deployed files are identical to the commit). Gates
in-script green (tests 340/340). Post-deploy: `active`; smoke `HTTP 200`;
`/sign-in` → `200`; `/app/orders`, `/app/iq` → `307` to `/sign-in`; no
runtime errors since the restart.

### 2026-09-13 — /app/iq polish

Deployed from `e3b4f2e`. Gates green; `active`; `HTTP 200`; no errors.

### 2026-09-13 — Shell (slice 2) + Overview (slice 3)

Deployed via `./deploy/deploy.sh root@194.238.16.200` from `iq-dashboard`
at `0acc6cf`. Gates in-script green (tests 340/340). Post-deploy:
`active`; smoke `HTTP 200`; `/sign-in`, `/menu` → `200`; `/app/iq`,
`/app/orders`, `/app/pos`, `/app/inventory` → `307` to `/sign-in`; no
runtime errors after the restart beyond stale-tab action noise.

### 2026-09-12 23:39 UTC — TooltipProvider hotfix

Deployed via `./deploy/deploy.sh root@194.238.16.200` from `iq-dashboard`
at `9e4ca19`. Gates in-script green (tests 340/340). Post-deploy:
`active`; smoke `HTTP 200`; `/sign-in` and `/menu` → `200`; `/app/orders`,
`/app/iq`, `/app/inventory`, `/app/pos` → `307` to `/sign-in`. Tooltip
error count strictly after the restart: 0 (the last one, 23:39:26, came
from the previous process).

### 2026-09-12 23:30 UTC — radix-nova switch (other session, `b6d2aaa`)

Not deployed from this session; recorded because it is what production
ran between 23:30 and 23:39 and it is the build the hotfix above repairs.

### 2026-09-13 — Inventory master data slice

Deployed via `./deploy/deploy.sh root@194.238.16.200` from `iq-dashboard`
at `0de2154`. First attempt: gates and build green, then rsync died
mid-ship (`unexpected end of file` — the SSH connection dropped; a health
check over SSH timed out too). Second run straight after went through
end to end: `active`; smoke `HTTP 200`. Post-deploy: `/app/inventory`,
`/app/inventory/suppliers`, `/app/inventory/ingredients/<uuid>` → `307` to
`/sign-in`; `/app/pos` and `/app/iq` controls → `307`; logs `Started` /
`✓ Ready`, usual stale-tab server-action notice, and `NotSignedIn` lines
for the unauthenticated hits — the same `requireStaff()` behaviour as the
other 15 pages that use it, not new.

### 2026-09-12 — Promotions slice

Deployed via `./deploy/deploy.sh root@194.238.16.200` from `iq-dashboard`
at `d36d614`. Gates in-script green (tests 340/340). Post-deploy:
`active`; smoke `HTTP 200`; `/app/customers/promotions` → `307` to
`/sign-in`; `/app/customers` and `/app/pos` controls → `307`; logs
`Started` / `✓ Ready`, no runtime errors, usual stale-tab noise.

### 2026-09-12 — Segments + channel filter slice

Deployed via `./deploy/deploy.sh root@194.238.16.200` from `iq-dashboard`
at `81683d3`. Gates in-script green (tests 340/340). Post-deploy:
`active`; smoke `HTTP 200`; `/app/customers`, `/app/orders` → `307` to
`/sign-in`; `/app/pos` control → `307`; logs `Started` / `✓ Ready`, no
runtime errors, usual stale-tab noise.

### 2026-09-12 — Integration slice (Right now / deep links / customer links)

Deployed via `./deploy/deploy.sh root@194.238.16.200` from `iq-dashboard`
at `192cedb`. Gates in-script green (tests 340/340). Post-deploy:
`active`; smoke `HTTP 200`; `/app/iq`, `/app/orders?open=<id>`,
`/app/iq/live` → `307` to `/sign-in`; `/app/pos` control → `307`; logs
`Started` / `✓ Ready`, no runtime errors, usual stale-tab noise.

### 2026-09-12 — Restaurant settings slice

Deployed via `./deploy/deploy.sh root@194.238.16.200` from `iq-dashboard`
at `52b4721`. Gates in-script green (tests 340/340). Post-deploy:
`active`; smoke `HTTP 200`; `/app/admin/restaurant` → `307` to `/sign-in`;
`/app/admin/audit` and `/app/pos` controls → `307`; logs `Started` /
`✓ Ready`, no runtime errors, usual stale-tab noise.

### 2026-09-12 — Products slice

Deployed via `./deploy/deploy.sh root@194.238.16.200` from `iq-dashboard`
at `b3972f9`. Gates in-script green (tests 340/340). Post-deploy:
`active`; smoke `HTTP 200`; `/app/iq/products` and `?range=mtd` → `307` to
`/sign-in`; `/app/iq/channels` and `/app/pos` controls → `307`; logs
`Started` / `✓ Ready`, no runtime errors, usual stale-tab noise.

### 2026-09-12 — Channels slice

Deployed via `./deploy/deploy.sh root@194.238.16.200` from `iq-dashboard`
at `31b1239`. Gates in-script green (tests 340/340). Post-deploy:
`active`; smoke `HTTP 200`; `/app/iq/channels` and `?range=30d` → `307` to
`/sign-in`; `/app/iq/activity` and `/app/pos` controls → `307`; logs
`Started` / `✓ Ready`, no runtime errors, usual stale-tab noise.

### 2026-09-12 — Activity slice

Deployed via `./deploy/deploy.sh root@194.238.16.200` from `iq-dashboard`
at `63e177d`. Gates in-script green (tests 340/340). Post-deploy:
`active`; smoke `HTTP 200`; `/app/iq/activity` → `307` to `/sign-in`;
`/app/iq/live` and `/app/pos` controls → `307`; logs `Started` / `✓ Ready`,
no runtime errors, usual stale-tab noise.

### 2026-09-12 — Live operations slice

Deployed via `./deploy/deploy.sh root@194.238.16.200` from `iq-dashboard`
at `dc84632`. Gates in-script: typecheck, lint, tests **340/340**, RSC
check, build — green. Post-deploy: `systemctl is-active` → `active`; smoke
test `HTTP 200`; `/app/iq/live` → `307` to `/sign-in` (unauthenticated,
correct); `/app/kds` and `/app/pos` controls → `307` (unchanged); logs:
`Started` / `✓ Ready`, no runtime errors, only the usual pre-deploy
stale-tab server-action noise.

### 2026-09-12 (later still) — KDS slice

Deployed via `./deploy/deploy.sh root@194.238.16.200` from `iq-dashboard`
at `4ec9f1b`. Gates in-script: typecheck, lint, tests **340/340**, RSC
check, build — green. Post-deploy: `systemctl is-active` → `active`; smoke
test `HTTP 200`; `/app/kds` → `307` to `/sign-in` (unauthenticated,
correct); `/app/pos` control and `/app/finance` → `307` (unchanged); logs
show the old process stopping (exit 143) then `Started` / `✓ Ready`, plus
the same pre-deploy stale-tab server-action noise — no crash, no restart
loop.

### 2026-09-12 (later) — Finance slice

Deployed via `./deploy/deploy.sh root@194.238.16.200` from `iq-dashboard`
at `906e2ba` (`c8561ec` finance.view permission, `906e2ba` Finance view).
Gates in-script: typecheck, lint, tests **334/334**, RSC check, build —
green. Post-deploy: `systemctl is-active` → `active`; smoke test `HTTP 200`;
`/app/finance` and `/app/finance?range=7d` → `307` to `/sign-in`
(unauthenticated, correct), `/app/pos` control → `307` (unchanged); logs
show only the same two pre-deploy stale-tab server-action hashes as the
previous deploy — no crash, no restart loop.

### 2026-09-12 — shell / Orders / Customers / Staff / Audit batch

Deployed via `./deploy/deploy.sh root@194.238.16.200`, from
`iq-dashboard` at commit `f2c6634` (five focused feature commits,
`ee8bf28`..`160282c`, plus this doc):

- `ee8bf28` — app shell (breadcrumb, command palette, user menu, nav model)
- `bd65f32` — Orders workspace
- `8eda56b` — Command Center card tiles + orders-running-late signal
- `a7bf9f8` — Customer 360
- `160282c` — Staff roster + Audit log

**Gates before deploy:** `pnpm typecheck`, `pnpm lint`, `pnpm test`
(332/332), `scripts/check-rsc-boundaries.sh`, `pnpm build` (38 routes) — all
green, run by `deploy.sh` itself.

**Post-deploy verification:**
- `systemctl is-active frybird` → `active`
- Deploy script's own smoke test → `HTTP 200`
- `https://frybirdiq.tech/` → `HTTP 200`
- `/app/iq`, `/app/orders`, `/app/customers`, `/app/staff`,
  `/app/admin/audit`, `/app/pos` → all `HTTP 307` to `/sign-in` (correct:
  unauthenticated requests to `staffCan`-gated pages; POS included as an
  unchanged control to confirm nothing regressed there)
- `journalctl -u frybird` post-restart: clean startup, only expected
  `NotSignedIn` entries (from the route checks above) and one stale
  `Failed to find Server Action` from a browser tab left open from before
  the deploy (expected — Next.js server-action IDs change every build;
  resolves on reload). No crash, no restart loop.

## What has NOT been touched (by design)

POS (`src/components/pos/*`), the dine-in floor plan/table grid, all
payment/pricing/tax/GST logic, all repositories' write paths (every new
repository function across every slice is a `SELECT`, never an
`INSERT`/`UPDATE`), every server action's actual behavior, and the database schema. In
`src/domain/permissions.ts`, three existing permissions (`customers.view`,
`staff.manage`, `audit.view`) were only *read* via `staffCan()`; exactly one
permission was **added** — `finance.view`, by explicit approval, additive,
OWNER + MANAGER — and none were weakened.

## Where the roadmap hits a real stop condition next

Unchanged from the prior analysis — still accurate after this batch:

- **Phase E — Menu Intelligence.** The Menu Control Center is already the
  most mature module in the app. "Improve the visual system significantly"
  on the *best-working* surface is real redesign risk, not a mechanical
  slice — needs a scoped decision before touching it.
- **Phase F — Inventory UX.** Schema is excellent and complete
  (`db/schema/inventory.ts`), zero repository layer. Real screens need
  consumption-logic decisions (how a purchase-order receipt affects
  `inventoryItems`, what "low stock" means) that are business calls, not
  styling — "inventory write-path" territory the directive gates.
- **Phase G — KDS beyond the station-less board now shipped.** Stations,
  routing, prep targets, expo and throughput all need a station/routing
  concept that exists nowhere in schema or domain. The directive is
  explicit: stop before inventing that schema. The board itself needed none
  of it.
- **Phase H — Staff/Access beyond the read-only list already shipped.**
  Roles, shifts, invitations all need new schema — still gated.

- **Finance beyond the read-only ledger** — `finance.manage` (re-gating
  expense writes off `analytics.view`), a refund write path, and
  reconciliation all remain explicit-approval items; the Payments ledger
  itself shipped on the approved `finance.view`.

## Safe roadmap complete — what needs a decision to continue

Every remaining roadmap item now requires one of the mandatory-stop
decisions. Each is stated the way the directive asks — requirement, why,
what exists, options, recommendation — so it can be approved or declined
in one line.

**1. Menu Control Center visual pass (Phase E).** *Requirement:* a scoped
definition of what changes. *Why:* it is the app's most mature module; an
autonomous "significant redesign" risks the best-working surface.
*Exists:* the full CRUD, review queue, media library. *Options:* (a)
chrome-only pass — Card/Table/PageHeader consistency, no form changes; (b)
full redesign. *Recommend (a)*, as one slice, then review.

**2. Product cost & margin (Menu Engineering, second half).** *Requirement:*
a net-of-tax margin path. *Why:* `basePrice` is GST-inclusive; CLAUDE.md
requires margins on net-of-tax revenue via `src/lib/pricing`; new
financial logic. *Exists:* pure, tested `lib/iq/costing.ts` / `profit.ts`
/ `pricing.ts`; `recipes`/`recipe_items` schema; **no recipe lines in
production and no UI to enter them** — so this also needs the Inventory
write path (next item). *Recommend:* approve as one designed slice after
item 3, not before.

**3. Inventory (Phase F).** *Requirement:* write paths — ingredients,
suppliers, stock movements, recipe lines — and the order→consumption
decision. *Why:* explicit stop condition. *Exists:* complete, excellent
schema, zero repository layer, zero data. *Options:* (a) ingredients +
suppliers + recipe-line CRUD first (no consumption); (b) consumption on
order completion too. *Recommend (a)* first; consumption is its own review.

**4. KDS stations / routing (Phase G).** *Requirement:* a station model.
*Why:* explicit stop condition. *Exists:* `products.kdsStation` (text) and
`prepMinutes` columns, unused; the station-less board is live.
*Recommend:* decide whether `kdsStation` free-text on products is the
model, or a `stations` table; then a KDS station filter is a small slice.

**5. Staff & Access writes (Phase H).** *Requirement:* invitations, role
assignment, deactivation; shifts/attendance need new schema. *Why:*
permission-architecture stop condition. *Exists:* `memberships`, the CLI
`pnpm staff:grant`. *Recommend:* approve role assign/deactivate on
`staff.manage` (writes to `memberships` + an `auditLogs` row, no schema);
defer shifts until a register/shift schema is designed with cash.

**6. Finance writes.** *Requirement:* `finance.manage` (re-gating
`recordExpense`/`setFoodCostTarget` off `analytics.view` — a tightening
that removes ANALYST's current write), a refund write path (`refunds`
table is never written), cash-register/reconciliation schema. *Why:*
payment/financial stop conditions. *Recommend:* approve `finance.manage`
now (pure tightening, zero schema); design refunds and registers together.

*Decided 2026-09-15 — `finance.manage` half only.* Approved and shipped
(`81df18e`): `recordExpense`/`setFoodCostTarget` and the three UI gates now
check `finance.manage`, separate from `finance.view` (the ledger read).
Granted to OWNER, MANAGER, **and ADMIN** — asked directly, since ADMIN
already held `orders.refund` (the highest-trust money action in the
table) but couldn't log that money was spent; that asymmetry read as an
accident of `finance.manage` not existing yet, not a boundary anyone
intended. Checked production first: zero ADMIN memberships exist today
(only OWNER and RIDER are assigned, at all), so the change had zero live
blast radius when it shipped. `finance.view` itself is untouched. The
refund write path and cash-register/reconciliation schema are still
undesigned — that half of this item stays open.

**10. `getInvoice`'s missing org filter — needs a policy decision, not a
repository fix.** *Found 2026-09-15, alongside `listSavedAddresses`
(same audit).* Both queried without scoping by `org_id`, which
`org.ts`'s own doc-comment and CLAUDE.md call a non-negotiable — Drizzle
over `DATABASE_URL` bypasses RLS, so the repository layer is the only
guard. `listSavedAddresses` was fixed (`fb37bec`): its one caller
(`checkout`) already resolves an authenticated, org-scoped customer, so
threading `orgId` through was a real second check, not a formality.
`getInvoice` is different and was deliberately left alone: its only
caller is the fully unauthenticated public receipt page
(`/order/[id]/invoice`) — no session, no staff, no org context of any
kind, just the order's UUID acting as the page's entire access control.
Adding an `orgId` requirement there isn't mechanically possible without
first deciding whether that customer-facing receipt page should require
login — an authorization/UX policy call with real customer-experience
impact, not something to guess at. *Recommend:* decide whether the
UUID-as-bearer-token pattern is the intended design (common for
guest-checkout order confirmation, and low-risk at one org today) or
whether the invoice page should require a signed-in, verified customer
session before it's shown — then the repository fix, if any, follows
directly from that answer.

**7. Settings edit forms.** *Requirement:* forms for what
`/app/admin/restaurant` now shows. *Why:* `price_basis` in particular
misstates revenue retroactively if flipped. *Recommend:* approve forms for
the safe fields (legal name, GSTIN, phone, address) first; keep
`price_basis` read-only behind an explicit, separate approval.

**8. POS UX refinement (Phase C of the master roadmap).** *Requirement:*
a scope. *Why:* money-touching, tablet-only, "never slower". *Exists:* a
working POS untouched by this session. *Recommend:* approve a
measurement-first pass — no visual change without a timed comparison.

**9. AI (Phase L).** *Requirement:* a tool/service layer over the existing
repositories, writing to the existing `ai_conversations`/`ai_tool_calls`
tables; an `ai.use` permission. *Why:* explicit stop condition. *Exists:*
schema only. *Recommend:* approve the tool layer design first, read-only
tools only, Daily Brief before Ask FRYBIRD.

**Not recommended yet:** Devices/Printers (no telemetry exists — anything
shown would be fake), Integrations (table exists, nothing populates it),
Inventory read-only screens before item 3 (they would render empty).

Previously queued and shipped in this session: the **integration slice**,
**Admin › Restaurant**, **Promotions**, **segments/channel filters**, and
the **Channels analytics view** —
revenue / orders / AOV split by DINE_IN / TAKEAWAY / ONLINE over a chosen
range. `orders.channel` is already indexed with `placedAt` for exactly this
question (`orders_channel_placed_idx`), it reuses `analytics.ts`'s existing
`paidOrders()` revenue definition unchanged, it's gated on the existing
`analytics.view`, needs zero schema, and `FRYBIRD-ADMIN-ARCHITECTURE.md`
already flags channel performance as "revisit if it becomes a real need."

## Closing the test-coverage gap — and correcting the list it came from

A prior audit listed 8 `src/lib` files as untested by checking only for a
same-named sibling `.test.ts`. That check has a real blind spot: this
codebase's own convention is to group tests by *feature*, not by
filename — `src/lib/iq/profit.test.ts` already covered `breakeven.ts` and
`pricing.ts`'s main paths, and `src/lib/receipt/render.test.ts` already
had a `describe("template", ...)` block covering `template.ts`'s core
cases. Two of the eight were reported untested and were not — verified by
grepping every `.test.ts` for each function name before writing anything,
not by trusting the original list.

**What was actually added, 2026-09-15:**
- `src/lib/iq/units.test.ts` (new) — genuinely had zero coverage.
- `src/lib/promotions/form.test.ts` (new) — genuinely had zero coverage.
- `src/lib/cart/schema.test.ts` (new) — genuinely had zero coverage. Tests
  `lineKey`'s real behaviour but deliberately does not assert on the known
  `"|"`-join ambiguity (see `claude/v2-evolution`'s unmerged `1f9c505`) —
  fixing that is someone else's pending decision, not this slice's.
- `src/lib/notifications/whatsapp-link.test.ts` (new) — genuinely had zero
  coverage.
- `src/lib/iq/profit.test.ts` (extended) — `pricing.ts`'s four `throw`
  branches (unreachable/negative margin, 0%/>100% food cost target) and
  `achievedMarginBps`'s zero-price case were real gaps even though the
  file existed; added rather than duplicated into a new `pricing.test.ts`.
- `src/lib/receipt/render.test.ts` (extended) — `template.ts`'s URL
  validation, empty-sections rejection, seed-conditional field visibility,
  `newTextSection`, `SECTION_LABELS`, and `IMAGE_WIDTH_PCT` were real gaps
  in an already-existing `describe` block.

**Deliberately not touched:** `src/lib/pos/pricing.ts`. It lives under
`src/lib` but imports `server-only` and calls two DB-backed repository
functions (`getMenu`, `resolvePricingContext`) directly — it is not pure
the way CLAUDE.md's "every function in domain/lib has a test" is scoped
for, the same exception the repository layer already gets. No test in
this codebase's 550 cases uses `vi.mock`; introducing one here would be a
new testing pattern, not a missing test, and is a real decision (mock the
repositories, or split the pure line-resolution logic out of the
DB-fetching orchestration) rather than something to default into.

489 → 550 tests. typecheck, lint, and the RSC-boundary check all clean.
Not redeployed — none of this changes served behaviour; test files are
not part of the production build.

## Promotions get their own permission, decided who holds it

The other half of the promotions permission gap named earlier in this
file: writes were gated on `settings.manage` ("the closest existing
permission to 'decides prices'" — the file's own comment). Split into a
dedicated `promotions.manage`, mechanically first (`b7926fc`, OWNER
only, exactly who could write before — zero access change), then the
actual decision asked directly rather than guessed: MANAGER already
holds `orders.discount` (bounded, one order) but not `menu.price`
(unbounded, every future order); a promotion sits between the two.

**Decided 2026-09-15: OWNER + MANAGER, not ADMIN.**
Run as an operational marketing tool the same role that already applies
counter discounts can also run, rather than folded into the OWNER/ADMIN
tier `menu.price`/`menu.publish` sit in — the opposite shape from the
`finance.manage` decision, where ADMIN got in and MANAGER already had
it. Updated everywhere the old OWNER-only framing was written: the
domain tests, the server action's error string, and the workspace UI's
own "Only an owner can change promotions" copy.

552 tests. typecheck, lint, RSC-boundary check all clean.

## iq/pnl vs finance — not duplicate pages, but a duplicated revenue query

Checked the open question from the audit: are `/app/iq/pnl` and
`/app/finance` the same domain twice? No — confirmed by reading both.
Finance is the payments ledger (captured money, by method, refunds,
provider fees); its own copy says so plainly: "Captured means the money
arrived; it is not the revenue figure on Overview." P&L is the margin
statement (revenue minus recorded costs). Different questions, and the
two pages cross-link to each other rather than compete.

What *was* duplicated, underneath both: `src/lib/repositories/
expenses.ts` had its own `paidRevenue`/`paidOrderCount`, and a third copy
inside `foodCostWeeklySeries` — three separate hand-written SQL joins all
encoding the same "captured payment, not cancelled/failed/refunded" rule
that `analytics.ts`'s private `paidOrders()` already defines for every
other revenue figure in the app (Overview, Channels, etc.). Currently
identical output by construction, but the P&L page's own comment
("nothing here is typed in twice") wasn't actually true — three
independent copies of the same business rule is exactly the drift risk
the comment claims doesn't exist.

Fixed by exporting `paidOrders` from `analytics.ts` and having all three
call sites in `expenses.ts` use it instead of their own SQL — `orders`,
`payments`, `lt` are no longer imported in that file at all.
`getProfitAndLoss` went from two separate queries (`paidRevenue` +
`paidOrderCount`, run in parallel) to one, deriving both from the same
rows — a real (if small) performance win alongside the correctness one.
No behavior change: same join, same filter, same numbers, verified by
the full gate suite. No new test needed — `getProfitAndLoss` and
`foodCostWeeklySeries` are DB-backed repository functions, the same
"not pure, no vi.mock precedent" category `pos/pricing.ts` was left in
during the test-coverage pass.

552 tests (unchanged — pure refactor). typecheck, lint, RSC-boundary
check all clean.

## claude/v2-evolution reconciled — 3 of 5 commits ported, deployed

Full specialist re-review (3 parallel agents, one per commit, strictly
read-only — git checkout/cherry-pick/merge/reset explicitly forbidden
after an earlier session in this same repo had a background agent
violate exactly that boundary) against current HEAD, re-verified with
`git merge-tree` rather than trusted from the last check.

**Ported, manually reimplemented (not cherry-picked — the `git
cherry-pick` command itself is blocked by Claude Code's own permission
classifier as "Modify Shared Resources"):**
- `fa6e23d` — `.github/workflows/ci.yml`. Clean, zero conflict, zero
  production risk (no deploy step, no secrets — verified by reading the
  full YAML, not trusting the commit message).
- `34dddc6` — the IQ "costs" card said profit was *absent* until costs
  are recorded; it's actually present and wrong (100% margin implied
  real). Copy-only, confirmed no calculation changed anywhere in the diff.
- `1f9c505`, `schema.ts` half — `lineKey`'s unescaped `"|"`-join fixed
  to `JSON.stringify`. Confirmed non-persisted (recomputed on every
  read, never written to DB/cookie) before landing, so no data to
  invalidate.
- `1f9c505`, `schema.test.ts` half — **not** a straight port. Both
  branches had independently written a test file at this exact path
  (an add/add conflict) covering non-overlapping ground. Manually
  merged: union of both, de-duplicated, the "not fixed here" comment
  from this session's earlier pass removed now that the fix is applied,
  the collision regression test added (only valid once the fix exists).

**Rejected as moot:** `2be0e43` (finance.manage) and `83e9b6b` (its own
cleanup) — both fully superseded by `81df18e` earlier this session,
which already implements the same idea and additionally resolved the
ADMIN question `2be0e43` had left open in `PENDING-DECISIONS.md`.

Committed as one commit (`3a84428`, "chore: reconcile safe evolution
improvements") after explicit approval, diff reviewed in full before
committing, secret-scanned. Pushed and deployed. Post-deploy
verification: service active (independently re-checked via
`systemctl show`, not just the deploy script's own claim), 5-route HTTP
smoke test including a correctly-behaving edge case (Razorpay webhook
returns 503 when unconfigured, as designed), BUILD_ID matched exactly
between the local build (from confirmed HEAD `3a84428`) and the deployed
one, journal clean since restart (one `NotSignedIn` log line, confirmed
as expected control flow from the verification's own unauthenticated
smoke-test request, not an error).

`claude/v2-evolution` itself was not merged, deleted, or force-pushed —
it still exists on GitHub, now fully superseded, safe to leave alone or
delete later at the user's call.

559 tests. typecheck, lint, RSC-boundary check all clean.

## First three page specs written: pos.md, kds.md, iq.md

`design-system/pages/` held only a README until now, despite CLAUDE.md
telling every UI agent to check it before starting. Written from source
inspection (component files, `FRYBIRD-COMPONENT-MIGRATION.md`, the
purchased kit's own source where a component was actually adopted or
considered) — no browser tooling this session, so nothing here claims
visual verification; anything that needed it is marked explicitly.

Followed the README's own convention (a page spec overrides Master for
that page only, never restates it) rather than a generic comprehensive
template — every category the request asked for is addressed, but as
"no departure, see Master §X" where Master already covers it, not
padded restatement.

**The one finding worth surfacing on its own:** researching `iq.md`
found that `[data-surface="iq"]` is applied at the top level in
`src/app/(app)/app/layout.tsx`, wrapping every `/app/*` route — POS and
KDS included, not just the IQ dashboard — and fully overrides
`.surface-dark`'s entire token set at equal CSS specificity, later in
the cascade. POS and KDS are very likely rendering in the light IQ
palette instead of their intended dark theme, the same open
dark/light question flagged earlier this session (recommendation #4 in
the original audit) but now understood to be scoped far wider than the
IQ dashboard alone. Not visually confirmed — needs a real browser
before anyone treats it as settled — but the CSS mechanism itself is
unambiguous. Documented in full in all three specs' "Needs visual
verification" sections.

Also found and worth a cheap fix later: three section-nav components
(`CommandCenterNav`, `AnalyticsSectionNav`, `AdminSectionNav`) share
byte-identical markup with no shared component behind them — a real,
low-risk reuse opportunity, not urgent.

No code changed — docs only, no deploy needed. typecheck, lint, 559
tests all still clean (unaffected, as expected).

## POS and KDS dark surface fixed — confirmed by live screenshot first

The theme finding from the specs above was confirmed real: user
screenshots of production showed both `/app/pos` and `/app/kds`
rendering in the light IQ palette.

Root cause traced precisely before touching anything: `(app)/app/
layout.tsx` puts both `data-surface="iq"` and `.surface-dark` on the
same top-level div, for every `/app` route. `globals.css` declares
`[data-surface="iq"]` after `.surface-dark`, redeclaring every custom
property the dark rule sets, at equal specificity — so it wins
everywhere. Git history (`e7fee1f`, "Staff screens stay dark, scoped by
.surface-dark on the (app) layout") confirms this was never the
intent — `.surface-dark` was added specifically to keep POS/KDS dark;
the override just never actually took effect once `data-surface="iq"`
was introduced for the dashboard.

Also checked and deliberately ruled out before implementing: whether
Radix `Portal`-based dialogs (POS's modifier picker uses `Dialog`) would
escape a nested wrapper fix. They do — confirmed `DialogContent` reads
`bg-popover`/`text-popover-foreground` and the portal targets
`document.body` by default, outside any wrapper nested in the route
tree, and neither `<body>` nor `<html>` carry any surface scoping. This
means portaled dialogs across the *whole app*, IQ included, likely
already fall back to `:root`'s customer-site colors — a separate,
pre-existing characteristic, not something this fix was asked to solve
or could solve without a much larger change (moving surface scoping to
`<body>`, which the customer site also sits under). Documented as a
known limitation, not fixed.

Fix (`741150f`): `DarkStaffSurface`, a `contents`-display wrapper
reapplying `.surface-dark`, plus two one-line `layout.tsx` files for
`pos/` and `kds/`. Nothing about the shared layout, its CSS, or any
other `/app` route changes.

typecheck, lint, 559 tests, RSC-boundary check all clean. Deployed.
Service active, all 6 routes checked (pos/kds/iq/admin/finance/home)
respond correctly, journal clean of anything but expected
unauthenticated-smoke-test noise and one standard post-deploy
"Server Action not found" transient (a client with the previous build
still open — normal after any deploy, unrelated to this change).

**Not verified: the actual rendered result.** POS and KDS require staff
auth; there is no session available to this session to load the real
page and see it. The fix is deployed and gate-verified but not visually
confirmed — same as the original finding, this needs a human to look.

## POS reverted to light — the dark fix above was wrong, confirmed by real screenshots

The dark-surface fix was visually confirmed and rejected the same day.
Not just a preference call: the result was genuinely broken.
`.surface-dark` doesn't define `--panel` or `--inverse`, both of which
`order-builder.tsx`'s Dine-in/Takeaway toggle and its own panel wrapper
read — so the fix produced dark page + white panels + near-black
buttons, not one coherent theme. That's the "mixed dark/light surfaces"
and "black-vs-pale inconsistency" in the report.

Checked after the visual evidence, not before this time: the commit
that actually designed POS ("Design phase 2, wave 3… POS touch polish")
describes it in explicit light-surface language — "cream row", "ink"
text throughout. POS was deliberately designed light from a real design
pass; `.surface-dark`'s "look at this screen for a whole shift" comment
described an intent that was written but never executed or checked
against real POS components. The lesson: a plausible code comment plus
a clean CSS explanation is not a substitute for actually looking —
this is the second time in one day that exact mistake almost shipped
uncorrected.

Reverted (`314a9e6`) by deleting `pos/layout.tsx` — POS reads
`[data-surface="iq"]` directly again. `DarkStaffSurface` and
`kds/layout.tsx` untouched: KDS is a genuinely separate question (no
equivalent "designed light on purpose" commit found for it, and its own
component research found no dependence on `--panel`/`--inverse`, so the
specific failure mode that broke POS may not apply there) — evaluate it
independently, on its own visual evidence, not by assuming it should
match either outcome. Both page specs (`pos.md`, `kds.md`) updated to
record this rather than keep describing a now-tested-and-wrong theory.

The Dine-in/Takeaway toggle itself was not changed — its ink/inverse
styling is deliberate and resolves to high-contrast pairs under full,
consistent light tokens; the reported inconsistency is expected to
disappear as a consequence of this revert.

typecheck, lint, 559 tests, RSC-boundary check all clean. Deployed,
service active, both routes respond correctly, journal clean. Visual
result still not independently confirmable from this session (no
browser tooling, no staff session) — awaiting the user's look, same
constraint as before.

## KDS given the same light surface as POS — and a correction to this file's own earlier claim

Decided directly this time, not re-diagnosed from a second screenshot:
KDS follows POS's light direction rather than `.surface-dark`.

Before implementing, read `kds-board.tsx` in full rather than trust the
earlier summary in `design-system/pages/kds.md`, which had claimed KDS
didn't depend on `--panel` the way POS's toggle did. That claim was
**wrong** — line 171 reads `bg-panel` directly on the ticket card. KDS
carried the identical latent bug as POS (`.surface-dark` never defines
`--panel`, so a dark reapplication would produce white cards on a dark
page); it simply hadn't been shipped and screenshotted yet to catch it.
Worth recording plainly: that earlier claim came from an incomplete
grep, not a full read, of the file it was describing.

Verified what full, consistent `[data-surface="iq"]` tokens actually
produce for KDS's existing markup, with no component changes needed:
white columns on the light page background, white ticket cards
differentiated by a 2px border (a distinct orange-red when late, not
brand ember), the late pill on the same distinct orange-red
(`--destructive`), the advance button on brand ember red
(`--primary`) — reserved for the one primary action, exactly matching
"strong FRYBIRD red for primary actions, restrained elsewhere."

Fixed (`1fb41e3`): `kds/layout.tsx` deleted, mirroring the POS revert.
`DarkStaffSurface` deleted too — confirmed zero remaining callers once
neither POS nor KDS used it.

typecheck, lint, 559 tests, RSC-boundary check all clean. Deployed;
service active, all six checked routes (KDS, POS, IQ, Admin, Finance,
Orders) respond correctly, journal clean of anything but expected
smoke-test noise. Visual result still not independently confirmable —
no browser tooling, no staff session, same limitation as every theme
change this session. Implemented from source and token math, disclosed
rather than assumed.

## Multi-lane autonomous build begins — Lane B / Rewards merged first

Approved 4-lane plan (Lane A: Phase 3 inventory, B: Phase 8 design, C:
Phase 5.4/5.5, D: Phase 6.1/6.2) launched as isolated worktree agents.
Phase 8's "IQ dark theme" line item dropped per explicit instruction —
POS/KDS stay light, not reopening that decision. kit-ui-batch confirmed
to have zero unique commits against kit-radix-nova (strict ancestor,
`0` ahead) — no keep/drop table needed, nothing to approve.

**Process finding, corrected before it caused damage:** all 5 worktrees
branched from `main` (`0b35f82`, 17+ commits behind kit-radix-nova),
not from kit-radix-nova as intended — the isolation tool's default,
which the dispatch prompts didn't override. Checked every lane's
assigned files against the full divergence diff (120 files) before
proceeding: only two real conflicts exist — Lane D's `permissions.ts`
edit (predates finance.manage/promotions.manage) and Lane B's Expenses
files (predate the same). Everything else, including Rewards, touches
files untouched by the divergence and applies cleanly.

**Lane B — Rewards (`3896625`), merged and deployed.** Diff read in
full by the integrator directly rather than dispatching three more
subagents for a 2-file presentation-only change — permission check
confirmed unchanged (denial UX improved: PermissionDenied instead of a
silent redirect), zero money logic touched, "use client" directive
confirmed intact. typecheck/lint/559 tests/RSC-boundary/contrast all
clean. Deployed; service active, routes respond correctly, journal
clean. Visual result not independently verifiable this session (no
browser tooling) — implemented from source/tokens, disclosed as such.

## Lane B — Deliveries + Expenses (`adf9f5f`), with one real catch

Same stale-base reconciliation as Rewards, but this one had a genuine
find: the lane's `iq/expenses/page.tsx` rewrite would have been a
**regression**, not an improvement — its stale base predated the
"Batch slice 2/4" work that already gave this exact page
AnalyticsSectionNav, PeriodSwitch, four KpiTiles, a DataTrust line, a
by-category BarList, and the shared Table component, none of which
exist in the lane's version, which also still checked the pre-fix
`finance.view`. Caught by diffing file-by-file against current
kit-radix-nova before applying anything, not by trusting the lane's
own "old style" framing (confirmed via ROADMAP.md's own marker, a
hand-rolled `text-3xl` h1 — this file no longer has one, the lane's
research target was already stale for this one specific file even
though it was still accurate for the other five).

**Merged:** deliveries/page.tsx, expenses/new/page.tsx (finance.manage
preserved, confirmed), expense-form.tsx, delivery-card.tsx,
delivery-panel.tsx — reviewed directly, all five genuine improvements,
no functionality removed, amount-field submission behaviour (name,
inputMode, required) confirmed unchanged.

**Rejected, not merged:** iq/expenses/page.tsx — left exactly as it
was; the smallest correct change here was no change.

typecheck, lint (0 errors — 3 warnings observed were from Lane D's
in-progress worktree bleeding into the scan, since `.claude/worktrees/`
sits inside the repo tree; not part of this change), 559 tests
(unchanged), RSC-boundary, contrast all clean. Deployed; service
active, all three touched routes respond correctly, journal clean.

## Lane A — Roadmap 3.1, recipe line editor (`72ad089`)

Clean base (none of its 6 files touched by the divergence), applied
without conflict. Extends `product-recipe-section.tsx`, which was
already waiting for exactly this per its own prior comment. A save
always writes a new `recipe_versions` row, never patches an existing
one's items — the same immutable-snapshot discipline §51 requires for
order lines, for the same reason (a later sale's consumption movement
must never have its cost rewritten by a subsequent recipe edit).

Reviewed directly, not delegated to three more subagents given the
depth already required to understand it: org-scoping verified on both
the product and every ingredient id (`CrossOrgReference` otherwise),
atomic transaction, `recipes.edit` re-checked server-side independent
of the client's `access` prop, recipe data only fetched at all when
the viewer holds `recipes.view` (no query, nothing to leak, for a role
that can't see it). Cost math is entirely the existing
`costFromRate`/`productCost`/`scale` plus one new pure, tested function
(`theoreticalRecipeCost`) — no reimplementation. Client-side live cost
preview uses the same pure function, labelled "estimated, unsaved";
what's persisted and later shown always comes from a fresh server read.
Checked the one real precedent question before trusting it: bigint
`Paise`/`MilliPaise` crossing the Server→Client boundary already
matches `ProductPriceForm`'s existing, live `basePrice: Paise` prop —
confirmed, not a new pattern. `getRecipeStatus` removed as dead code,
confirmed via grep to have zero remaining callers after this change,
not assumed.

typecheck, lint, 563 tests (559 + 4 new), RSC-boundary all clean.
Deployed; service active, route responds correctly, journal clean of
anything but the known deploy-transition "Server Action not found"
artifact. **Roadmap 3.1's own "Done when" criterion — Nashville Burger
has a recipe with 6+ lines and a theoretical cost — is not yet
verified**: the UI to do this now exists at `/app/iq/menu/products/
<id>`, but populating a real recipe needs a human with a staff session,
which this integrator doesn't have. Route health confirmed; the actual
criterion is still open.

## Lane C — Roadmap 5.4 CSV exports + 5.5 restaurant settings (`ab77ed3`, `8085a33`)

Stale base: 3 of 32 files conflicted with kit-radix-nova's own
movement since the lane's worktree branched. 26 files applied clean
via one batched `git apply`.

**Resolved by hand, not blind merge:**
- `checkout/page.tsx` — kept the live `requireOrg()` +
  `listSavedAddresses(org.id, customer.id)` org-scoping fix (shipped
  earlier this session), layered the lane's `availableMethods({cash,
  online})` toggle read on top. Both fixes now coexist.
- `admin/restaurant/page.tsx` — the lane's base predated kit-radix-nova's
  own "Batch slice 3/4" modernization (Panel/PanelHeader/DataTrust,
  replacing the older Section layout). Same shape of problem as the
  Deliveries+Expenses lane's near-regression, different resolution:
  this time the lane's new content (BusinessProfileForm,
  LocationProfileForm, PaymentSettingsForm) was genuinely additive, so
  it was grafted onto the current, more-modernized structure rather
  than rejected.
- `nav-items.ts` — added the Exports nav item's `canSeeExports`
  plumbing (icon import, `NavPermissions` field, destructuring, the
  Finance group's ternary→array-spread) without disturbing the
  Alerts/AI brief/Order history items added to this file since the
  lane's base.

**Migration bug found and fixed post-hoc:** the lane's
`0028_restaurant_settings_cod_hours_payment_toggles.sql` was never
registered in `meta/_journal.json` — `drizzle-kit migrate` reads the
journal to know which files to run, so the first `pnpm db:migrate`
reported "applied successfully" while doing nothing at all. Caught by
verifying the new `organizations` columns directly in production
afterward rather than trusting the CLI's exit status. Root cause
confirmed against precedent: migration 0027 (already live, committed
in `688cb85`) has the same gap — a journal entry with no snapshot
file — and still applies correctly, proving `migrate` only needs the
journal entry, not a snapshot, to run hand-written SQL. Fixed by adding
the missing idx-28 journal entry in the same format as every prior
entry (`8085a33`), then re-running the migration.

Production backup taken before any of this: `frybird-20260915-1451.dump`
(61 tables, 312K). Migration re-verified live after the journal fix:
`cod_cap=150000, cash_enabled=true, online_enabled=true,
opening_time=11:30, closing_time=23:00` — exactly the current
hardcoded behavior, so applying it changed nothing observable until a
form is used. Migration id 29 now recorded in
`drizzle.__drizzle_migrations`.

typecheck, lint, 577 tests (563 + 14 new: CSV encoder, money's new
`toPlainDecimal`, payments toggle behavior, SEO), RSC-boundary all
clean. Deployed; service active. Verified live: `/app/reports` → 307
(sign-in redirect, not 500), `/app/admin/restaurant` → 307,
`/checkout` → 307, `/api/reports/export` → 403 unauthenticated (not
500). journalctl clean of anything but the known deploy-transition
"Server Action not found" artifact and `NotSignedIn` from these
unauthenticated smoke checks themselves. **Roadmap 5.4/5.5's "Done
when" criteria are not yet verified with a real staff session** — the
export download and the settings forms' actual save behavior need a
human to click through; route/permission health is confirmed, the
functional criteria are still open.

## Lane D — Roadmap 6: CASHIER kitchen.update, roles matrix (6.2), staff invites (6.1) (`1e52e37`)

Stale base: 4 of 16 files on the divergence list, but only one
(`nav-items.ts`) actually needed hand reconciliation — the other three
(`section-breadcrumb.tsx`, `domain.test.ts`, `permissions.ts`) applied
clean because their real changes sat in regions kit-radix-nova hadn't
touched.

CASHIER gets `kitchen.update` — owner-approved (roadmap 6): a
one-person counter is also the kitchen at slow hours, and withholding
it forced a second login for a step one person was already doing.
Nothing else opens up; recipes stay out of reach.

Roles matrix (6.2) renders `permissionsFor()` straight from
`domain/permissions.ts` so the page can never drift from what the
server enforces. One real gap from the stale base: its
`PERMISSION_INFO` is an exhaustive `Record<Permission, ...>`, so it
failed to typecheck against `finance.manage` and `promotions.manage` —
both added earlier this session, after the lane's base. Added their
entries (Reporting, Customers — matching `finance.view`'s and
`customers.*`'s existing groups).

Staff invites (6.1): `inviteStaff`/`deactivateStaff`/`changeStaffRole`
in `lib/repositories/staff.ts`, all org-scoped, atomic, audit-logged,
gated on `staff.manage` server-side and a new `canGrantRole` ceiling
in `domain/permissions.ts` — an actor can never grant, or act on an
account holding, a role that holds a permission the actor's own roles
don't. `inviteStaff` calls Supabase's Admin API
(`auth.admin.inviteUserByEmail`) from `server-only` code the client
never reaches.

**Surfaced as a decision, not decided unilaterally:** `canGrantRole`
has a real consequence — since MANAGER holds `finance.view`
(OWNER+MANAGER only, decided earlier this session) and ADMIN doesn't,
an ADMIN cannot invite, deactivate, or change the role of a MANAGER
account. The lane's own agent flagged this as "worth a second look."
Asked via `AskUserQuestion`; decided 2026-09-15: **keep as-is** —
consistent with the `finance.view` boundary, and the alternative (a
rank-based ceiling letting ADMIN outrank MANAGER structurally) would
let ADMIN hand out money access it doesn't itself hold.

`nav-items.ts` conflict: added the Roles nav item (`ShieldQuestion`
icon, `exclude: ["/app/staff/roles"]` on the Staff item) without
disturbing the Exports item Lane C had just added to the same file.

typecheck, lint, 585 tests (577 + 8 new: `canGrantRole`'s six cases,
CASHIER's `kitchen.update`), RSC-boundary all clean. Deployed; service
active. Verified live: `/app/staff/roles` → 307 (sign-in redirect),
`/app/staff` → 307, `/accept-invite` → 200 (public route), and the
updated sign-in copy ("Accounts are set up by an owner or admin, from
Staff") confirmed live. journalctl clean of anything but the known
deploy-transition artifact and `NotSignedIn` from these unauthenticated
smoke checks. **Roadmap 6.1/6.2's "Done when" criteria are not yet
verified with a real invite sent and accepted** — route/permission
health is confirmed, the actual invite-to-accept flow needs a human
with a real inbox.

All four lanes of the multi-lane build are now merged, gated, deployed
and verified at the route level: Rewards (`3896625`), Deliveries +
Expenses (`adf9f5f`), Lane A recipe editor (`72ad089`), Lane C exports
+ settings (`ab77ed3`, `8085a33`), Lane D roles + invites (`1e52e37`).
kit-ui-batch remained untouched throughout — zero commits unique to
it, confirmed at the start of this phase, never revisited.

## Next wave dispatched — Lane A 3.2, Lane B design-completion (Modifiers merged, Categories+Combos pending, Media+Product-new merged)

Continuing automatically per standing authorization: 4 worker agents
dispatched for Roadmap 3.2 (stock movements, next in Lane A's strict
dependency chain) and three Phase 8 design-completion groups
(Categories+Combos, Modifiers, Media+Review+Product-new). Skipped
Phase 8's "POS payment sheet and rewards keypad" item deliberately —
it touches POS, which stays off-limits without explicit sign-off.

**Worktree-base bug recurred, this time mid-flight.** All 4 agents
correctly re-verified their base before writing anything (per this
session's own standing instruction, after the earlier batch's silent
failure) and caught it. Three genuinely branched from stale `main`,
exactly as before. The fourth (Categories+Combos) hit a worse variant:
its worktree was reprovisioned by the harness while paused, and the
replacement it was handed turned out to be the *live, still-running*
Lane A stock-movements worktree — a second agent process briefly
sharing one working directory. It behaved correctly regardless:
committed only its own 3 owned files, left Lane A's uncommitted WIP
(`units.ts`, `inventory.ts`) untouched, and flagged the collision
explicitly rather than guessing. No data was lost. One other agent
(Media+Review+Product-new), finding itself in the shared main checkout
with no isolated worktree at all, correctly avoided committing onto
the shared `kit-radix-nova` branch directly — cut its own branch
first. Modifiers did the same, as a fresh worktree off `kit-radix-nova`
explicitly. All defensive; nothing destructive happened anywhere.

Cleanup performed: restored the main checkout from the stray branch it
had been left on back to `kit-radix-nova`; deleted 3 orphaned
zero-commit branches left over from the reprovisioning (identical to
stale `main`, no unique work, no attached worktree). Categories+Combos
remains uncommitted-to-integration until Lane A's shared worktree
finishes — its commit (`9460400`) sits cleanly on top of Lane A's
branch and will be cherry-picked out separately once that lane lands,
since the two touch disjoint files.

**Modifiers merged** (`e7c753a`, fast-forward — branched from the
exact current tip, zero staleness): `modifiers/page.tsx`,
`modifiers/[id]/page.tsx`, `modifiers/new/page.tsx` onto Panel/
PanelHeader/PanelBody/Badge. Deliberately left `modifier-group-form.tsx`
and `modifier-list.tsx` untouched — diffed line-by-line against the
already-modernized `product-price-form.tsx`/`product-modifiers-form.tsx`
and found them already byte-identical in convention; touching them
would have been pure churn.

**Media + Product-new merged** (`92fdcef`, ordinary merge — one commit
of staleness, zero file overlap with Modifiers): `media-library.tsx`,
`product-create-form.tsx`, one-line cleanup in `products/new/page.tsx`.
`review/page.tsx` and `media/page.tsx` themselves were found already
fully modernized from earlier "Batch slice 1/4" work and correctly left
untouched — the actual staleness was one layer down, in the components
those routes render. One real bug fixed in scope: the per-photo delete
button in the media library was hover-only
(`opacity-0`/`group-hover:opacity-100`), which MASTER.md §7 explicitly
forbids for a touchscreen/mobile staff surface — now always visible
with a focus-visible ring.

typecheck, lint, 585 tests (unchanged — both passes were layout-only,
no logic touched), RSC-boundary, contrast all clean. Deployed; service
active. Verified live: `/app/iq/menu/modifiers` → 307,
`/app/iq/menu/media` → 307, `/app/iq/menu/products/new` → 307, all
sign-in redirects rather than 500s. journalctl clean of anything but
the known deploy-transition artifact. No browser/visual verification
was possible in this environment for either merge — noted explicitly
by both agents and by this integrator; the actual rendering on
frybirdiq.tech is still owed per CLAUDE.md's verification rule.

Still open: Categories+Combos (pending Lane A), Lane A 3.2 itself
(stock movements, in progress).

## Lane A 3.2 (stock movements) + Categories+Combos separated and merged (`494aede`, `680e779`, `98f19b0`)

Lane A's worktree finished with two unrelated commits stacked on it —
its own 3.2 work, on top of the Categories+Combos commit from the
mid-flight worktree collision described above. Extracted both as
patches and applied them separately onto kit-radix-nova's own tip,
each reviewed and gated independently, rather than merging the branch
as one unit.

**Categories+Combos** (`494aede`): same modernization pattern as the
rest of this wave — `categories/[id]`, `categories/new`, `combos/[id]`
onto Panel/PanelHeader/PanelBody. No functional changes.

**Lane A 3.2 — stock movements** (`680e779`): `receiveStock`,
`adjustStock`, `countStock`, `listMovements` in a new
`src/lib/repositories/stock.ts`. Every write is one transaction — a
movement insert plus an atomic `onConflictDoUpdate` increment on
`inventory_items.quantity_on_hand` (the same upsert pattern
`payments.ts` uses for the loyalty ledger) — so the cached on-hand
figure and the movement ledger can never diverge. Count computes
`delta = counted − on-hand` inside the transaction and writes one
ADJUSTMENT for exactly that delta, matching the roadmap's own example
(9.4 kg counted against 10 kg on hand writes −0.6 kg); a count that
matches on-hand exactly writes nothing. Extracted
`recordIngredientPriceInTx` from the existing `recordIngredientPrice`
(pure mechanical split, public API unchanged) so receiving stock
records the supplier price and the PURCHASE movement in one shared
transaction. Added `toBaseUnitsDecimal` to `units.ts` — bigint-exact
decimal conversion for a scale reading, kept deliberately separate
from the existing `toBaseUnits`, which still refuses fractional
purchase quantities on purpose (a fractional purchase line is almost
always a typo). No schema changes — the movements/items tables and
their idempotency guard already existed from an earlier migration.

Judgment calls made and documented rather than decided silently: all
three writes gated on `inventory.adjust` per the roadmap table's
literal wording (the architecture doc's write-path table assigns
receiving to `purchasing.manage` instead — no behavioural difference
today, every role holding one holds both); ADJUSTMENT movements valued
at the ingredient's current usable rate (the architecture doc only
specifies this explicitly for WASTE); no row lock on a count's
on-hand read (no precedent for `SELECT...FOR UPDATE` anywhere in this
codebase — low risk for a single-terminal shop, flagged for revisit
before multi-terminal).

**Real bug caught by the deploy gate, not by typecheck/lint/test**
(`98f19b0`): the first version exported the local `explain()` error-
formatting helper from `inventory/actions.ts` so the new
`stock-actions.ts` could reuse it. `pnpm typecheck && pnpm lint && pnpm
test` all passed clean — but `next build` itself refused it: every
export from a `"use server"` file must be an async function, and
`explain()` is synchronous. Every other actions file in this codebase
(`staff-actions.ts`, `table-actions.ts`, `menu-admin/actions.ts`)
already solves this the same way — a small private `explain()` local
to that file rather than a shared import. Matched that convention:
reverted the export, gave `stock-actions.ts` its own identical local
copy. This is exactly why the deploy script's own `next build` gate
runs even after local checks pass clean.

typecheck, lint, 592 tests (585 + 7 new: `toBaseUnitsDecimal`, including
the roadmap's own worked example), RSC-boundary, and (after the fix)
`next build` all clean. Deployed; service active. Verified live:
`/app/inventory` → 307 (sign-in redirect, not 500). journalctl clean
of anything but the known deploy-transition artifact. **Roadmap 3.2's
own "Done when" criterion is not yet verified with real data** — the
UI to receive 10 kg and count 9.4 kg now exists, but exercising it
needs a human with a staff session; route health is confirmed, the
actual criterion is still open (same caveat as 3.1).

All 6 pieces of this wave are now closed: Lane A 3.2, and Phase 8's
Categories+Combos, Modifiers, Media+Review+Product-new. Worktrees for
this wave fully cleaned up.

## Lane A 3.3 (waste log) + order-card/new-order-alert merged (`b942374`, `5b44c64`)

Continuing automatically. Dispatched two more agents: Lane A 3.3
(waste log, next in the dependency chain) and Phase 8's order-card +
new-order-alert modernization — the last two real items on Phase 8's
list. **Phase 8's "old `overview-kpis`" item is stale and needs no
work**: that file (`iq/overview-kpis.tsx`) was already removed as
dead code during an earlier "Command Center" redesign this session,
confirmed via this log's own entry for that slice. ROADMAP.md's Phase
8 line still names it; worth trimming next time that file is touched,
not urgent enough to interrupt this wave for.

**Worktree-base bug recurred a third time, on both agents — same
pattern as the prior wave**, self-caught and self-corrected in both
cases with zero data loss. One real new wrinkle: the order-card agent
found its worktree auto-cleaned by the harness (documented behavior
for a worktree with no changes) and, rather than force-reset the
primary checkout it had been dropped into — which for once was *not*
idle, another lane's live uncommitted work was sitting there — created
a brand new isolated worktree of its own off `kit-radix-nova` and did
the work there instead. Good judgment: the primary checkout was never
touched. Sent feedback about the recurring root cause (the Agent
tool's worktree isolation has no way to pin a base branch, always
defaults to stale `main`) rather than continuing to patch it lane by
lane.

**Lane A 3.3 — waste log** (`b942374`): `recordWaste` added to
`stock.ts` alongside 3.2's three functions, same transaction
discipline (WASTE movement + `waste_entries` row linked via
`movementId` + the atomic on-hand decrement, one transaction). Valued
at the ingredient's current usable rate, same convention as
`adjustStock`. A real permission-boundary problem correctly caught and
solved: KITCHEN holds `inventory.waste` but not `inventory.view`, so
the existing ingredient detail page (which gates its entire render on
`inventory.view`) could never be where KITCHEN records waste — built a
dedicated `/app/inventory/waste` page instead, gated only on
`inventory.waste`, with its own minimal ingredient picker
(`listIngredientOptions`, deliberately not reusing the costed
`listIngredients`, so KITCHEN never sees a price anywhere in the
flow). Flagged and left undone on purpose: no link into this page from
KDS chrome — that's protected territory this session, left for a
separate, explicit decision. `explain()` correctly kept as a small
private per-file helper this time, not exported — the exact bug class
`98f19b0` fixed one commit up the history, avoided here from the
start.

**order-card + new-order-alert** (`5b44c64`): brought both onto the
current design vocabulary. `order-card.tsx` now uses the same 5-way
order-status tint system (dot + tinted pill) `orders-board.tsx` already
uses for the same order's row — for the first time, a row's status
color and its detail-sheet color are the same system, not two
different approximations of it. Every raw button became the shared
`Button` component. Deliberately much more conservative on
`new-order-alert.tsx` — this is the live, real-money order interrupt —
limited to token corrections only (`bg-[var(--destructive)]` →
`bg-destructive`, etc., verified zero visual difference by checking
the actual token values) with the poll/realtime logic, sound-cadence
timers, focus management, and every `aria-*`/`role` attribute
untouched.

typecheck, lint, 592 tests (unchanged — both passes were layout-only),
RSC-boundary, contrast, and `next build` all clean on both merges (one
lint run was briefly polluted by a stray `.next` directory left behind
in a sibling worktree by an agent's own verification build —
identified, the directory removed, re-verified clean; not a code
problem). Both deployed; service active. Verified live:
`/app/inventory/waste` → 307, `/app/orders` → 307. journalctl clean of
anything but the known deploy-transition artifact.

This closes out both dispatched lanes for Phase 3 slice 3.3 and the
last real Phase 8 item. Remaining Phase 8 work (POS payment sheet and
rewards keypad) stays deliberately untouched — it's inside POS, off
limits without explicit authorization. Worktrees for this round fully
cleaned up.
