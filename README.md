# FRYBIRD IQ

Restaurant operating platform for FRYBIRD — a QSR fried-chicken brand in
Sector 9, Ambala City. Customer ordering, web POS, kitchen display, inventory
and food costing, owner analytics, and an AI layer over all of it.

Specification: [`BUILD-PLAN.md`](BUILD-PLAN.md).
Working agreement: [`CLAUDE.md`](CLAUDE.md).
Design source of truth: [`design-system/MASTER.md`](design-system/MASTER.md).
Deployment: [`docs/DEPLOY.md`](docs/DEPLOY.md) — Hostinger VPS, WordPress on the
apex domain and the ordering app on `order.frybird.in`.

## Setting up staff access

There is no sign-up. Create the account, then grant it a role:

1. Supabase dashboard → **Authentication → Users → Add user**. Set an email and
   password, and tick "Auto Confirm User".
2. Grant the role:

   ```bash
   pnpm staff:grant you@example.com OWNER
   ```

Roles: `OWNER`, `ADMIN`, `MANAGER`, `CASHIER`, `KITCHEN`, `RIDER`,
`INVENTORY`, `ANALYST`. A cashier can take payment and discount but not refund;
a manager can edit the menu but not reprice it; a rider can only see deliveries
and close them. See `src/domain/permissions.ts`.

A rider signs in at `/sign-in` like any staff member and lands on
`/app/deliveries` — the counter screen would bounce them, since they hold no
`orders.view`.

Then sign in at `/sign-in`. Without a membership row an authenticated user is a
stranger with an account — the staff area stays shut.

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
| `pnpm order:verify` | Print the most recent order straight from Postgres |
| `pnpm order:settle` | Take cash on the most recent unpaid order |
| `pnpm staff:grant <email> <role>` | Give a Supabase user a role in the org |
| `pnpm staff:check <email>` | Check a granted role will resolve at sign-in |
| `pnpm delivery:show` | Show the outlet's location and delivery rates |
| `pnpm delivery:set` | Set them (km and rupees) |
| `pnpm delivery:quote` | What each distance costs, against live settings |
| `pnpm customers:export` | Export the opted-in marketing list as CSV |
| `pnpm loyalty:show` / `loyalty:set` | The points scheme |
| `pnpm loyalty:balances` | Balances and the movements behind them |
| `pnpm business:show` / `business:set` | Legal name, GSTIN, phone on documents |
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

- [ ] **Verify a phone number before linking an account to it.** Sign-up links
      an unclaimed guest customer record by phone, which is how someone gets
      their past orders. "Unclaimed" currently means "nobody has signed up with
      it yet", not "belongs to the person typing it" — so someone who knows
      another customer's number could sign up with it first and see that
      person's order history and delivery addresses. An OTP on sign-up closes
      this. It needs an SMS provider and DLT registration, the same dependency
      as marketing SMS.

- [ ] **Confirm the road factor.** The bands are FRYBIRD's own, but they are
      charged on *estimated road distance* — straight-line × 1.3 — not on what
      an odometer would read. A customer 2.4 km away in a straight line is
      estimated at 3.1 km and charged ₹30, when the real road distance might be
      2.7 km and free. Adjust with `pnpm delivery:set --road-factor 1.2`, or set
      it to 1.0 to charge on straight-line distance.
- [ ] **Drink SKUs and MRPs** — *blocks the POS.* The board says only "Drinks
      Available at MRP Price Only". No SKUs, no sizes, no brands. Three combos
      contain a cola that has no product to point at; they price correctly but
      their food cost is short by the drink. Being collected from the outlet.

### Before Phase 9 (food cost and margin)

- [ ] **Ingredient costs, recipes and yields.** The recipe PDFs in Downloads are
      the likely source. This is the last thing standing between the menu and a
      real margin per product.
- [ ] **Packaging cost per item.**

### Before issuing a tax invoice

- [ ] **GSTIN, if and when FRYBIRD registers.** Documents are currently issued
      as receipts with no CGST/SGST split, because a business without a GSTIN
      cannot collect GST and a receipt showing a tax line asserts that it did.
      Adding one with `pnpm business:set --gstin ...` turns every future
      document into a full tax invoice with no code change. The tax figures are
      already computed and stored on each order; only printing them waits.
      Turning the rate back on is the same command.

