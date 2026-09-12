# FRYBIRD IQ — Inventory Architecture Proposal

Proposal only. No migration, schema change, or inventory code accompanies
this document. Every claim below about "what exists" was verified against
the repository on 2026-09-13; every "new" item is a decision listed at the
end for approval.

---

## 0. The one-paragraph picture

FRYBIRD already has an unusually complete inventory **schema** and a
tested, integer-only **costing library**, and **zero** inventory data,
repository code, or writes. The proposal therefore adds a small number of
columns (recipe versioning and movement traceability), no new core tables
beyond `recipe_versions`, and builds write paths that follow the patterns
the codebase already uses for money and orders: Zod at the boundary,
`requirePermission`, one transaction per write, an `audit_logs` row, and
`withIdempotency` where a retry could double-count. Order-driven
consumption is a *separate*, idempotent transaction triggered after the
"Start cooking" transition — never inside the order path — with a
reconcile action for anything missed. Recipes become immutable versions so
history never moves.

---

## 1. What exists and is reused as-is

### Schema (`src/db/schema/inventory.ts`) — complete, never written to
| Table | Reused for | Notes |
|---|---|---|
| `suppliers` | Suppliers | name, phone, email, GSTIN, address, `isActive` |
| `ingredients` | Ingredients | `baseUnit` (enum), `costPerBaseUnit` (paise, display), **`costPerBaseUnitMilli`** (thousandths of a paisa — the value recipes cost from), `yieldBps`, `wasteBps`, `supplierId`, `isPackaging`, `isActive`; unique `(orgId, name)` |
| `ingredient_prices` | Purchase price history | append-only; `purchaseQuantity/Unit/Cost`, derived `costPerBaseUnit`, `effectiveFrom`, supplier |
| `inventory_items` | Stock on hand | per `(ingredientId, locationId)`; `quantityOnHand` in base units, **"a running total of movements, never set directly"**; `reorderThreshold` |
| `inventory_movements` | The ledger | `type` enum **PURCHASE / SALE / WASTE / ADJUSTMENT / TRANSFER / RETURN**, signed `quantity` in base units, `costPerBaseUnit` + `totalCost` valued "at the cost in force when it happened", `orderId` (uuid, no FK), `actorUserId`, `notes`, `occurredAt`; indexed by ingredient, location, order |
| `waste_entries` | Waste | reason enum EXPIRED / OVERPRODUCTION / PREPARATION / DAMAGED / CUSTOMER_RETURN / QUALITY, `movementId` link, `cost`, actor |
| `recipes` | Recipe header | `productId` **unique** (one recipe per product), `yieldQuantity` |
| `recipe_items` | Recipe lines | `(recipeId, ingredientId)` unique, `quantity` in the ingredient's base unit |
| `purchase_orders` / `purchase_order_items` | Purchasing | `status` is free **text** (default `DRAFT`), money totals, `expectedAt`/`receivedAt`, per-line `receivedQuantity` |
| `unit` enum | Units | `G, KG, ML, L, PIECE, PACK` |

### Libraries (`src/lib/iq/`) — pure, integer arithmetic, tested
- `units.ts` — base units are **G, ML, PIECE**; KG/L convert by exact integer factor; **PACK is deliberately unconvertible** ("enter the contents instead"). `toBaseUnits` refuses non-integer quantities.
- `costing.ts` — `usableCostPerBaseUnit` (purchase cost ÷ (qty × yield × (1−waste)), rounded once at millipaise), `recipeLineCost`, `costFromRate(rate, qty)`, `rateToPaise`. `MilliPaise` branded type.
- `profit.ts` — `contribution`, `shareOfRevenueBps`; `pricing.ts` — `requiredPrice`, `achievedMarginBps`.
- `src/lib/money` — `Paise`, `add/subtract/multiply/scale/ratioBps/allocate`, `formatINR`.

