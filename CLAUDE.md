# FRYBIRD IQ

Read `BUILD-PLAN.md` before anything else. It is the specification; this file
is the working agreement.

FRYBIRD IQ is one platform: a customer ordering website, a touchscreen web POS,
a kitchen display, inventory and food costing, and an owner analytics layer
with an AI on top. One brand, one data model.

FRYBIRD is a QSR fried-chicken brand in Sector 9, Ambala City, Haryana. Single
owner-operator, one location, architected for more.

---

## Non-negotiable rules

**Money is integer paise in a `bigint`.** Never `float`, never `numeric` in app
code. All arithmetic happens in `src/lib/money`; formatting to `₹` happens only
at the render boundary through `formatINR`. Nothing else formats currency.

**Currency is INR only.** `Intl.NumberFormat('en-IN')`, so grouping is Indian —
₹9,40,000, never ₹940,000. Paise show only on unit costs (₹33.50 per portion);
round to whole rupees at business scale. BUILD-PLAN.md quotes € throughout —
those are placeholders from the template it was drafted from, and every one of
them means rupees here.

**Never trust the client for money or authorization.** The client sends items,
not totals. The server recalculates every figure and checks every permission.
Hiding a button is not authorization (§41).

**Every mutation that matters is idempotent.** A retried request must not
create a second order or a second charge. §17.

**Channel is a first-class dimension.** Dine-in, takeaway, Swiggy and Zomato
have different prices, different commissions and different true margins on the
same product. A calculation that ignores `orders.source` is wrong.

**GST is not optional.** Every sale computes CGST/SGST per line at that line's
rate, carries an HSN/SAC code, and prints the org's GSTIN. `src/lib/tax/gst`
owns this. Tax is never computed once on an order total.

**Whether prices include GST is one value.** `organizations.price_basis`. Every
price, invoice line and margin figure reads it through `src/lib/pricing` and
none of them decide for themselves. Do not add a basis column, prop, argument
or constant anywhere else — the two modes differ by the tax rate on every
total, so a second source of truth is silent revenue error. Anything that
computes a margin takes net-of-tax revenue: GST is collected for the
government and is never revenue.

**The AI never invents a number.** Prices, availability, allergens, hours and
order status come from stored rows through server-side tools. If the data is
missing, it says so. §33.

**Price snapshots are immutable.** Order lines copy the name, price and tax
rate at the time of sale. Changing today's menu price must never rewrite
yesterday's order. §51.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16, App Router, TypeScript strict |
| Styling | Tailwind CSS v4 + shadcn/ui on Base UI primitives |
| Motion | Motion for React |
| Icons | Lucide |
| Database | Supabase Postgres, row-level security on `org_id` |
| ORM | Drizzle |
| Auth | Supabase Auth |
| Realtime | Supabase Realtime |
| Validation | Zod, at every boundary |
| Payments | Razorpay behind a `PaymentProvider` interface |
| Tests | Vitest |
| Package manager | pnpm |

`tsconfig` runs `strict` plus `noUncheckedIndexedAccess`. Both stay on.

---

## Repo shape

```
src/
  app/            routes
  components/ui/  shadcn primitives
  domain/         order lifecycle, sources, permissions — pure, tested
  lib/
    money/        paise arithmetic + INR formatting — single source of truth
    tax/          GST
    pricing/      listed price → what the customer pays and what we earn
    env/          Zod-validated environment
    supabase/     browser, server and admin clients
  db/
    schema/       Drizzle, split by domain
design-system/    MASTER.md is the source of truth for anything visual
supabase/
  migrations/     generated + hand-written RLS
scripts/
```

`src/domain/` and `src/lib/` are pure TypeScript with no React, Next or DB
imports. Every function there has a test. This is the part that must be right.

---

## Working conventions

- Server Components by default. `"use client"` only for charts, forms and local
  interaction state.
- UI components never query the database. They call the repository layer. §3.
- Zod schema at every boundary: form input, API payload, webhook, AI response,
  CSV row.
- One migration per schema change, checked in. Never edit an applied migration.
- Before creating a component, search this repo, then shadcn, then 21st.dev.
  Reuse or extend first. §67.
- Read `design-system/MASTER.md` before any UI work, and the page spec in
  `design-system/pages/` if one exists.
- Every interactive feature ships all eight states in §56 — including `offline`
  and `permission denied`.

## Commands

```bash
pnpm dev            # dev server
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm test           # vitest
pnpm db:generate    # drizzle-kit generate, after a schema change
pnpm db:migrate     # apply migrations
python3 scripts/check-contrast.py   # after any colour change
```

Run `pnpm typecheck && pnpm lint && pnpm test` before considering work done. A
change to a calculation without a change to its test is incomplete.

## Build order

Follow `BUILD-PLAN.md` §73. Do not skip ahead. Phase 1 must let a real customer
place a real order end to end before POS work begins.

Current phase: **0 — design and architecture.**

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
