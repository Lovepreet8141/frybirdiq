# FRYBIRD IQ — Autonomous Build Progress

Running log of the QSR-Operating-System build-out, kept so the whole
progression can be reviewed at once rather than reconstructed from chat
history. Newest slice first. Nothing in this log has been committed, pushed
or deployed unless the entry says so explicitly.

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
clean, `pnpm test` 340/340 passing (23 files), `pnpm build` succeeds (49
routes — the three inventory routes are new), `scripts/check-rsc-boundaries.sh`
clean.

## Deployment record

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
