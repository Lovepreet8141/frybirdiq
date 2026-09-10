# FRYBIRD IQ

Restaurant operating platform for FRYBIRD — a QSR fried-chicken brand in
Sector 9, Ambala City. Customer ordering, web POS, kitchen display, inventory
and food costing, owner analytics, and an AI layer over all of it.

Specification: [`BUILD-PLAN.md`](BUILD-PLAN.md).
Working agreement: [`CLAUDE.md`](CLAUDE.md).
Design source of truth: [`design-system/MASTER.md`](design-system/MASTER.md).

## Getting started

```bash
pnpm install
cp .env.example .env.local   # then fill in your Supabase keys
pnpm dev
```

The app runs without Supabase — the foundation page reports that the database
is not connected rather than crashing. Ordering needs a real project.

Once `.env.local` has `DATABASE_URL`:

```bash
pnpm db:migrate
pnpm db:seed
```

`db:seed` loads the real menu — 33 products, 6 combos, 7 sauces, and the
chicken size/heat modifiers — transcribed in
[`src/db/menu-data.ts`](src/db/menu-data.ts). It refuses to run against an org
that has already taken orders unless you pass `--force`.

## Commands

| Command | Does |
|---|---|
| `pnpm dev` | Dev server on :3000 |
| `pnpm build` | Production build |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest over `src/lib` and `src/domain` |
| `pnpm db:generate` | Generate a migration after a schema change |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:seed` | Seed FRYBIRD's real menu from the printed boards |
| `python3 scripts/check-contrast.py` | WCAG check on the brand palette |

## Where things are

```
src/domain/     order lifecycle, channels, roles and permissions
src/lib/money/  integer-paise arithmetic and INR formatting
src/lib/tax/    GST — CGST/SGST split, inclusive and exclusive pricing
src/lib/pricing/ the one path from a menu price to totals and margin
src/db/schema/  42 tables, split by domain
supabase/       migrations, including hand-written row-level security
design-system/  tokens, motion, interaction, accessibility, content
```

## Two things that will bite you

**Money is never a float.** Amounts are integer paise in a `bigint`. Use
`src/lib/money`; nothing else formats currency, and `formatINR` is the only
thing that produces a `₹`.

**Currency is rupees, not euros.** `BUILD-PLAN.md` quotes `€` throughout — it
was drafted from a template. Every figure in it means INR.

## Open questions

Open decisions that block later phases. Nothing on this list is guessed —
where the menu boards do not state a figure, the field is absent from
[`src/db/menu-data.ts`](src/db/menu-data.ts) rather than filled with a
plausible number.

Tick an item when the real value is in the repo, not when the answer is known.

### Blocking

- [ ] **Do menu prices include GST?** — *blocks Phase 1 and 2.* Seeded as
      `exclusive`, matching standard QSR billing where 5% is added at the till.
      A ₹99 burger rings up at ₹103.95 and earns ₹99. If FRYBIRD's printed
      prices are already GST-inclusive it rings up at ₹99 and earns ₹94.29 —
      a difference of the tax rate on every order, moving revenue, food cost
      percentage and margin together. One value to change:
      `organizations.price_basis`. Both modes are covered by tests.
- [ ] **Drink SKUs and MRPs** — *blocks the POS.* The board says only "Drinks
      Available at MRP Price Only". No SKUs, no sizes, no brands. Three combos
      contain a cola that has no product to point at; they price correctly but
      their food cost is short by the drink. Being collected from the outlet.

### Before Phase 9 (food cost and margin)

- [ ] **Ingredient costs, recipes and yields.** The recipe PDFs in Downloads are
      the likely source. This is the last thing standing between the menu and a
      real margin per product.
- [ ] **Packaging cost per item.**

### Before the menu is public

- [ ] **Allergen data per product.** §33 requires allergen answers to be
      grounded in restaurant-managed data. Guessing these is a safety issue,
      not a data-quality one.
- [ ] **GSTIN and registered legal name.** Required on every tax invoice.
      Currently null on the organization.
- [ ] **Food photography.** The single largest gap in how the brand reads, and
      no amount of code closes it.

### Settled

- [x] Menu transcribed from the four printed boards — 33 products, 6 combos,
      7 sauces, and chicken size/heat modifiers verified against the printed
      price matrix.
- [x] GST basis made a single configurable value on the organization rather
      than a per-product column.
- [x] **Direct orders only.** No Swiggy, no Zomato, no commission, no
      settlement. `orders.channel` records dine-in, takeaway or online for the
      revenue split, and `margin()` is revenue net of tax minus cost. A
      deliberate departure from BUILD-PLAN.md §43 and §75 — adding an
      aggregator later means a commission model and a revisit of every revenue
      figure, not a wider enum.

## Status

Phase 0 complete: design foundation, financial core, domain model, schema.
Phase 1 next: the customer ordering slice, per `BUILD-PLAN.md` §73.
