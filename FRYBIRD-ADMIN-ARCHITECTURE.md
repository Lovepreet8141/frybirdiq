# FRYBIRD Admin — Unified Shell Architecture

Companion to `FRYBIRD-REFERENCE-CATALOG.md`. This document proposes the long-run information architecture for FRYBIRD IQ's staff/admin surface, and is explicit about which parts are real work for *this* implementation pass versus documented future phases — because FRYBIRD's own `BUILD-PLAN.md` §73 already specifies a build order (current phase: **4, Web POS**), and several modules requested in the brief (Inventory, Staff/Shifts, full CRM, KDS) are phases 6–8, not phase 4. See `FRYBIRD-IMPLEMENTATION-PLAN.md` for the phasing decision and the one question this raises for you.

## Why a sidebar, not the current header row

FRYBIRD's staff shell today (`src/app/(app)/app/layout.tsx`) is a single-row header: logo, up to 5 nav links gated by permission, staff name/role, sign-out. That's correct for what exists now. It cannot hold the IA below — even collapsed to icons, 8 top-level groups with 3–5 items each doesn't fit a header row on a laptop, let alone the iPad POS is also served from. A collapsible left sidebar (pattern source: `components/layout/sidebar/*` in the reference kit, rebuilt on Base UI, no Radix) is the standard, correct answer, and it's additive: POS and KDS stay full-bleed with no sidebar, exactly as they are today, because touch/speed screens should not spend width on navigation chrome.

## Navigation groups, with build status

Each group below is marked:
- **LIVE** — exists today, in some form, possibly needing the sidebar wrapper but not new business logic.
- **NOW** — genuinely missing, in scope for this implementation pass, small enough to build without skipping BUILD-PLAN phases.
- **PLANNED** — real, spec'd in BUILD-PLAN, has a genuine destination, but is a later phase (5–11). Documented here so the shell has a stable place for it later; **not built in this pass**.

