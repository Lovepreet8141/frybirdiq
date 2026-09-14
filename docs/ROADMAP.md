# FRYBIRD IQ — Roadmap to a fully functional restaurant system

Written 14 September 2026 from the status report of the same date (`kit-radix-nova` @ `9078863`, ~50% of the vision, ~85% of the V1 loop). This is the build order. `docs/VISION.md` and `BUILD-PLAN.md` say what the product should become; this says what gets built next, in what order, and what "done" means for each step.

**Rules that apply to every phase**

- Done means deployed and working on **frybirdiq.tech**, never localhost. Every phase ends with a live check listed under *Done when*.
- Every write path is gated server-side by an existing or additive permission, and lands an `audit_logs` or `order_events` row.
- Money stays in integer paise, computed on the server. No UI ever calculates an authoritative total.
- One source of truth per domain. No second pricing, payment, order or menu system.
- No schema change without a migration and a reason in the commit message. No demo data in production.
- Commit and deploy after each verified slice. Ask before pushing.

---

## Phase 0 — Stabilise (2–3 days)

Nothing else is safe until this is done. Most of it is configuration, not code.

| # | Slice | Done when |
|---|---|---|
| 0.1 | Push `kit-radix-nova` and fast-forward `main` | `git status` shows no "ahead"; GitHub `main` = deployed commit |
| 0.2 | Error monitoring — Sentry (free tier) via `instrumentation.ts`, DSN in `.env`, source maps uploaded by `deploy.sh` | A deliberate `throw` on a staff route appears in Sentry within a minute, with the stack trace mapped to source |
| 0.3 | Supabase Auth: Site URL → `https://frybirdiq.tech`, Redirect URLs → `https://frybirdiq.tech/**` | A new signup's confirmation email opens the live site, not localhost |
| 0.4 | Custom SMTP in Supabase (Resend or Brevo) — the built-in sender already hit its rate limit | Ten signups in a row all receive mail |
| 0.5 | Close the two dormant-permission leaks: promotion writes on `settings.manage` (not `orders.discount`); expense writes on `finance.view` (not `analytics.view`) | A CASHIER login cannot create a promotion; an ANALYST cannot record an expense |
| 0.6 | Drop dead dependencies (`@base-ui/react`, `react-hook-form`, `@hookform/resolvers`, `date-fns`); update `FRYBIRD-COMPONENT-MIGRATION.md` to radix-nova | `pnpm build` green, lockfile smaller |
| 0.7 | Backups: nightly `pg_dump` from the VPS to Supabase-external storage (or Supabase PITR on the paid tier) | A restore into a scratch database has been done once |

**Decisions needed:** none.

---

## Phase 1 — Take money online: Razorpay + refunds (5–7 days)

The only hole in the customer loop. Also the first refund write path, which finance, POS and delivery all need.

| # | Slice | Done when |
|---|---|---|
| 1.1 | `razorpayProvider` behind the existing `PaymentProvider` interface — `createIntent` makes a Razorpay Order for the order's `grandTotal`; `capture` verifies the signature | Unit tests for signature verification pass with a recorded fixture |
| 1.2 | Checkout: UPI / card / netbanking via Razorpay Checkout; cash-on-delivery stays; `availableMethods()` returns both | A ₹1 test order is paid by UPI on the live site and the order moves to PAID |
| 1.3 | Webhook `/api/payments/razorpay/webhook` — verified, idempotent on `webhook_events` (table exists, unused), calls the same `recordPayment` path cash uses | Replaying the same webhook twice records one payment |
| 1.4 | Refund write path — `refunds` row, provider refund call for online, cash-refund record for counter; gated on `orders.refund`; audit row | A refund from `/app/finance` shows in Razorpay's dashboard and in the ledger |
| 1.5 | Order status page: "Paid" / "Payment failed — retry" states; failed payment never leaves a phantom PAID order | Abandoning Razorpay Checkout leaves the order PENDING with a retry button |

**Decisions needed:** Razorpay live keys (you); whether COD stays available for online orders (default: yes, under a per-order cap set in restaurant settings).

---

## Phase 2 — Realtime (3–4 days)

Nine polling loops today. One realtime layer serves the orders board, KDS, deliveries, and the customer's tracking page.

| # | Slice | Done when |
|---|---|---|
| 2.1 | Supabase Realtime channel on `order_events` (one channel, org-scoped, staff-authenticated); a `useOrderEvents` hook that invalidates the affected view | Order placed on a phone appears on `/app/orders` in under 2 s with no refresh |
| 2.2 | Replace polling: orders board, KDS, deliveries, POS menu poll (keep a 60 s fallback poll for dropped sockets) | `grep -r setInterval src` shows only the fallback |
| 2.3 | Customer tracking page `/order/[id]` goes live-updating | Status changes on the KDS reach the customer's screen without reload |
| 2.4 | New-order alert (chime) and KDS sound driven by the channel, not the poll | Alert fires within 2 s of placement |

