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
src/domain/     order lifecycle, order sources, roles and permissions
src/lib/money/  integer-paise arithmetic and INR formatting
src/lib/tax/    GST — CGST/SGST split, inclusive and exclusive pricing
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

## What the menu does not include

`src/db/menu-data.ts` exports `KNOWN_GAPS`. Nothing in it is guessed — where
the boards do not state a figure, the field is absent. Two of them block later
phases:

**Drink prices.** The board says only "Drinks Available at MRP Price Only".
No SKUs, no sizes. The POS cannot ring up a drink until these exist, and three
combos contain a cola that has no product to point at.

**Whether menu prices include GST.** Seeded as exclusive, matching standard QSR
billing where 5% is added at the till. If FRYBIRD's printed prices are already
GST-inclusive, every total is wrong by 5% — confirm before Phase 2.

## Status

Phase 0 complete: design foundation, financial core, domain model, schema.
Phase 1 next: the customer ordering slice, per `BUILD-PLAN.md` §73.
