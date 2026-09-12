# FRYBIRD IQ — Autonomous Build Progress

Running log of the QSR-Operating-System build-out, kept so the whole
progression can be reviewed at once rather than reconstructed from chat
history. Newest slice first. Nothing in this log has been committed, pushed
or deployed unless the entry says so explicitly.

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
clean, `pnpm test` 332/332 passing, `pnpm build` succeeds (38 routes),
`scripts/check-rsc-boundaries.sh` clean.

## Deployment record

Deployed 2026-09-12 via `./deploy/deploy.sh root@194.238.16.200`, from
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
`INSERT`/`UPDATE`), the permissions vocabulary in `src/domain/permissions.ts`
(four existing permissions — `customers.view`, `staff.manage`, `audit.view`,
and, if the next slice proceeds, `analytics.view` — were read via
`staffCan()`; none added, none weakened), the database schema, and every
server action's actual behavior.

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
- **Phase G — KDS.** No station/routing concept exists anywhere in schema
  or domain layer. The directive is explicit: stop before inventing that
  schema.
- **Phase H — Staff/Access beyond the read-only list already shipped.**
  Roles, shifts, invitations all need new schema — still gated.

**Recommended next safe slice:** a **Finance/Payments view** — real
`payments` and `refunds` tables already exist and are fully written today
(cash capture, the idempotent settlement path); there is no repository read
function over them yet for staff to see recent payments/refunds outside of
what's embedded in the order detail. No schema change, no payment-processing
change (read-only), and it's an explicit top-level roadmap area (`FINANCE >
Sales, Payments, Refunds`) with zero UI today. Likely gated on `analytics.view`
(no dedicated finance permission exists yet — worth flagging rather than
silently deciding, since the directive is explicit about not reusing an
unrelated permission; `analytics.view` is a defensible fit since this is
fundamentally a reporting view of transaction data, the same justification
`/app/iq`'s own revenue figures already rest on, but it is a judgment call
worth surfacing, not a certainty).