**Decisions needed:** none.

---

## Phase 3 — Inventory core (6–8 days)

Highest value per hour left in the product: eleven tables, the costing library and the architecture proposal already exist. This turns "food cost" from a typed-in number into a measured one.

| # | Slice | Done when |
|---|---|---|
| 3.1 | Recipe line editor on the product page (`recipe_items`, versioned on save into `recipe_versions`); gated `recipes.edit` | Nashville Burger has a recipe with 6+ lines and a theoretical cost on `/app/iq/products` |
| 3.2 | Stock movements: receive (with supplier price → `ingredient_prices`), adjust, count; on-hand derived from movements; gated `inventory.adjust` | Receiving 10 kg chicken shows 10 kg on hand; a count of 9.4 kg writes a −0.6 kg adjustment |
| 3.3 | Waste log: ingredient, qty, reason (enum exists), who, when, cost; gated `inventory.waste`; KITCHEN can use it | A waste entry appears on the ingredient's movement history and in the week's waste total |
| 3.4 | Consumption on order — one movement batch per order at the agreed status, reversed on cancel/refund; **D7: never double-count** (idempotent on order id) | Completing an order with 2× Nashville Burger reduces chicken by exactly 2× the recipe qty; completing it twice does not |
| 3.5 | Actual vs theoretical food cost on `/app/iq/pnl` — two numbers, one source each | The P&L shows theoretical (recipes × sales) and actual (movements) side by side with variance |
| 3.6 | Smart 86 read-only: projected stockout time per ingredient from the last 7 days' velocity; affected products listed; **recommends**, never changes availability | Chicken at 6 kg with 7.8 kg projected shows "short around 20:45" and the four affected products |
| 3.7 | Purchase orders: draft → sent → received (receiving creates the 3.2 movement); gated `purchasing.manage` | A PO received in full lands stock and updates the supplier price |

**Decisions needed (before 3.4):** which order status triggers consumption — recommend **ACCEPTED** for kitchen prep truth, reversed on REJECTED/CANCELLED. Low-stock threshold — recommend days-of-cover (2 days) rather than a fixed quantity.

---

## Phase 4 — Kitchen: targets, stations, expo (4–5 days)

Needs Phase 2. Turns the single ticket board into a kitchen system.

| # | Slice | Done when |
|---|---|---|
| 4.1 | Prep targets from `products.prep_minutes`; ticket target = max over lines; "nearly late" at 80% of target, late at 100% | A ticket turns amber at 80% and red at 100% of its target on the live KDS |
| 4.2 | Stations — `stations` table + `products.station` (default from category); tickets split per station; one board per station, one expo board that shows a ticket only when every station has bumped | FRY and ASSEMBLY screens each show only their lines; expo shows the whole order once both are done |
| 4.3 | Order Health on `/app/iq/live`: GREEN / AMBER / RED from the 4.1 rule; count of each on the Command Center | The Command Center's "orders past promised time" becomes a three-state health strip |
| 4.4 | Kitchen analytics: prep time p50/p90 per product and per hour, from `order_events` | `/app/iq/kitchen` shows the slowest five products this week |

**Decisions needed (before 4.2):** station list — recommend **FRY · ASSEMBLY · DRINKS · PACK** with EXPO as the combined view; routing by category with per-product override.

---

## Phase 5 — Cash & finance (4–5 days)

Needs Phase 1 (refunds) and the payments ledger.

| # | Slice | Done when |
|---|---|---|
| 5.1 | Cash sessions: open (float), all cash payments attach to the open session, close (counted cash, expected cash, variance, who); gated `finance.view` to see, new additive `finance.manage` to open/close | Closing a session with ₹20 short records the variance against the cashier |
| 5.2 | Rider cash handover into the session | A rider's door cash appears as expected cash in the counter's session |
| 5.3 | Reconciliation view: sessions vs ledger vs Razorpay settlements by day | One screen shows yesterday's cash, online, refunds and net |
| 5.4 | Exports (CSV): orders, payments, expenses, GST summary; gated `reports.export` | A month's payments download opens in Excel with paise as rupees |
| 5.5 | Restaurant settings: profile, hours, GST view (read-only until registered), COD cap, payment methods on/off | Changing opening hours changes what the website shows within a minute |

**Decisions needed:** none technical. Whether FRYBIRD is going to register for GST — if yes, the engine flips with `pnpm business:set --gstin`; the UI should show the switch, not hide it.

---

## Phase 6 — People (3–4 days)

Replaces the CLI as the only way to give someone a login.

