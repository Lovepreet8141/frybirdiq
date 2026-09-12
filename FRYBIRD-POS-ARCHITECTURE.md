# FRYBIRD POS — Architecture

Companion to `FRYBIRD-REFERENCE-CATALOG.md` §2. This is the one module the request weighted most heavily (§7), so it gets the most detail here.

## Current state — read before proposing anything

`src/components/pos/*` (1001 lines: `pos-shell.tsx`, `category-rail.tsx`, `product-grid.tsx`, `order-builder.tsx`, `modifier-picker.tsx`, `customer-lookup.tsx`, `use-online.ts`) plus `src/lib/pos/actions.ts` already implement:

- Server-priced draft orders (`priceDraftOrder`) — every price shown is computed server-side from the same pricing/tax engine the customer site uses, never trusted from the client, per CLAUDE.md's non-negotiable rule.
- A 25-second menu poll so a price change, 86'd item, or new photo from the Menu Manager reaches the counter screen without a reload — without ever touching an order already being built.
- Debounced repricing (200ms) so a burst of taps sends one pricing request, not one per tap.
- Real offline detection with a disabled grid and a stated reason (`"You're offline. New items can't be priced until connection returns."` / `"Choose dine-in or takeaway before adding items."`) — not a silent failure.
- Stale-deployment recovery on the menu poll.
- A real modifier picker, wired to actual `modifierGroups` per product.
- Mobile category fallback (native `<select>`, not a rail) below `lg:`.

This is, in every respect that matters, **already better than the reference kit's POS**, which is a client-only Zustand store computing a flat, fake 5% tax with no server round-trip at all. Section 16 of the brief ("the reference dashboard is the quality baseline") does not apply here — do not let a general instruction override a specific, verified fact. I checked; FRYBIRD's POS wins.

**What's not built yet, and matches BUILD-PLAN's own §19 spec:** payment capture UI, receipt, order history from the POS screen, discounts. These are real Phase 4 gaps — the phase isn't finished, POS just isn't a kit-reuse opportunity for the parts that exist.

## What the reference kit actually adds: table management

BUILD-PLAN §22 (Table Management) is fully specified and entirely unbuilt — FRYBIRD's order model today has no `tables` concept; `channel` is dine-in/takeaway/delivery/phone with no per-table state. The kit's `apps/pos-system/tables/*` gives a genuinely useful, provenreference for exactly this: a status-colored table grid (available/occupied/reserved), a table detail dialog (order at this table, itemized, with a clear-table action), an add-table dialog, and an assign-order-to-table flow.

### Proposed schema addition (new migration, additive only — nothing existing changes)

```
tables
  id, org_id, location_id, name, category (text, e.g. "Patio", "Indoor"),
  capacity (int, nullable), is_active, created_at, updated_at

-- Table state is derived, not stored: a table is "occupied" if an order exists
-- with table_id = this table and status not in (COMPLETED, CANCELLED, REFUNDED).
-- Storing a redundant status column on `tables` would be a second source of
-- truth that can drift from the orders table itself — the same class of bug
-- CLAUDE.md's price_basis rule warns against elsewhere in this codebase.
```

```
orders.table_id  uuid, nullable, references tables(id)
```

`table_id` is only ever set for `fulfilment = DINE_IN` orders (per the existing `channel`/`fulfilment` pairing rule in CLAUDE.md — the pair is enforced in `src/domain/order-channel.ts` and a check constraint; a table assignment on a non-dine-in order should fail the same way).

### Component plan (adapted from the kit, rewritten against real data)

| Component | Adapted from | Real data source |
|---|---|---|
| `table-grid.tsx` | `tables/tables-render.tsx` + `table-list-item.tsx` | `listTables(orgId)` joined against open orders (new repository function) |
| `table-status-badge.tsx` | `enums.tsx`'s status→color map | Derived status (available/occupied/reserved), not stored |
| `table-detail-dialog.tsx` | `table-detail-dialog.tsx` | Real order lines, `formatINR`, real GST breakdown via `src/lib/tax/gst` — **not** the kit's `total / 1.05` arithmetic, which is wrong for FRYBIRD's actual tax engine |
| `add-table-dialog.tsx` | `add-table-dialog.tsx` | A simple insert into `tables`, `settings.manage`-gated |
| `assign-order-to-table.tsx` | `assign-order-to-table.tsx` | Updates the real `orders.table_id`, dine-in only |

None of this is copied — every file above is a fresh FRYBIRD component using the kit's file only as a UI/interaction reference, per the brief's explicit "adapt, don't copy" instruction.

## Full future order-lifecycle architecture (documented, not built this pass)

For continuity with BUILD-PLAN §19–22 and the brief's §7/§9 wishlist, the target shape once later phases are reached:

- **Hold / Resume** — a draft order persisted server-side (not just client state) with a status like `HELD`, resumable by any cashier, not just the one who held it. Needs its own idempotency treatment, same as order placement (§17).
- **Split / Merge** — splitting a table's order into N payable tickets, or merging two tables' orders into one. Both are order-line reassignment operations that must preserve price snapshots (§51 — a split ticket's line prices must not be recalculated from today's menu).
- **Transfer** — moving an order from one table to another; a `table_id` update with an audit row, nothing more.
- **Void / Refund** — FRYBIRD already has `orders.cancel` and `orders.refund` permissions and (per the customer-side loyalty work this session) a real settlement path. The POS-side void/refund UI is the missing piece, not the underlying capability.

None of this is invented for this document — it's restating what BUILD-PLAN already specifies, so the shell and schema decisions made now (the `tables` addition above) don't foreclose it.

## What ships in this pass vs. what doesn't

**This pass:** table management (schema + the five components above), wired into `/app/pos` as a new "Tables" view alongside the existing product-grid view — exactly matching the kit's own `pos-system-menu.tsx` → `tables/page.tsx` navigation shape, adapted to real data.

**Not this pass** (BUILD-PLAN phases 4's remaining scope, 5, and 6): payment capture, receipts, order history, discounts, hold/resume, split/merge/transfer, void/refund UI, offline PWA, KDS. These stay documented, not built, per the phasing decision in `FRYBIRD-IMPLEMENTATION-PLAN.md`.
