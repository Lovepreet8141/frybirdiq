# FRYBIRD Reference Catalog

Source: `shadcn-ui-kit-dashboard-main` (Next.js 16, Tailwind v4, Radix, TanStack Table v9-legacy, recharts, zustand, dnd-kit), 843 files across ~24 demo modules under `app/dashboard/(auth)/`.

**Method.** I read the kit's actual source — page composition, state management, data shape — not just file names. Where I say REUSE, the file is Radix-free and drops in with an import-path change. Where I say ADAPT, the layout/interaction is worth keeping but the state and data must be rebuilt against FRYBIRD's real repositories. Where I say REJECT, I read enough to be sure it doesn't transfer, not that the topic sounded irrelevant.

**The one fact that shapes this whole catalog:** the kit is a **UI demo**. Every module's "backend" is an in-memory Zustand store or a bundled `.json` file, computing invented numbers with no tax logic, no idempotency, no audit trail. FRYBIRD's own code is frequently *already more correct* than the reference it's being compared against — this catalog says so plainly where that's true, rather than recommending a downgrade for the sake of reuse.

---

## 1. Application shell

| Feature | Reference location | What it does | Why useful | Verdict | FRYBIRD destination | Dependencies | Conflicts |
|---|---|---|---|---|---|---|---|
| Collapsible sidebar shell | `components/layout/sidebar/*` | Icon-rail + expandable sidebar, active-route highlighting, grouped nav sections | FRYBIRD's current staff header (`src/app/(app)/app/layout.tsx`) is a single-row nav that already strains at 5 items (Orders/POS/Deliveries/Menu/IQ) plus IQ's own 4 sub-tabs. A 20+ item nav (this request's own proposed IA) cannot live in a header row. | **ADAPT** | New `src/components/staff/app-sidebar.tsx`, replacing the header nav for the admin surface only (POS/KDS stay full-bleed, no sidebar — touch/speed screens) | none beyond what's already installed | Must rebuild on `AppNavLink`'s existing permission-gating (`staffCan`), not the kit's static array |
| Command menu (⌘K search) | not present as a standalone primitive — kit uses per-page search inputs, no global command palette found | — | A fast "jump to a product / order / customer" palette is genuinely useful once the nav has 20+ destinations | **REJECT** (not in the kit) | If wanted later, build with `components/ui/command.tsx` (shadcn base-nova has one) + real search against `menu`/`orders`/`customers` repos | `shadcn add command` | none — greenfield |
| Header: notifications dropdown | `components/layout/header/notifications.tsx` | Bell icon, dropdown list of fake notification items | FRYBIRD already has `NewOrderAlert` (`src/components/staff/new-order-alert.tsx`), which is a real-time, sound-backed incoming-order dialog — a strictly stronger pattern for what actually matters operationally (a new order, not a generic notification feed) | **REJECT** | n/a — keep `NewOrderAlert` | — | Do not build a second, weaker notification system |
| Header: profile menu | `components/layout/header/*` | Avatar + dropdown (settings, logout) | FRYBIRD's header already shows staff name/role and a direct sign-out button — simpler and correct for a counter screen where nobody wants a two-click sign-out | **REJECT** | n/a | — | — |
| Theme customizer (dark mode, layout density, radius) | `components/theme-customizer/*` | Runtime theme switcher panel | FRYBIRD IQ is explicitly light-only, no dark mode (`design-system/accessibility.md`, `MASTER.md` §9) and tokens are locked, not user-configurable | **REJECT** | n/a | — | Would violate the locked design-token rule |
| `components/ui/table.tsx`, `chart.tsx`, `avatar.tsx`, `tooltip.tsx`, `progress.tsx`, `dropdown-menu.tsx` | `components/ui/*` | Base shadcn primitives | **Already added this session** via `shadcn add` (pulls the Base UI–backed base-nova version, not the kit's Radix one) — confirmed zero Radix packages entered the dependency tree | **REUSE** (done) | `src/components/ui/*` | none new | — |
| `components/ui/command.tsx` | `components/ui/command.tsx` | Command-palette primitive (cmdk-based) | Needed only if the command-menu idea above is greenlit | **REUSE** (via `shadcn add command`, on demand) | `src/components/ui/command.tsx` | cmdk | — |
| `components/ui/sheet.tsx`, `dialog.tsx`, `separator.tsx`, `badge.tsx`, `button.tsx`, `card.tsx`, `input.tsx`, `label.tsx`, `skeleton.tsx`, `tabs.tsx` | `components/ui/*` | Core primitives | **FRYBIRD already has all of these**, Base UI–backed, house convention (`cn` from `"cn"`, `data-slot`, cva variants) | **REJECT** (redundant) | n/a | — | Do not re-add; FRYBIRD's versions are the same lineage and already correct |
| `components/ui/empty.tsx` | `components/ui/empty.tsx` | Generic "nothing here" placeholder | FRYBIRD already has a stronger, voice-correct equivalent: `src/components/states/index.tsx`'s `EmptyState` (matches `content.md`'s "say what would be here and how to get it", not a generic placeholder) | **REJECT** | n/a | — | — |
| `components/ui/form.tsx` | `components/ui/form.tsx` | react-hook-form + Zod wrapper components | FRYBIRD already uses `react-hook-form` directly in its real forms (menu admin, expense form) without this wrapper layer; introducing it now would be a second form convention | **REJECT** | n/a | — | Two form conventions in one repo |
| `components/ui/breadcrumb.tsx`, `pagination.tsx`, `kbd.tsx`, `item.tsx`, `input-group.tsx`, `native-select.tsx`, `combobox.tsx`, `resizable.tsx`, `menubar.tsx`, `navigation-menu.tsx`, `timeline.tsx` | `components/ui/*` | Assorted primitives | Genuinely useful only when a concrete screen needs them (a paginated table, a keyboard-shortcut hint, an order timeline) | **REUSE, on demand, one at a time** (via `shadcn add <name>`) | `src/components/ui/*` as needed | none | Do not batch-import all of these now — only pull one when a real screen is being built against it (§18 performance / §5 "don't import hundreds of files") |
| `components/ui/kanban.tsx` | `components/ui/kanban.tsx` | Drag-and-drop board (columns × cards) | Strong candidate for a future KDS ticket board (station columns × ticket cards) — see §4 | **REWRITE** | `src/components/kds/ticket-board.tsx` (future, KDS phase) | `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (new, reasonable deps) | **Hard-imports `@radix-ui/react-slot` directly** — cannot be added as-is without installing Radix. Must be rewritten against Base UI's `useRender` (the same pattern already used in `src/components/ui/badge.tsx`) before it enters this repo. |
| `components/ui/calendar.tsx` + `app/dashboard/(auth)/apps/calendar/*` | `components/ui/calendar.tsx`, `apps/calendar/components/event-calendar*.tsx` | Full event calendar with drag-to-reschedule | Candidate for a future staff shift roster | **REJECT for now** | Future Staff/Shifts phase | `@dnd-kit/*` | Same Radix-in-`calendar.tsx` question needs checking before that phase; not evaluated further now since Staff/Shifts is not in scope this pass |

---

## 2. POS (`app/dashboard/(auth)/apps/pos-system/`)

**Read in full: `store.ts`, `page.tsx`, `enums.tsx`, `pos-system-menu.tsx`, `add-product-dialog.tsx`, `tables/components/table-detail-dialog.tsx`.**

The headline finding: **FRYBIRD's own POS (`src/components/pos/*`, `src/app/(app)/app/pos/page.tsx`) is already materially more advanced than the kit's.** The kit's `store.ts` is a client-only Zustand store — no server call anywhere, a hardcoded flat `tax = subtotal * 0.05` (not GST, not real), and `createOrder`/`assignOrderToTable` just mutate local state. FRYBIRD's `pos-shell.tsx` already does live server-side repricing through the real pricing/tax engine (`priceDraftOrder`), debounced reprice-on-change, a 25s menu poll so a price change or 86 from the Menu Manager reaches the counter without a reload, offline detection with a real disabled state and reason, stale-deployment recovery, and integrates the real `ModifierPicker`/`CustomerLookup`. This is not close — do not let "the reference is the quality baseline" (§16 of the request) apply to POS business logic. It applies to POS *table-management UI*, which FRYBIRD does not have yet.

| Feature | Reference location | What it does | Why useful | Verdict | FRYBIRD destination | Dependencies | Conflicts |
|---|---|---|---|---|---|---|---|
| Product grid, category rail, cart, order builder, modifier flow | `pos-system-menu.tsx`, `cart.tsx`, `cart-sheet.tsx`, `cart-list-item.tsx`, `product-list-item.tsx`, `product-category-list-item.tsx` | The full ordering flow | FRYBIRD already has a stronger version of every one of these (`category-rail.tsx`, `product-grid.tsx`, `order-builder.tsx`, `modifier-picker.tsx`, `customer-lookup.tsx` — 1001 lines, real data, real pricing) | **REJECT** | n/a — keep FRYBIRD's | — | Rebuilding this from the kit would be a regression: losing live repricing, the menu poll, offline handling, and idempotent order creation for a demo with fake tax |
| "Add Product" dialog | `add-product-dialog.tsx` | A drag-drop image upload + name/price/category form, *opened from inside the POS screen* | This is actually a **menu-management** dialog wearing a POS hat (create a new catalog item), not an order-line customization dialog. FRYBIRD's real equivalent (`product-create-form.tsx`) already exists in the Menu Control Center, which is the correct home for it — creating menu items from the counter mid-rush is not a pattern FRYBIRD needs. The image drag-drop UX (`useFileUpload` hook, drag states, preview, remove) is the one piece worth lifting. | **ADAPT** (the upload widget only) | Fold the drag-drop upload interaction into `src/components/iq/menu/product-media-form.tsx` if its current upload UX is weaker — compare before touching | `useFileUpload` hook pattern (rewrite without Radix if it uses any) | Do not add a "create product" entry point inside the POS screen |
| **Table list + status (available/occupied/reserved)** | `tables/page.tsx`, `tables/tables-render.tsx`, `tables/components/table-list-item.tsx`, `enums.tsx` (`EnumTableStatus`, color mapping) | A grid of table cards, color-coded by status, grouped by table category | **This is the one genuinely missing FRYBIRD capability.** BUILD-PLAN §22 (Table Management) is spec'd but unbuilt — FRYBIRD's POS today has no table concept at all (channel is dine-in/takeaway only, no table assignment). The status-color grid pattern is a clean, proven way to show floor state at a glance. | **ADAPT** | New `src/components/pos/table-grid.tsx` + `table-status-badge.tsx`, driven by a real `tables` schema/repository (does not exist yet — needs a migration) | none new | Needs a real `tables` + `table_sessions` (or similar) schema; do not fake table state client-side |
| **Table detail dialog** (order at this table, clear table) | `tables/components/table-detail-dialog.tsx` | Shows the order currently at a table, itemized, with subtotal/tax/total and a "Clear Table" action | Directly maps to "what's happening at table 4 right now" — a real operational need once dine-in table assignment exists | **ADAPT** | `src/components/pos/table-detail-dialog.tsx`, rebuilt against a real order-by-table query, real `formatINR`/GST breakdown (not `total / 1.05`) | none new | The kit's tax math (`order.total / 1.05`) is wrong for FRYBIRD's real GST engine — do not port the arithmetic, only the layout |
| Add-table dialog | `tables/components/add-table-dialog.tsx` | Create a table (name, category, capacity) | Needed once table management is real | **ADAPT** (when table management is built) | `src/components/iq/settings` or a POS-admin surface | none | — |
| Assign-order-to-table dialog | `components/assign-order-to-table.tsx` | Picks a table after building an order | Matches BUILD-PLAN §22's assignment flow | **ADAPT** (when table management is built) | `src/components/pos/assign-order-to-table.tsx` | — | Must call the real order-update path, not local state |
| Search popover (mobile) | `pos-system-menu.tsx` (Popover-wrapped search input, `lg:hidden`) | Collapses search into a popover on narrow screens | FRYBIRD's POS already handles the mobile category case with a native `<select>` fallback (simpler, no extra primitive) — minor, optional polish only if search becomes a POS need beyond the existing grid filter | **REJECT** (not needed — no evidence FRYBIRD's POS search UX is currently weak) | n/a | — | — |
| POS state via zustand | `store.ts` | Client global store | FRYBIRD's POS state is local `useState` in `pos-shell.tsx`, server-authoritative via `priceDraftOrder` — correct for a single-screen flow. Zustand would be justified only if POS state needs to be shared across routes (e.g., POS + a persistent cart-sheet at a nav level), which isn't the current shape. | **REJECT** | n/a | — | Don't introduce a second state-management library for one screen |

**FRYBIRD POS remaining architecture (BUILD-PLAN §19–22), for the record — none of this is in the kit, all of it is real future work:** hold/resume, split/merge/transfer, void/refund, cash session open/close/reconciliation. See `FRYBIRD-POS-ARCHITECTURE.md`.

---

## 3. Products / Menu

FRYBIRD's Menu Control Center (`src/components/iq/menu/*`, 19 files, `src/lib/repositories/menu-admin.ts`, 1362 lines) already covers product CRUD, categories, modifier groups, combos, media, availability, and — notably — a recipe-linking section (`product-recipe-section.tsx`), ahead of where BUILD-PLAN's phase order would suggest. This is **not a greenfield module**; treat every kit pattern here as *marginal enhancement*, not a rebuild.

| Feature | Reference location | What it does | Why useful | Verdict | FRYBIRD destination | Dependencies | Conflicts |
|---|---|---|---|---|---|---|---|
| Product data table (sortable, filterable) pattern | `ecommerce/components/best-selling-products.tsx`, `recent-orders.tsx` (already ported this session) | Sortable columns, filter input, row-action menu | Already proven and in production on `/app/iq` (`TopSellersTable`) | **REUSE** (pattern already established) | Apply the same pattern to a future Menu Control Center *list* view if one doesn't already exist | `@tanstack/react-table` (already installed) | — |
| Image drag-drop upload | `apps/pos-system/components/add-product-dialog.tsx` (`useFileUpload` hook) | Drag target, preview, remove, size/type validation | Compare against FRYBIRD's current product-photo upload UX in `product-media-form.tsx` before deciding | **ADAPT, conditionally** | `product-media-form.tsx`, only if its current upload UX is weaker | rewrite hook without Radix if present | Verify no Radix import in `useFileUpload` before reuse |
| File manager (upload/search/preview/folders) | `apps/file-manager/components/file-manager.tsx`, `file-upload-dialog.tsx` | Grid/list toggle, folder tree, file preview, search | FRYBIRD already has a real media library (`src/components/iq/menu/media-library.tsx`) backed by Supabase Storage for product photos. The kit's file-manager is a generic, unscoped file browser with fake `data.json` — not a stronger pattern, just a more generic one. | **REJECT as a replacement; ADAPT specific widgets only** (folder/category filter chips, search-as-you-type) if the existing media library's browsing UX is genuinely thin | `media-library.tsx`, incrementally | — | Do not build a second, general-purpose file manager alongside a working Storage-backed one |

---

## 4. Orders / KDS

| Feature | Reference location | What it does | Why useful | Verdict | FRYBIRD destination | Dependencies | Conflicts |
|---|---|---|---|---|---|---|---|
| Order data table | `ecommerce/components/recent-orders.tsx` | Sortable, filterable, paginated order list | Pattern already proven this session | **REUSE** (pattern) | A future `/app/orders` list view upgrade, if the current one needs it — check `src/app/(app)/app/orders` first, it may already be adequate | `@tanstack/react-table` | — |
| Kanban board (columns × draggable cards) | `components/ui/kanban.tsx`, `apps/kanban/components/kanban-board.tsx` | Drag cards between named columns | A KDS is structurally a kanban: stations (or statuses) as columns, tickets as cards, drag (or tap) to advance status. This is the strongest single structural match in the entire kit for a FRYBIRD module. | **REWRITE** (per §1: Radix-in-kanban.tsx must be removed first) | `src/components/kds/*` — **BUILD-PLAN Phase 6, not this pass** | `@dnd-kit/*` (new dep, justified if KDS is greenlit) | Ticket "cards" need real-time updates (Supabase Realtime, already in the stack) — the kit's kanban is client-state-only and would need a realtime-subscription layer added, not just a restyle |

FRYBIRD KDS requirements (BUILD-PLAN §21) are untouched by this catalog: ticket queue, statuses, timers, priority, sound/visual alerts, completed history. None of that logic exists in the kit; only the column/card *shape* transfers.

---

## 5. Customers / CRM

| Feature | Reference location | What it does | Why useful | Verdict | FRYBIRD destination | Dependencies | Conflicts |
|---|---|---|---|---|---|---|---|
| Total customers / AOV-style metric cards | `crm/components/total-customers.tsx`, `total-revenue.tsx`, `total-deals.tsx` | KPI tiles | Same `StatTile`/Card pattern already in production on `/app/iq` | **REUSE** (pattern, already proven) | A future Customers analytics tile row | — | — |
| Sales pipeline (deal stages, kanban-ish) | `crm/components/sales-pipeline.tsx`, `leads.tsx`, `leads-by-source.tsx`, `target-card.tsx` | B2B lead/deal-stage tracking | FRYBIRD has no B2B sales process — a QSR doesn't have "leads" or "deals" | **REJECT** | n/a | — | — |
| Customer list + profile + order history | Not present as a dedicated screen in the kit — CRM here is lead/deal-focused, not a customer-record view | — | FRYBIRD already has the real thing: `src/lib/repositories/customers.ts`, the existing loyalty/rewards system, and per-customer order history via `orders` | **REJECT** (kit has nothing stronger to offer here) | n/a — extend FRYBIRD's own customer repository/UI directly | — | — |

**Conclusion: reject the kit's CRM module almost entirely.** It's shaped around sales pipelines, not repeat-customer QSR relationships. FRYBIRD's own Rewards/loyalty system is the correct foundation for a future Customers screen; only the generic metric-tile and data-table *patterns* (already reused elsewhere) apply.

---

## 6. Analytics / Finance / Payments

| Feature | Reference location | What it does | Why useful | Verdict | FRYBIRD destination | Dependencies | Conflicts |
|---|---|---|---|---|---|---|---|
| Dashboard card/chart/table composition (bar, line, donut, sortable table) | `ecommerce/*`, `sales/*`, `finance/*`, `widgets/analytics/*` | The full charting vocabulary | **Already fully audited and ported this session** for `/app/iq` (recharts `LineChart`/`PieChart`, `ChartContainer`, sortable `Table`) | **REUSE** (pattern, done) | Apply identically to future analytics views (product performance, channel mix, kitchen timing) as those screens get built | `recharts`, `@tanstack/react-table` (installed) | Every chart must read real repository data — §33 is non-negotiable, the kit's numbers are fixtures |
| Transaction history table (status badges, filters) | `payment/transactions/transactions-table.tsx`, `payment/components/transaction-history.tsx` | Filterable payment/transaction ledger | Directly maps to a future "Payments" reconciliation view once Razorpay (Phase 2 payments, already an interface in `src/lib/payments`) has real transaction volume to show | **ADAPT** (future) | A future `/app/iq/payments` view, real data only | `@tanstack/react-table` | Not useful today — cash is currently the only live `PaymentProvider`; a transaction table with one row type is premature |
| Wallet / balance / exchange-rate widgets | `payment/components/balance-overview.tsx`, `exchange-rates.tsx`, `finance/components/my-wallet.tsx` | Multi-currency wallet UI | FRYBIRD is INR-only by design (`BUILD-PLAN.md` "Currency is INR only") | **REJECT** | n/a | — | Multi-currency UI directly contradicts a non-negotiable rule |
| Saving goals, monthly expense breakdown | `finance/components/saving-goal.tsx`, `monthly-expenses.tsx` | Personal-finance widgets | Not a restaurant concept — FRYBIRD's actual expense/food-cost reporting already exists and is real (`/app/iq/expenses`, `/app/iq/pnl`, this session's `CostBreakdownDonut`) | **REJECT** | n/a | — | — |

---

## 7. Logistics

`app/dashboard/(auth)/logistics/page.tsx` is a single file (fleet/shipment tracking dashboard, generic cards). FRYBIRD already has a real delivery surface (`src/app/(app)/app/deliveries`, `src/components/staff/delivery-card.tsx`, `delivery-panel.tsx`) built against real order/delivery data.

**Verdict: REJECT.** Nothing in the kit's logistics page is stronger than what exists; it's a generic shipment-fleet dashboard, not a food-delivery-specific one, and would need a full rewrite to mean anything for FRYBIRD's actual delivery model.

---

## 8. Other apps surveyed and rejected outright

Academy, AI Image Generator, Chat, AI Chat / AI Chat v2, Mail, API Keys, Text-to-Speech, Courses, Notes, To-do List, Social Media, Crypto, Workflow Automation, Project Detail/List/Management, Hospital Management, Hotel, Real Estate, Website Analytics, AI Analytics, Widgets (fitness).

**REJECT, all.** None maps to restaurant operations. I skimmed each for one thing only — any generic, domain-agnostic pattern worth lifting (a roster grid, a status board, a scheduling widget) — and found nothing beyond what's already cataloged above (kanban, calendar, settings-shell).

---

## 9. Staff / scheduling

**Read in full:** `apps/calendar/components/event-calendar.tsx`, `event-calendar-app.tsx`, `calendar-dnd-context.tsx`; `hr/components/work-calendar.tsx`.

| Feature | Reference location | What it does | Why useful | Verdict | FRYBIRD destination | Dependencies | Conflicts |
|---|---|---|---|---|---|---|---|
| Event calendar (month/week/day views, drag-to-reschedule) | `apps/calendar/*` | Full scheduling calendar | Could become a shift roster (staff × time-slot grid) | **REJECT for now** | Future Staff/Shifts work | date/drag library (check before adding) | FRYBIRD has zero shift/roster schema today — there's nothing to bind this to yet, and shift scheduling isn't in BUILD-PLAN's phase list at all (Phase 7 "Admin" mentions "staff" as a section, not scheduling specifically) |
| `hr/components/work-calendar.tsx` | `hr/` | A simpler staff-attendance grid | Lighter-weight than the full event calendar; closer to what a single-location QSR roster actually needs (who's on today, not multi-week project scheduling) | **REJECT for now, note as the better starting point if/when this is scoped** | — | — | Same schema gap as above |
| Staff list/profile pattern | Not present as a dedicated screen anywhere in the kit (HR module is metrics-dashboard-shaped: headcount, attrition charts — not a staff directory) | — | FRYBIRD's permission vocabulary (8 roles, `staff.manage`) and `memberships` table already exist; no staff-facing list/detail UI | **REWRITE**, no reference pattern to lean on — reuse the `Table` + `Card` composition already established this session, not a kit-specific pattern | Future `src/app/(app)/app/staff/page.tsx` | `@tanstack/react-table` (have it) | — |

**Verdict: catalog now, build later.** Nothing here is a current-phase gap per BUILD-PLAN §73, and there's no schema to build a real (non-fake) shift feature against yet. This section exists so the option is documented, not lost, and so nobody re-discovers "the kit has a calendar" as if it were news when the actual blocker is a missing data model, not missing UI.

## 10. Settings

**Read in full:** `pages/settings/layout.tsx`, `pages/settings/components/sidebar-nav.tsx`, `pages/settings/page.tsx` (Profile), `account/page.tsx`, `appearance/page.tsx`, `billing/page.tsx`, `notifications/page.tsx`, `display/page.tsx`.

| Feature | Reference location | What it does | Why useful | Verdict | FRYBIRD destination | Dependencies | Conflicts |
|---|---|---|---|---|---|---|---|
| Settings shell — a `layout.tsx` wrapping every sub-page in a shared two-column frame, `sidebar-nav.tsx` as the section switcher (a list of links, active-state styled, not a dropdown) | `pages/settings/layout.tsx` + `components/sidebar-nav.tsx` | One shared frame, one nav component, each section is its own route/page | This shape maps directly onto the target taxonomy (Restaurant/GST/Payments/Integrations/Notifications) — one settings section per real config surface | **ADAPT** | New `src/app/(app)/app/settings/layout.tsx` + `src/components/app/settings-nav.tsx` | none new | — |
| Section *content* (Profile, Account, Billing, Appearance, Notifications, Display) | `pages/settings/*/page.tsx` | Personal-account settings for a SaaS product | None of this maps to FRYBIRD — there's no per-user billing, no personal appearance theme (tokens are locked), "Account" here means a SaaS customer's own subscription, not a restaurant's tax/payment config | **REJECT content, REWRITE from scratch** per real section | New pages: `settings/restaurant`, `settings/tax`, `settings/payments`, `settings/integrations`, `settings/notifications` | — | Each new page's fields come from what the existing CLI scripts (`configure-business.ts`, `configure-delivery.ts`, `configure-loyalty.ts`, `configure-stamps.ts`) already configure — the script is the spec for what fields are real, not the kit's demo form fields |
| Form pattern inside each settings page | same files | Plain controlled inputs, save button, toast-on-success (kit uses its own `form.tsx` wrapper — already rejected in §1) | FRYBIRD's forms already use `react-hook-form` + Zod directly (menu admin, expense form) without a wrapper layer | **ADAPT the layout, REJECT the form wrapper** | Use FRYBIRD's existing form convention, not the kit's `Form`/`FormField` components | react-hook-form, zod (already installed) | Do not introduce a second form-abstraction layer |

---

## Summary verdict counts

| Verdict | Count (approx., by catalog row) |
|---|---|
| REUSE (pattern already proven / drop-in via `shadcn add`) | 9 |
| ADAPT | 11 |
| REWRITE | 2 (kanban → KDS, and anything importing `@radix-ui/*` directly) |
| REJECT | 20+ |

**The headline conclusion:** this kit's value to FRYBIRD is concentrated in three places — (1) the chart/table/card composition vocabulary, already extracted and proven this session; (2) POS table-management, a real and currently-missing capability; (3) the kanban primitive as a future KDS starting point, pending a Radix-removal rewrite. Almost everything else (POS ordering itself, CRM, finance/wallet, logistics, file-manager) is either something FRYBIRD already does better, or a business shape (B2B sales pipeline, multi-currency wallet, generic shipment tracking) that doesn't exist in a QSR.