| # | Slice | Done when |
|---|---|---|
| 6.1 | Staff invite by email → Supabase Auth invite → membership with role; deactivate; role change; all on `staff.manage`; audit rows | A new cashier receives an invite, sets a password, and sees only the POS and orders |
| 6.2 | Roles & permissions matrix page (read-only view of `domain/permissions.ts`) | A manager can see who can refund without reading code |
| 6.3 | Rider assignment: `orders.rider_id`, assign from the orders board, rider sees only their deliveries; FAILED delivery with reason in the deliveries UI | Two riders logged in see disjoint lists; a failed delivery is recorded, not lost |
| 6.4 | Shifts (basic): clock-in / clock-out tied to cash session open/close | A shift summary shows hours and cash for the person |

**Decisions needed:** CASHIER gets `kitchen.update`? — recommend **yes**, single-person shifts are real at a one-counter shop.

---

## Phase 7 — Customers & messaging (3 days)

| # | Slice | Done when |
|---|---|---|
| 7.1 | Customer edit and notes; gated `customers.edit` | A wrong phone number can be corrected without SQL |
| 7.2 | Order-status notifications via WhatsApp Business API (fallback SMS): accepted, ready, out for delivery | A customer gets a WhatsApp message when the KDS bumps their order to READY |
| 7.3 | Promotions measurement: uses, revenue, discount cost, AOV per promotion on `/app/customers/promotions` | Each promo shows what it cost and what it brought in |
| 7.4 | Stamp rules confirmed and exposed in `/app/iq/rewards` (what earns a stamp, what the 8th order gives) | The rule on the website matches the rule in the engine |

**Decisions needed:** stamp rules (open since August). WhatsApp provider (Interakt / Gupshup / Meta direct).

---

## Phase 8 — Design completion (3–4 days, interleave anywhere)

No dependencies. Slot single screens between phases rather than as a block.

Still on the old style: Deliveries page and card · Expenses list and new-expense form · every Menu sub-page (categories, combos, media, modifiers, product new/edit, review) · Rewards page · Restaurant settings · POS payment sheet and rewards keypad · order card and new-order alert · old `overview-kpis`.

Then: IQ dark theme (staff area default per the visual reference; light stays the toggle), amber accent not magenta.

**Done when** `grep` finds no old heading/back-link pattern and every staff route renders in both themes with the contrast check passing.

---

## Phase 9 — Driver app (5–7 days, after 2 and 6)

Prototype review first: offer-vs-assign, delivery code yes/no, photo proof yes/no, stop ordering. Then: real jobs from `orders` with `rider_id`, GPS position posted every 15 s while on a job, customer live map on `/order/[id]`, proof of delivery (photo or code), background location as a PWA.

**Done when** a customer watches the rider approach on the tracking page and the rider's cash lands in the session.

---

## Phase 10 — Offline POS (4–5 days)

PWA manifest + service worker; order queue in IndexedDB when offline; sync with the same idempotency keys on reconnect; menu cached per shift.

**Done when** the router is unplugged mid-shift, three orders are rung up, and all three appear once it's back, none duplicated.

---

## Phase 11 — Analytics expansion & AI (after 3, 4, 5)

Customer analytics (cohorts, inactive customers), waste and variance analytics, forecasting (next-day chicken need from the last 4 weeks), then Daily Brief and Ask FRYBIRD over the real tables — facts, forecasts and recommendations labelled as such, no action without a human tap.

**Done when** "How much chicken do we need tomorrow?" answers with a number and the evidence behind it.

---

## What "fully functional" means, in order of arrival

| Milestone | After phase | The restaurant can… |
|---|---|---|
| **Customer loop closed** | 1 | take an online order, get paid by UPI, refund it |
| **Live operations** | 2 | see orders arrive without refreshing, on every screen |
| **Measured food cost** | 3 | know actual vs theoretical cost and what's about to run out |
| **Kitchen system** | 4 | run FRY and ASSEMBLY as stations with real prep targets |
| **Cash accountable** | 5 | close a drawer and know who was short |
| **Self-managed** | 6 | onboard a cashier without a terminal |
| **Customer-facing complete** | 7 | message customers and measure promotions |
| **Operating system** | 9–11 | track riders, survive an outage, ask the data questions |

Rough total: **10–12 weeks** of the current build cadence for phases 0–7; phases 9–11 add 4–5 more. Phases 0–2 are the ones to finish before the next busy weekend.

---

## Decisions you owe (each blocks one slice)

1. Razorpay live keys → 1.2
2. COD allowed online, and the cap → 1.2
3. Consumption trigger status (recommend ACCEPTED) → 3.4
4. Station list (recommend FRY · ASSEMBLY · DRINKS · PACK) → 4.2
5. GST registration intent → 5.5
6. CASHIER gets `kitchen.update` (recommend yes) → 6.1
7. Stamp rules: what earns one, what the 8th gives → 7.4
8. WhatsApp provider → 7.2
9. Driver prototype review: offer vs assign, code, photo → 9
10. Food cost target (28–32% is the QSR norm) → P&L target line