### Before sending any marketing

- [ ] **DLT registration for SMS.** Commercial SMS in India goes through DLT —
      the sender header and message template must be registered, and
      unregistered commercial SMS is blocked by the operators rather than
      merely discouraged.
- [ ] **A working way to opt out**, and something that honours it. The customer
      record has `marketing_consent` and `deletion_requested_at`; nothing yet
      reads them except the export, and nothing lets a customer change their
      mind without ringing the shop.
- [ ] **WhatsApp Business API**, if sending should ever be automatic. Today the
      button opens WhatsApp with the message written and a person presses send,
      which needs no API and no template approval. Automating it does.
- [ ] **A privacy notice** saying what is collected and why. Email is now
      required to order; using it to advertise is a separate purpose and the
      consent box is what makes that lawful.

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
- [x] **No GST is charged.** FRYBIRD is not GST registered, so products are
      zero-rated and nothing computes, prints or claims a tax. A ₹89 item is
      ₹89 of revenue. `pnpm business:set --gst 5 --gstin <GSTIN>` turns it back
      on if that changes; the machinery and its tests are untouched.
- [x] **Menu prices were GST-inclusive.** Confirmed against a real counter bill.
      The board price is the final price: a ₹99 burger takes ₹99 and books
      ₹94.29 of revenue against ₹4.71 of GST payable. `price_basis` is
      `inclusive`; both modes remain covered by tests, and `gst()` now requires
      the basis rather than defaulting, so no caller can silently fall back to
      the wrong one.
- [x] **Invoices.** Numbered per financial year, issued on payment, with the
      GST breakdown per line. Printable; `Send on WhatsApp` opens the app with
      the order details written.
- [x] **Customer accounts.** Self-serve sign-up, order history, and a points
      balance. Guest checkout still works — §61 says not to force an account
      before a first order.
- [x] **Loyalty.** 5% back as points, one point is ₹1, no minimum to spend.
      Points are awarded when payment arrives, not when an order is placed, and
      earned on the food rather than the delivery fee.
- [x] **Staff sign-in.** Email and password via Supabase Auth, no public
      sign-up — a counter account is not something a stranger should be able to
      mint. `/app/*` is gated in a Server Component, and every action re-checks
      its own permission, because rendering a screen is not authorization for
      the actions on it.
- [x] **Delivery rates.** Free under 3 km, ₹30 from 3 to 5 km, ₹30 plus ₹10 per
      started km from 5 to 8 km, nothing beyond 8. Set as distance bands on the
      outlet; `pnpm delivery:show` prints the table.
- [x] **Direct orders only.** No Swiggy, no Zomato, no commission, no
      settlement. `orders.channel` records dine-in, takeaway or online for the
      revenue split, and `margin()` is revenue net of tax minus cost. A
      deliberate departure from BUILD-PLAN.md §43 and §75 — adding an
      aggregator later means a commission model and a revisit of every revenue
      figure, not a wider enum.

## Status

**Phase 0 complete** — design foundation, financial core, domain model, schema.

**Phase 1 in progress** — the customer ordering slice. Home, menu, product
customization, cart and checkout are built and walk end to end in the browser.

**Connected and verified against a live database.** Migrations applied, menu
seeded, and order #001 placed end to end — ₹299 for Nashville wings at 8 pc,
matching the printed board, stored with ₹284.76 revenue and ₹14.24 GST that
reconcile exactly.

Still outstanding:

- **Cash on collection is live.** Checkout records a pending `cash/CASH`
  payment; settling it moves the order to PAID, books the money once, and
  writes an audit row. Online payment slots in behind the same
  `PaymentProvider` interface without touching order logic.
- **The counter screen is live** at `/app/orders`. A cashier signs in, sees
  open orders, takes cash, and moves tickets through accepted → cooking →
  ready → collected. Every action is permission-checked server-side.
- **Orders do not appear on their own yet.** Realtime is Phase 3; the list says
  so rather than looking live and silently not being.
- **Realtime is Phase 3.** The tracking page reflects status at page load. It
  does not pretend to be live.
