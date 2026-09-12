# FRYBIRD IQ — Autonomous Build Progress

Running log of the QSR-Operating-System build-out, kept so the whole
progression can be reviewed at once rather than reconstructed from chat
history. Newest slice first. Nothing in this log has been committed, pushed
or deployed unless the entry says so explicitly.

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
clean, `pnpm test` 340/340 passing (23 files), `pnpm build` succeeds (45
routes), `scripts/check-rsc-boundaries.sh` clean.

## Deployment record

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

**Recommended next safe slice — filters that match the IA:** two small
read-only refinements, both client-side over data already fetched: (1)
**Customers › Segments** — pills on the customer list for *ordered in the
last 30 days / not in 30+ days / never ordered / 5+ orders*, computed from
the `lastOrderAt` and `orderCount` the list already carries (the
directive's Segments item, honestly scoped to facts); (2) **Orders ›
channel filter** — dine-in / takeaway / website pills beside the status
pills, which is the roadmap's "Online Orders" as a view rather than a
separate screen. Zero schema, zero new queries. Previously queued and now
shipped: the **integration slice**, **Admin › Restaurant** and the
**Channels analytics view** —
revenue / orders / AOV split by DINE_IN / TAKEAWAY / ONLINE over a chosen
range. `orders.channel` is already indexed with `placedAt` for exactly this
question (`orders_channel_placed_idx`), it reuses `analytics.ts`'s existing
`paidOrders()` revenue definition unchanged, it's gated on the existing
`analytics.view`, needs zero schema, and `FRYBIRD-ADMIN-ARCHITECTURE.md`
already flags channel performance as "revisit if it becomes a real need."