### Domain / platform pieces that inventory plugs into
- **Permissions** (`domain/permissions.ts`) already defined *and assigned*: `inventory.view`, `inventory.adjust`, `inventory.waste`, `purchasing.manage`, `recipes.view`, `recipes.edit`. INVENTORY role holds all six; MANAGER holds view/adjust/waste/purchasing + recipes.view; KITCHEN holds waste + recipes.view; ANALYST view only.
- **Audit** — `audit_logs` (who/what/before/after/context) with a proven write path (`payments.ts`); **not** `menu_audit_log`, which is the menu's own field-change log.
- **Idempotency** — `withIdempotency({ key, operation, orgId, request })` with fingerprint + TTL.
- **Orders** — `order_items` snapshot `productId` (nullable on delete) + `quantity`; `order_item_modifiers` snapshot `modifierId`; `combo_items(comboProductId → productId, quantity)`; `orders.locationId`, `status`, `acceptedAt/readyAt/completedAt`; `order_events` append-only with actor.
- **Menu** — `products.productType` SIMPLE | COMBO; `menu-admin.ts` has `getRecipeStatus`, `createBareRecipe` (upsert header only), and the honest stub `inventoryAvailability(): "unknown"` — the documented Smart 86 integration point.
- **Expenses / P&L** — `expenses` (DIRECT/FIXED categories, `supplierId`, `accountId`); `foodCostWeeklySeries` computes food cost as **DIRECT expenses ÷ revenue**. This is the current, only, definition of food cost — see decision D7.
- **Locations** — `orders.locationId` and `inventory_items.locationId` both exist; one location in production.

### KDS-adjacent fields (identified, **not** to be changed here)
- `products.prepMinutes` — "Kitchen prep time in minutes. Feeds order ETAs and, later, the KDS."
- `products.kdsStation` — free text, "Which kitchen station makes this — fry, grill, assembly. Read by the KDS once it exists; unused today."
- `products.productType`, `comboItems`, `order_item_modifiers` — the same expansion consumption needs is what KDS routing would need. Any station model should be decided once, for both.

---

## 2. What is missing (the minimum)

### New table
**`recipe_versions`** — `id, orgId, recipeId → recipes, version int, yieldQuantity, notes, createdBy, createdAt, supersededAt nullable`. Unique `(recipeId, version)`.

### New columns (all additive, all nullable or defaulted; production tables are empty so no backfill)
| Table | Column | Why |
|---|---|---|
| `recipes` | `current_version_id → recipe_versions` (nullable) | which version prices and consumes today |
| `recipe_items` | `version_id → recipe_versions` (nullable; new unique `(version_id, ingredient_id)`) | lines belong to a version, never edited in place |
| `inventory_movements` | `order_item_id` (uuid, no FK), `recipe_version_id → recipe_versions`, `reversal_of_movement_id → inventory_movements` | traceability: which line, which recipe, which reversal |
| `inventory_movements` | **partial unique index** `(order_item_id, ingredient_id) WHERE type = 'SALE'` | consumption idempotent at the database, not just in code |
| `ingredient_prices` | `cost_per_base_unit_milli` bigint | the price series should carry the exact rate, not the rounded display value |
| `purchase_orders` | **check constraint** `status IN ('DRAFT','ORDERED','RECEIVED','CANCELLED')` | keep the text column; make it honest |
| `waste_entries` | `order_id` (uuid, nullable) | waste caused by a cancelled cooked order links back to it |

### Deferred (designed, not v1)
- `modifier_ingredients(modifierId, ingredientId, quantity)` — modifiers consume nothing in v1; "extra cheese" is not costed until this exists (D4).
- `stock_counts` + `stock_count_lines` — counted-vs-expected sessions; v1 uses direct ADJUSTMENT movements with a mandatory note (D5).

