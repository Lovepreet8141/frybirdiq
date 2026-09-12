# FRYBIRD Component Migration

Concrete file list for what actually gets pulled into the repo, adapted from `FRYBIRD-REFERENCE-CATALOG.md`. Nothing here is a wholesale copy — see "How each entry is built" below the table.

## Primitives (via `shadcn add`, base-nova/Base UI — not hand-translated from the kit)

Already done this session: `avatar`, `tooltip`, `progress`, `dropdown-menu`, `table`, `chart`.

To add now, for the table-management work:
```
pnpm dlx shadcn@latest add command   # only if the ⌘K nav search is greenlit — otherwise skip
```
No other primitive additions are needed for this pass. Confirmed via the catalog: everything else the kit uses that FRYBIRD lacks is either not needed yet (pagination, breadcrumb, combobox — no screen in this pass needs them) or structurally Radix-locked (kanban — deferred to the KDS phase).

## New FRYBIRD components (adapted, rewritten from scratch against real data)

| New file | Adapted from (reference, read-only) | Data source |
|---|---|---|
| `src/components/staff/app-sidebar.tsx` | `components/layout/sidebar/*` (structure only — collapsible rail, grouped nav, active-state styling) | `staffCan()` permission checks, same as today's header nav |
| `src/components/pos/table-grid.tsx` | `apps/pos-system/tables/tables-render.tsx`, `table-list-item.tsx` | New `listTables` repository function |
| `src/components/pos/table-status-badge.tsx` | `apps/pos-system/enums.tsx` (status→color mapping *concept* — not the kit's literal green/blue/red Tailwind classes, which must be re-derived from FRYBIRD's own semantic tokens: `--success`, `--muted`, `--destructive` on the IQ surface) | Derived, not stored |
| `src/components/pos/table-detail-dialog.tsx` | `apps/pos-system/tables/components/table-detail-dialog.tsx` (dialog layout, item table) | Real order + `src/lib/tax/gst`, `formatINR` |
| `src/components/pos/add-table-dialog.tsx` | `apps/pos-system/tables/components/add-table-dialog.tsx` | New `createTable` repository function |
| `src/components/pos/assign-order-to-table.tsx` | `apps/pos-system/components/assign-order-to-table.tsx` | Updates real `orders.table_id` |

## Schema change

One new migration: `tables` table + `orders.table_id` (nullable FK). See `FRYBIRD-POS-ARCHITECTURE.md` for the exact shape and the reasoning against storing a redundant status column.

## Repository additions

`src/lib/repositories/tables.ts` (new file): `listTables(orgId)`, `createTable(orgId, input)`, `assignOrderToTable(orderId, tableId)`, `clearTable(tableId)` — every query `org_id`-scoped per CLAUDE.md's non-negotiable rule (Drizzle bypasses RLS).

## Explicitly not migrated this pass, with the one-line reason from the catalog

- POS product grid / cart / order builder / modifier picker — FRYBIRD's existing versions are already stronger (server-priced, offline-aware, live-polled). Catalog §2.
- CRM (leads/pipeline/deals) — wrong business shape for a QSR. Catalog §5.
- File manager (generic) — FRYBIRD already has a Storage-backed media library scoped to product photos. Catalog §3.
- Wallet/balance/exchange-rate/saving-goal widgets — multi-currency UI contradicts FRYBIRD's INR-only rule. Catalog §6.
- Kanban → KDS — real future work, but blocked on removing a direct `@radix-ui/react-slot` import from `components/ui/kanban.tsx` first, and KDS itself is BUILD-PLAN Phase 6, not this pass. Catalog §1, §4.
- Theme customizer, notifications dropdown, profile menu — FRYBIRD's existing equivalents (locked tokens, `NewOrderAlert`, name+role+sign-out) are already correct or stronger. Catalog §1.

## How each entry is built (process, not just outcome)

For every "adapted" component: read the reference file for its layout/interaction shape and state transitions, then write a new FRYBIRD file from scratch — real prop types against FRYBIRD's actual repository return shapes, `formatINR` at the render boundary only, Base UI primitives, house conventions (`cn` from `"cn"`, `data-slot`, the existing `Card`/`Table`/`Dialog` primitives already in `src/components/ui/`). No reference file is ever copied into this repo, imported from, or left as a dependency — this satisfies the brief's explicit "never copy kit files into this repo wholesale" and the licensing concern (the kit is licensed to you personally; this repo is on GitHub).