```
FRYBIRD IQ
├── OPERATIONS
│   ├── Overview          LIVE   → /app/iq (this session's rebuild)
│   ├── Orders            LIVE   → /app/orders
│   ├── POS               LIVE   → /app/pos
│   ├── Deliveries        LIVE   → /app/deliveries
│   └── KDS               PLANNED (Phase 6) — ticket queue, stations, timers. Kanban primitive
│                          identified as the structural starting point, pending a Radix-free rewrite.
│
├── MENU
│   ├── Menu Overview     LIVE   → /app/iq/menu (menu-control-center.tsx)
│   ├── Products          LIVE   → same, product-admin-card / product-*-form
│   ├── Categories        LIVE   → category-form.tsx
│   ├── Modifiers         LIVE   → modifier-group-form.tsx, modifier-list.tsx
│   ├── Combos            LIVE   → combo-items-form.tsx
│   ├── Media             LIVE   → media-library.tsx (Supabase Storage)
│   ├── Availability      LIVE   → product-availability-form.tsx, category-availability-form.tsx
│   ├── Publish Queue     PARTIAL → menu/review exists (src/app/(app)/app/iq/menu/review) — audit before
│   │                          building anything new here, it may already cover this
│   └── Activity Log      PLANNED — needs an audit-log read surface; audit.view permission already
│                          exists in domain/permissions.ts, no UI yet
│
├── CUSTOMERS
│   ├── Customers         PLANNED (near-term, not this pass) — real repository exists
│   │                          (lib/repositories/customers.ts), no list/profile UI yet
│   ├── Loyalty           LIVE   → /app/iq/rewards
│   └── Feedback          PLANNED — no schema for reviews/feedback exists yet; needs a product
│                          decision (what does "feedback" mean for FRYBIRD — post-order rating?
│                          in-person comment log?) before any schema work
│
├── INVENTORY                                                              PLANNED — Phase 8
│   ├── Stock, Ingredients, Suppliers, Purchases, Wastage, Alerts
│   └── The schema already exists in full (db/schema/inventory.ts: suppliers, ingredients,
│       ingredientPrices, inventoryItems, inventoryMovements, wasteEntries, recipes, recipeItems,
│       purchaseOrders, purchaseOrderItems) — this is the best-prepared "planned" module in the
│       whole catalog. No UI or repository layer built against it yet.
│
├── COST & RECIPES
│   ├── Recipes            PARTIAL → product-recipe-section.tsx exists in Menu Control Center
│   ├── Food Cost           LIVE   → /app/iq (this session), /app/iq/pnl
│   ├── Product Cost        PARTIAL → lib/iq/costing.ts exists (pure, tested) — no dedicated UI
│   └── Margins             PARTIAL → lib/iq/profit.ts exists (pure, tested) — surfaced on /app/iq/pnl
│
├── ANALYTICS
│   ├── Sales               LIVE   → /app/iq
│   ├── Products            PARTIAL → top-sellers/not-selling on /app/iq; no dedicated deep view
│   ├── Channels             PARTIAL → delivery/collection split existed in an earlier /app/iq
│   │                          iteration, removed when the screen was rebuilt around 4 priority
│   │                          questions — revisit if channel performance becomes a real need
│   ├── Customers            PLANNED — depends on Customers module above existing first
│   ├── Kitchen              PLANNED — depends on KDS existing first (ticket timing data)
│   └── Profitability        LIVE   → /app/iq/pnl
│
├── STAFF                                                                  PLANNED — Phase 7
│   ├── Staff, Roles, Permissions, Shifts
│   └── domain/permissions.ts already has the full ROLE/PERMISSION vocabulary
│       (OWNER/ADMIN/MANAGER/CASHIER/KITCHEN/RIDER/INVENTORY/ANALYST, staff.manage). No
│       management UI exists — staff accounts are currently provisioned via
│       `pnpm staff:grant` (a CLI script), which is correct for a single-location shop today.
│
└── SETTINGS                                                               PARTIAL / PLANNED
    ├── Restaurant, Payments, Notifications, Integrations   PLANNED
    ├── GST / Tax           PARTIAL → price_basis and GST logic exist in src/lib/tax, src/lib/pricing;
    │                          no settings UI to view/change them (a real business decision, not a
    │                          cosmetic form — changing price_basis retroactively is dangerous, see
    │                          CLAUDE.md's non-negotiable rule on it)
    └── The kit's tabbed-sections settings-page layout (`app/dashboard/(auth)/pages/settings/*`)
        is a reasonable shell pattern once there's real settings content to hang on it.
```

## What this pass actually changes in the shell

1. Add the sidebar shell (Base UI, no Radix), wired to the *existing* nav destinations only (Overview/Orders/POS/Deliveries/Menu — everything already LIVE above), permission-gated exactly as today's header is.
2. Leave PLANNED groups out of the rendered nav entirely — a nav item that opens a "coming soon" page is exactly the "fake placeholder functionality just to fill the navigation" the brief itself forbids (§6). They're documented here so the IA has a stable home for them when their phase arrives, not so they appear half-built today.
3. PARTIAL items (Publish Queue, Recipes, Product Cost, Margins, Channels) get audited as part of this pass — some may already satisfy the request and just need a nav entry, not new code. See the implementation plan for which.

## Design language across surfaces (unchanged, restated for this doc's completeness)

- Ember `#C21F11` / Charred `#1F0705` / Cream `#F5EDD8` / Amber `#F2A324` — locked, customer site only. The IQ admin surface is its own locked light palette (`[data-surface="iq"]` in `globals.css`) — white panels, near-black ink, brand red accent — already correctly distinct from both the kit's palette and the customer-facing dark theme.
- Admin: dense, operational — the pattern already established on `/app/iq`.
- POS: touch-first, no sidebar, nothing animates over 120ms (`design-system/motion.md`'s POS ceiling).
- KDS (when built): glanceable, high contrast, no sidebar — same reasoning as POS.