No existing column is altered or dropped. `recipe_items.recipe_id` stays (a version's lines still belong to the recipe).

---

## 3. Permissions (no new permission proposed)

| Capability | Permission | Held by |
|---|---|---|
| See ingredients, stock, movements, recipes, food cost | `inventory.view` / `recipes.view` | OWNER, ADMIN, MANAGER, INVENTORY, ANALYST (+KITCHEN recipes) |
| Ingredient & supplier master data, price records, purchase orders, receiving | `purchasing.manage` | OWNER, ADMIN, MANAGER, INVENTORY |
| Adjustments (set/correct stock) | `inventory.adjust` | OWNER, ADMIN, MANAGER, INVENTORY |
| Waste | `inventory.waste` | OWNER, ADMIN, MANAGER, INVENTORY, **KITCHEN** |
| Recipe versions | `recipes.edit` | OWNER, ADMIN, INVENTORY (MANAGER deliberately not — same logic as `menu.price`) |
| Consumption / reversals | none — system, triggered by the order transition the actor already had `kitchen.update` for | — |

Decision D8: master data under `purchasing.manage` (reuse) versus a new `inventory.manage`.

---

## 4. Write paths

Every path: Zod schema → `requirePermission` → one `db().transaction` → `audit_logs` row → `revalidatePath`. Money only through `src/lib/money` and `lib/iq/costing.ts`. Quantities are integers in base units; `PACK` is rejected at the boundary per `units.ts`.

1. **Ingredient create / update** (`purchasing.manage`) — name, base unit, yield, waste, supplier, packaging flag, active. Cost is **not** editable here.
2. **Record a price** (`purchasing.manage`) — inserts `ingredient_prices` (qty, unit, cost, supplier, `effectiveFrom`) and sets `ingredients.costPerBaseUnitMilli` (+ rounded `costPerBaseUnit`) via `usableCostPerBaseUnit`. Audit before/after rate.
3. **Supplier create / update** (`purchasing.manage`).
4. **Recipe version create** (`recipes.edit`) — writes header (if absent), a new `recipe_versions` row and its lines, sets `recipes.current_version_id`, marks the prior version `supersededAt`. Versions are never edited or deleted. Audit with the full line set as `after`.
5. **Purchase order create / order / cancel** (`purchasing.manage`) — DRAFT → ORDERED → (RECEIVED | CANCELLED); totals from lines via `money`.
6. **Receive purchase order** (`purchasing.manage`, **idempotent** via `withIdempotency(key = po:<id>:receive)`) — per line: PURCHASE movement (+qty, valued at line cost), price record (path 2), `inventory_items` upsert += qty; PO → RECEIVED with `receivedAt`. **Also** writes one `expenses` row (DIRECT, supplier, account) — see D7.
7. **Record waste** (`inventory.waste`) — `waste_entries` + WASTE movement (−qty, valued at current rate), `inventory_items` −= qty. KITCHEN may do this from the KDS later.
8. **Adjust stock** (`inventory.adjust`) — ADJUSTMENT movement with signed delta and a **required** note; audit `before/after` on-hand.
9. **Consume for order** (system) — see §6.
10. **Reverse consumption** (system) — see §7.
11. **Reconcile consumption** (`inventory.adjust`) — lists orders past the trigger status with no SALE movements and re-runs path 9; the safety net for a failed hook.

---

## 5. Transaction boundaries

- Paths 1–8 each wrap all their writes in one transaction; the audit row is written inside it.
- **Consumption is its own transaction, after the order transition commits.** `advanceOrder` today is *not* transactional (an `update` then an `insert`, sequential) and must not be widened to include inventory: a stock problem must never block a kitchen from starting a ticket. Pattern is the existing `reverseStampForOrder` — called after the status write, "transaction-adjacent", idempotent, no-op if already done.
- The partial unique index makes path 9 safe to run twice; the reconcile action makes it safe to run late.
- `inventory_items.quantityOnHand` is updated in the same transaction as the movement that changes it, always as `+= delta`, never `set`.

---

## 6. Order-driven consumption and order status

**Trigger: `PREPARING` ("Start cooking").** Ingredients physically leave stock when cooking starts; this is the KDS's own button, so it is the moment with a real actor. Before it, cancelling is a no-op for stock. Paid/unpaid is irrelevant to consumption. (D1 offers ACCEPTED and COMPLETED as alternatives.)

**Expansion, per order line:** SIMPLE product → its recipe's *current version* lines × line quantity ÷ `yieldQuantity`; COMBO → each `combo_items` component product's recipe × component quantity × line quantity; modifiers → nothing in v1 (D4). A product with no current recipe version produces **no** movement and is reported on the "products without a recipe" list — never a guessed quantity.

**Each SALE movement records** `orderId`, `order_item_id`, `recipe_version_id`, `−quantity`, `costPerBaseUnit` and `totalCost` at the rate in force — the theoretical cost of that sale, frozen.

**Valuation (D10):** current `costPerBaseUnitMilli` at consumption time (moving-cost); not FIFO. Simpler, matches how `ingredient_prices` is already modelled, and the movement snapshot keeps history stable when the rate changes.

---

## 7. Cancellation and refund implications

| Event | Stock effect | Mechanism |
|---|---|---|
| CANCELLED before PREPARING | none | nothing consumed |
| CANCELLED from PREPARING / READY | food was cooked → **WASTE** (reason `CUSTOMER_RETURN`… or a new `CANCELLED_ORDER` reason, D2) linked to the order | `reverse-as-waste`: WASTE movements mirroring the SALE ones, `reversal_of_movement_id` set |
| FAILED (delivery never completed) | as above — cooked food is lost | same |
| REFUNDED (after COMPLETED) | **none** — the food was eaten; money moved, stock did not | no movement; the refund is a finance event |
| Refund of an uncooked, cancelled order | none | already covered by row 1 |

Principle: stock follows the *food*, money follows the *payment*; the two ledgers do not mirror each other. Any reversal is a new movement, never an edit or delete.

---

## 8. Recipe changes and historical orders

- A change is a **new version**; the old version is superseded, never modified. SALE movements point at the version that was current when they were written, and carry their own valuation, so **no recipe or price change ever rewrites a past order's cost** — the same §51 snapshot principle `order_items` already follows for prices.
- Product margin for a period = revenue (net of tax, via `src/lib/pricing`) − Σ SALE `totalCost` for that product's lines in the period.
- "Why did food cost change?" is answerable from `ingredient_prices.effectiveFrom` and `recipe_versions.createdAt`.

---

## 9. Food cost — two numbers, one source each

Today the P&L's food cost is **DIRECT expenses ÷ revenue**. Inventory introduces a second, better number — **theoretical cost = Σ SALE movements**. Both are useful; they must not be confused or double-counted:

- **Recommended (D7):** receiving a purchase order writes the matching `expenses` row (DIRECT, supplier, account). The P&L keeps its single expense-based definition and simply stops needing manual entry for stock purchases. Consumption-based cost becomes a new metric, labelled "theoretical food cost", shown alongside "actual (purchases) food cost"; the gap is **variance** (waste, over-portioning, theft, uncounted use). Nothing in `expenses.ts` changes.

---

## 10. Smart 86 hook (read-only)

`inventoryAvailability(productId)` graduates from `"unknown"` to a computed risk: for the current version's lines, `quantityOnHand ÷ quantity per portion` = portions possible; below a threshold → "at risk", with the limiting ingredient named. **It never changes availability** — the existing manual `productAvailability` workflow stays the only write. Needs consumption to be live first, otherwise on-hand is fiction.

---

## 11. Multi-location

Already shaped for it (`inventory_items` and movements per location, `orders.locationId`). v1 resolves the single active location the way `getDeliverySettings` already does; no `locationId` is hardcoded, so a second outlet is a loop, not a redesign (D11).

---

## 12. Recommended sequence (each a reviewable slice)

1. **Migration** — `recipe_versions`, the columns and index in §2. Additive, tables empty. *(Approval D13.)*
2. **Master data** — suppliers, ingredients, price records: repository + actions + screens under Inventory.
3. **Recipes** — versioned recipe editor inside the Menu Control Center, replacing today's status-only section; "products without a recipe" list.
4. **Purchasing** — PO create/order/receive → PURCHASE movements + expense row.
5. **Stock** — on-hand, value at cost, low stock (`reorderThreshold`), movements ledger; waste and adjustments.
6. **Consumption** — the PREPARING hook, reversals, reconcile action, "orders with no consumption" report.
7. **Food cost** — theoretical vs actual, variance; product margin (with the net-of-tax path — the Menu Engineering second half).
8. **Smart 86** — read-only risk flag on products and the KDS.

---

## 13. Decisions requiring approval

| # | Decision | Recommendation |
|---|---|---|
| D1 | Consumption trigger status | **PREPARING** (alternatives: ACCEPTED, COMPLETED) |
| D2 | Cancel/fail after cooking → waste reason | reuse `CUSTOMER_RETURN` vs add `CANCELLED_ORDER` to the enum — **add the reason** (one enum value, additive) |
| D3 | Recipe versioning shape | `recipe_versions` table + `version_id` on `recipe_items` + `current_version_id` on `recipes` |
| D4 | Modifier ingredients | **defer to v1.1**; design the table now |
| D5 | Stock-count sessions | **defer**; v1 = ADJUSTMENT with required note |
| D6 | `purchase_orders.status` | keep text, **add check constraint** (no enum migration) |
| D7 | Purchases and the P&L | **PO receipt writes the DIRECT expense row**; P&L definition unchanged; theoretical cost is a new, separately labelled metric |
| D8 | Master-data permission | **reuse `purchasing.manage`**; no new permission |
| D9 | Consumption failure policy | **non-blocking** + reconcile action; never inside `advanceOrder` |
| D10 | Valuation | **current rate at movement time**, not FIFO |
| D11 | Locations in v1 | first active location, resolved not hardcoded |
| D12 | `kdsStation` / `prepMinutes` | **untouched**; decide the station model once, for KDS and consumption together |
| D13 | Authorise the migration in §2 | the only schema change in this proposal |
