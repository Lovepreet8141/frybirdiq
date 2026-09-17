# FRYBIRD IQ — Roadmap to a fully functional restaurant system

Written 14 September 2026 from the status report of the same date (`kit-radix-nova` @ `9078863`, ~50% of the vision, ~85% of the V1 loop). This is the build order. `docs/VISION.md` and `BUILD-PLAN.md` say what the product should become; this says what gets built next, in what order, and what "done" means for each step.

**Reconciled 17 September 2026** against the live build (`86de133`, release 0 in `docs/RELEASES.md`) and code at `kit-radix-nova` @ `cb2bd04`. The 10 commits between them (`ord-2`, `ord-3`, `pay-4`, `pay-6`, `fin-4`, the IST business-date fix and the release record) harden Phase 1 and 5 paths; they are **not live** and add no new slice. Every Done-when that needed a production order, payment, refund, cash record, signup or restore has been rewritten (see *Production safety* below).

**Status column**

- **LIVE** — the slice's code is in the live build `86de133` and does what the slice says. The worked example in *Done when* may still be owed a walk-through; the status note says so.
- **PARTIAL** — some of the slice is live, or the code is live but switched off or incomplete in production.
- **NOT STARTED** — no code for the slice in the live build.
- **UNKNOWN** — the slice is configuration outside the repository and has no recorded evidence either way.

**Rules that apply to every phase**

- Done means deployed and working on **frybirdiq.tech**, never localhost. Every phase ends with a check listed under *Done when*.
- Every write path is gated server-side by an existing or additive permission, and lands an `audit_logs` or `order_events` row.
- Money stays in integer paise, computed on the server. No UI ever calculates an authoritative total.
- One source of truth per domain. No second pricing, payment, order or menu system.
- No schema change without a migration and a reason in the commit message. No demo data in production.
- Commit after each verified slice. Pushing `kit-radix-nova` and `agent/*` follows the standing authorization in hive `ORG.md` §7; deploy only after the owner approves.

**Production safety — how a Done-when is proven**

- **Never** create, place, pay, cancel or refund a test order in production, and never create a test signup, test cash record or restore against production to prove a slice (hive `ORG.md` §7). Nobody asks the owner to approve one.
- A behaviour that needs an order, payment, refund, cash record or signup is proven in one of three ways, and the Done-when names which:
  1. **Local proof** — the local Supabase stack (`pnpm test:integration`, a local browser walk, mocks or recorded provider fixtures).
  2. **Live, read-only** — observing real business on frybirdiq.tech: a signed-in screen, or a read-only query from the `ORG.md` §8 allowlist. Nothing is created for the check.
  3. **Owner-run** — the owner does the thing in the normal course of business (a real refund, a real invite, a real till close) and the result is then read, not staged.
- "Live" in a Done-when therefore means *observed*, never *staged*.

---

## Phase 0 — Stabilise (2–3 days)

Nothing else is safe until this is done. Most of it is configuration, not code.

| # | Slice | Status (17 Sep) | Done when |
|---|---|---|---|
| 0.1 | Push `kit-radix-nova` and fast-forward `main` | PARTIAL — done once on 14 Sep (`main` → `3bc9b46`); `kit-radix-nova` is now 100+ commits ahead of `origin/main` | `git status` shows no "ahead"; GitHub `main` = deployed commit |
| 0.2 | Error monitoring — Sentry (free tier) via `instrumentation.ts`, DSN in `.env`, source maps uploaded by `deploy.sh` | NOT STARTED — no Sentry code or dependency in `86de133` | A deliberate `throw` on a staff route appears in Sentry within a minute, with the stack trace mapped to source |
| 0.3 | Supabase Auth: Site URL → `https://frybirdiq.tech`, Redirect URLs → `https://frybirdiq.tech/**` | UNKNOWN — Supabase dashboard setting; no record in the repo or progress log | **Owner-run + read-only:** the owner's screenshot of Supabase Auth URL settings shows both values; the next real signup or staff invite the owner makes opens frybirdiq.tech. **Local proof:** auth email links are built from the runtime `SITE_URL` setting, never a `NEXT_PUBLIC_*` build-time value (`src/lib/customer/actions.ts:20`, `src/lib/repositories/staff.ts:65`); with `SITE_URL` unset, Supabase falls back to its dashboard Site URL. No test signup in production |
| 0.4 | Custom SMTP in Supabase (Resend or Brevo) — the built-in sender already hit its rate limit | UNKNOWN — Supabase dashboard setting; no record | **Read-only:** Supabase Auth settings show a custom sender (screenshot, no secrets), and the auth email log shows zero rate-limit errors across the first 7 days of real signups after the switch, with at least 10 real signups in that window (fewer: extend the window). No test signups |
| 0.5 | Close the two dormant-permission leaks: promotion writes on `settings.manage` (not `orders.discount`); expense writes on `finance.view` (not `analytics.view`) | LIVE — `18cd4e0` (expenses on `finance.view`); promotions got their own `promotions.manage` (`src/domain/permissions.ts:61`) | A CASHIER login cannot create a promotion; an ANALYST cannot record an expense |
| 0.6 | Drop dead dependencies (`@base-ui/react`, `react-hook-form`, `@hookform/resolvers`, `date-fns`); update `FRYBIRD-COMPONENT-MIGRATION.md` to radix-nova | LIVE — `903a6fd`; none of the four in `package.json` | `pnpm build` green, lockfile smaller |
| 0.7 | Backups: nightly `pg_dump` from the VPS to Supabase-external storage (or Supabase PITR on the paid tier) | PARTIAL — nightly timer and restore check shipped (`6bbde8a`, `3bc9b46`); dumps live only on the VPS, no offsite copy (`blk-4`, `dec-8`). The progress log records a restore on 14 Sep; `blk-5` records no evidence of one — unresolved | **Read-only (`ORG.md` §8):** the existing restore-check result files show a successful restore (this also settles the progress log vs `blk-5` conflict); the backup timer is active and 7 consecutive nightly dumps are listed; an offsite copy exists for each. **Owner gate, only if no result file exists:** one owner-approved run of the restore check into the VPS scratch database (never the production database), output recorded in `docs/RELEASES.md` |

**Decisions needed:** offsite backup storage and its credentials (`dec-8`).

---

## Phase 1 — Take money online: Razorpay + refunds (5–7 days)

The only hole in the customer loop. Also the first refund write path, which finance, POS and delivery all need.

**Live state:** the code for 1.1–1.5 is in the live build, but production has **no Razorpay keys**, so the site offers cash and COD only and the webhook answers 503. Open payment-audit findings on refunds and settlement (`hive/agents/michael-mu4lr1ro/reports/2026-09-16-payment-baseline.md`) must close before keys go in.

| # | Slice | Status (17 Sep) | Done when |
|---|---|---|---|
| 1.1 | `razorpayProvider` behind the existing `PaymentProvider` interface — `createIntent` makes a Razorpay Order for the order's `grandTotal`; `capture` verifies the signature | LIVE — `b5c1933` | Unit tests for signature verification pass with a recorded fixture |
| 1.2 | Checkout: UPI / card / netbanking via Razorpay Checkout; cash-on-delivery stays; `availableMethods()` returns both | PARTIAL — code live (`276d2aa`); no keys in production, so only cash/COD are offered | **Local proof:** on the local stack with mocks (or Razorpay test-mode keys, owner-provided), a UPI payment moves the order to PAID end to end. **Live, read-only** (after the owner sets live keys): for 7 days, every captured online payment has exactly one PAID order and one `payments` row, and no PAID online order lacks a captured payment, with at least 20 real online payments in the window (fewer: extend it; until then the local proof is the only proof). No test order |
| 1.3 | Webhook `/api/payments/razorpay/webhook` — verified, idempotent on `webhook_events` (table exists, unused), calls the same `recordPayment` path cash uses | PARTIAL — `8d062a9`; route live (`src/app/api/payments/razorpay/webhook/route.ts`), answers 503 without keys | Replaying the same webhook twice records one payment (local proof, recorded fixture) |
| 1.4 | Refund write path — `refunds` row, provider refund call for online, cash-refund record for counter; gated on `orders.refund`; audit row | PARTIAL — `65bfead`; Refund dialog on `/app/finance` live (`src/components/finance/payments-table.tsx:403`); online refunds unreachable without keys; P1 audit findings open (unified refund design pending, `dec-9`, `dec-10`) | **Local proof:** a refund from `/app/finance` against a mocked provider writes one `refunds` row, one ledger entry and one audit row; a double submit writes one refund. **Owner-run + read-only:** each real refund the owner issues in the course of business shows its `refunds` row, audit row and (online) provider refund id, and matches Razorpay's dashboard. No test refund |
| 1.5 | Order status page: "Paid" / "Payment failed — retry" states; failed payment never leaves a phantom PAID order | PARTIAL — retry UI live (`src/components/order/pay-online.tsx:172`), unreachable without keys | **Local proof:** abandoning or failing checkout (mock or test mode) leaves the order PENDING with a retry button. **Live, read-only:** a daily query finds zero PAID orders without a captured payment, counted only once at least 20 real online payments exist (until then the local proof is the only proof). No test order |

**Decisions needed:** Razorpay live keys (you); whether COD stays available for online orders (default: yes, under a per-order cap set in restaurant settings).

---

## Phase 2 — Realtime (3–4 days)

Nine polling loops today. One realtime layer serves the orders board, KDS, deliveries, and the customer's tracking page.

**Live state:** shipped 14 Sep (`688cb85` … `52ec5f5`, migration `0027`, channel fix `1025fc0`). The database side was verified on production; the browser-side "under 2 s" timings were never measured.

| # | Slice | Status (17 Sep) | Done when |
|---|---|---|---|
| 2.1 | Supabase Realtime channel on `order_events` (one channel, org-scoped, staff-authenticated); a `useOrderEvents` hook that invalidates the affected view | LIVE — `688cb85`, `1025fc0`; timing not measured | **Local proof:** an order placed on a second device against the local stack appears on `/app/orders` in under 2 s with no refresh. **Live, read-only:** during real service, a signed-in `/app/orders` shows the next real order arrive without a refresh. No test order |
| 2.2 | Replace polling: orders board, KDS, deliveries, POS menu poll (keep a 60 s fallback poll for dropped sockets) | LIVE — `6d14d69`; data polls are 60 s fallbacks (`kds-board.tsx:17`, `pos-shell.tsx:49`, `live-refresh.tsx:9`, `new-order-alert.tsx:17`); tracking page 30 s; the other `setInterval`s are clocks and device heartbeats | `grep -r setInterval src` shows only fallback polls, clocks and heartbeats |
| 2.3 | Customer tracking page `/order/[id]` goes live-updating | LIVE — `a1c7695`; `order:<id>` broadcast, `src/components/order/order-live.tsx` | **Local proof:** a status change on the local KDS reaches `/order/[id]` without reload. **Live, read-only:** the next real order's tracking page advances without reload as the kitchen works it. No test order |
| 2.4 | New-order alert (chime) and KDS sound driven by the channel, not the poll | LIVE — `52ec5f5` | **Local proof:** the alert fires within 2 s of a local placement. **Live, read-only:** staff confirm the chime on the next real order. No test order |

**Decisions needed:** none.

---

## Phase 3 — Inventory core (6–8 days)

Highest value per hour left in the product: eleven tables, the costing library and the architecture proposal already exist. This turns "food cost" from a typed-in number into a measured one.

**Live state:** all seven slices merged and deployed (progress log, "Lane A 3.7 — Phase 3 complete"). Route health and write paths were verified; none of the worked examples below has been walked with real data on frybirdiq.tech yet.

| # | Slice | Status (17 Sep) | Done when |
|---|---|---|---|
| 3.1 | Recipe line editor on the product page (`recipe_items`, versioned on save into `recipe_versions`); gated `recipes.edit` | LIVE — `72ad089` | Nashville Burger has a recipe with 6+ lines and a theoretical cost on `/app/iq/products` |
| 3.2 | Stock movements: receive (with supplier price → `ingredient_prices`), adjust, count; on-hand derived from movements; gated `inventory.adjust` | LIVE — `680e779` | Receiving 10 kg chicken shows 10 kg on hand; a count of 9.4 kg writes a −0.6 kg adjustment |
| 3.3 | Waste log: ingredient, qty, reason (enum exists), who, when, cost; gated `inventory.waste`; KITCHEN can use it | LIVE — `b942374` | A waste entry appears on the ingredient's movement history and in the week's waste total |
| 3.4 | Consumption on order — one movement batch per order at the agreed status, reversed on cancel/refund; **D7: never double-count** (idempotent on order id) | LIVE — `e40a760`, `37b3f49` | **Local proof:** `pnpm test:integration` — completing an order with 2× Nashville Burger reduces chicken by exactly 2× the recipe qty; completing it twice does not. **Live, read-only:** for one business day, consumption movements equal recipe qty × quantity sold for real orders, and no order has two consumption batches. No test order |
| 3.5 | Actual vs theoretical food cost on `/app/iq/pnl` — two numbers, one source each | LIVE — `a45aa7a` | The P&L shows theoretical (recipes × sales) and actual (movements) side by side with variance |
| 3.6 | Smart 86 read-only: projected stockout time per ingredient from the last 7 days' velocity; affected products listed; **recommends**, never changes availability | LIVE — `788441a` | Chicken at 6 kg with 7.8 kg projected shows "short around 20:45" and the four affected products |
| 3.7 | Purchase orders: draft → sent → received (receiving creates the 3.2 movement); gated `purchasing.manage` | LIVE — `26ea31a` | A PO received in full lands stock and updates the supplier price |

**Decisions needed (before 3.4):** which order status triggers consumption — recommend **ACCEPTED** for kitchen prep truth, reversed on REJECTED/CANCELLED. Low-stock threshold — recommend days-of-cover (2 days) rather than a fixed quantity.

---

## Phase 4 — Kitchen: targets, stations, expo (4–5 days)

Needs Phase 2. Turns the single ticket board into a kitchen system.

| # | Slice | Status (17 Sep) | Done when |
|---|---|---|---|
| 4.1 | Prep targets from `products.prep_minutes`; ticket target = max over lines; "nearly late" at 80% of target, late at 100% | PARTIAL — KDS flags a ticket late past its promised time only; no prep target, no amber (`src/lib/kitchen/tickets.ts:72`) | **Local proof:** unit tests on the 80% / 100% thresholds, and seeded local tickets turn amber and red on the KDS. **Live, read-only:** during real service, the signed-in KDS shows amber and red on real tickets. No test order |
| 4.2 | Stations — `stations` table + `products.station` (default from category); tickets split per station; one board per station, one expo board that shows a ticket only when every station has bumped | NOT STARTED — KDS is station-less (`src/app/(app)/app/kds/page.tsx:15`) | **Local proof:** a seeded order with FRY and ASSEMBLY lines shows only its lines on each station screen, and expo shows the whole order once both are bumped. **Live, read-only:** the same holds for real orders during service. No test order |
| 4.3 | Order Health on `/app/iq/live`: GREEN / AMBER / RED from the 4.1 rule; count of each on the Command Center | PARTIAL — "Order health right now" shows the past-promised count only (`src/app/(app)/app/iq/page.tsx:199`) | The Command Center's "orders past promised time" becomes a three-state health strip |
| 4.4 | Kitchen analytics: prep time p50/p90 per product and per hour, from `order_events` | NOT STARTED — no `/app/iq/kitchen` route | `/app/iq/kitchen` shows the slowest five products this week |

**Decisions needed (before 4.2):** station list — recommend **FRY · ASSEMBLY · DRINKS · PACK** with EXPO as the combined view; routing by category with per-product override.

---

## Phase 5 — Cash & finance (4–5 days)

Needs Phase 1 (refunds) and the payments ledger.

| # | Slice | Status (17 Sep) | Done when |
|---|---|---|---|
| 5.1 | Cash sessions: open (float), all cash payments attach to the open session, close (counted cash, expected cash, variance, who); gated `finance.view` to see, new additive `finance.manage` to open/close | NOT STARTED — `/app/finance` says "Cash sessions, rider handovers and reconciliation not connected" (`src/app/(app)/app/finance/page.tsx:92`) | **Local proof:** `pnpm test:integration` — closing a session with ₹20 short records the variance against the cashier with an audit row. **Owner-run + read-only:** the first real till close shows counted, expected, variance and who. No staged shortfall, no test cash record |
| 5.2 | Rider cash handover into the session | NOT STARTED — same evidence | **Local proof:** a seeded rider's door cash appears as expected cash in the counter's session. **Live, read-only:** a real rider's handover appears in that day's session. No test order |
| 5.3 | Reconciliation view: sessions vs ledger vs Razorpay settlements by day | NOT STARTED — same evidence | One screen shows yesterday's cash, online, refunds and net |
| 5.4 | Exports (CSV): orders, payments, expenses, GST summary; gated `reports.export` | LIVE — `ab77ed3` | A month's payments download opens in Excel with paise as rupees |
| 5.5 | Restaurant settings: profile, hours, GST view (read-only until registered), COD cap, payment methods on/off | LIVE — `ab77ed3`, `8085a33` | Changing opening hours changes what the website shows within a minute |

**Decisions needed:** none technical. Whether FRYBIRD is going to register for GST — if yes, the engine flips with `pnpm business:set --gstin`; the UI should show the switch, not hide it.

---

## Phase 6 — People (3–4 days)

Replaces the CLI as the only way to give someone a login.

| # | Slice | Status (17 Sep) | Done when |
|---|---|---|---|
| 6.1 | Staff invite by email → Supabase Auth invite → membership with role; deactivate; role change; all on `staff.manage`; audit rows | LIVE — `1e52e37` (`src/lib/repositories/staff.ts:87`) | **Local proof:** on the local stack (its mail catcher), a new cashier receives the invite, sets a password, and sees only the POS and orders. **Owner-run + read-only:** the next real staff member the owner invites lands on frybirdiq.tech with the right role. No test invite in production |
| 6.2 | Roles & permissions matrix page (read-only view of `domain/permissions.ts`) | LIVE — `1e52e37`, `/app/staff/roles` | A manager can see who can refund without reading code |
| 6.3 | Rider assignment: `orders.rider_id`, assign from the orders board, rider sees only their deliveries; FAILED delivery with reason in the deliveries UI | NOT STARTED — no `rider_id` in the schema | **Local proof:** two seeded rider logins see disjoint lists, and a failed delivery is recorded with its reason. **Live, read-only:** real riders see only their own deliveries. No test order |
| 6.4 | Shifts (basic): clock-in / clock-out tied to cash session open/close | NOT STARTED — no shift code outside the driver prototype's demo data | A shift summary shows hours and cash for the person |

**Decisions needed:** CASHIER gets `kitchen.update`? — recommend **yes**, single-person shifts are real at a one-counter shop.

---

## Phase 7 — Customers & messaging (3 days)

| # | Slice | Status (17 Sep) | Done when |
|---|---|---|---|
| 7.1 | Customer edit and notes; gated `customers.edit` | NOT STARTED — the permission exists (`src/domain/permissions.ts:46`); no edit action or form uses it | A wrong phone number can be corrected without SQL |
| 7.2 | Order-status notifications via WhatsApp Business API (fallback SMS): accepted, ready, out for delivery | NOT STARTED — only manual WhatsApp invoice sharing exists; `/app/admin/notifications` lists the API as not connected | **Local proof:** bumping a seeded order to READY sends one message through the provider mock (recorded fixture). **Live, read-only:** the provider's delivery log shows READY messages for real orders. No test order |
| 7.3 | Promotions measurement: uses, revenue, discount cost, AOV per promotion on `/app/customers/promotions` | PARTIAL — orders, revenue and discount given per promotion are live (`src/app/(app)/app/customers/promotions/page.tsx:42`); no AOV | Each promo shows what it cost and what it brought in |
| 7.4 | Stamp rules confirmed and exposed in `/app/iq/rewards` (what earns a stamp, what the 8th order gives) | LIVE — one config (`src/lib/loyalty/config.ts`) is edited on `/app/iq/rewards` and read by the website, cart, POS and payments | The rule on the website matches the rule in the engine |

**Decisions needed:** stamp rules (open since August). WhatsApp provider (Interakt / Gupshup / Meta direct).

---

## Phase 8 — Design completion (3–4 days, interleave anywhere)

**Status (17 Sep): PARTIAL.** Deliveries, Expenses, Rewards, Menu sub-pages, order card and new-order alert were moved to the system (progress log, Lane B). Left: POS payment sheet and rewards keypad (held: POS needs sign-off). The "IQ dark theme" line was dropped by the owner — POS and KDS stay light.

No dependencies. Slot single screens between phases rather than as a block.

Still on the old style (as of 14 Sep): Deliveries page and card · Expenses list and new-expense form · every Menu sub-page (categories, combos, media, modifiers, product new/edit, review) · Rewards page · Restaurant settings · POS payment sheet and rewards keypad · order card and new-order alert · old `overview-kpis`.

**Done when** `grep` finds no old heading/back-link pattern and every staff route renders in both themes with the contrast check passing.

---

## Phase 9 — Driver app (5–7 days, after 2 and 6)

**Status (17 Sep): PARTIAL.** Only the isolated prototype on demo data is live (`9078863`, `/app/driver-preview`); the prototype review has not happened; no real jobs, GPS or proof of delivery.

Prototype review first: offer-vs-assign, delivery code yes/no, photo proof yes/no, stop ordering. Then: real jobs from `orders` with `rider_id`, GPS position posted every 15 s while on a job, customer live map on `/order/[id]`, proof of delivery (photo or code), background location as a PWA.

**Done when** — **local proof:** a seeded delivery's customer tracking page shows the rider approaching, and the rider's cash lands in the session. **Live, read-only:** the same is observed on a real delivery. No test order.

---

## Phase 10 — Offline POS (4–5 days)

**Status (17 Sep): NOT STARTED.** No manifest, service worker or IndexedDB queue in the live build.

PWA manifest + service worker; order queue in IndexedDB when offline; sync with the same idempotency keys on reconnect; menu cached per shift.

**Done when** — **local proof:** against the local stack, the network is cut mid-session, three orders are rung up, and all three appear once it's back, none duplicated. **Live, read-only:** after a real outage, no idempotency key has two orders. Never unplug the router during service to test it, and no test order.

---

## Phase 11 — Analytics expansion & AI (after 3, 4, 5)

**Status (17 Sep): PARTIAL.** Live: customer segments, Smart 86 projection, actual vs theoretical food cost. Not started: cohorts and inactive customers, forecasting, Daily Brief (`/app/iq/brief` is a placeholder), Ask FRYBIRD (no model is called). Continued in detail by the Intelligence track below.

Customer analytics (cohorts, inactive customers), waste and variance analytics, forecasting (next-day chicken need from the last 4 weeks), then Daily Brief and Ask FRYBIRD over the real tables — facts, forecasts and recommendations labelled as such, no action without a human tap.

**Done when** "How much chicken do we need tomorrow?" answers with a number and the evidence behind it.

---

## Intelligence track (added 17 September 2026)

Runs beside Phases 0–11 and replaces none of them. Source: `hive/org/IQ-GAPS-AND-ROADMAP.md` (proposed by the orchestrator, 17 Sep). Every Done-when is proven on frybirdiq.tech read-only, or on the local stack — never with test orders or payments. Every output is labelled FACT, DETECTION, FORECAST, EXPLANATION, RECOMMENDATION or AUTOMATION; a forecast is never shown as a fact.

**Status (17 Sep):** IQ-0 is **IN DESIGN** — v2 design under review (`hive/reviews/iq-0/DESIGN-v2-DELTA.md`); it builds more than the row lists (migration `0034`, which requires `sec-1`'s `0033`; the job runner; an nginx block; `iq_auto_policies`; `iq.approve` and `iq.autopolicy.manage` permissions). Every other IQ phase is **NOT STARTED**.

### Gaps, ranked by business value ÷ effort

| # | Missing capability | Why it matters for FRYBIRD | Depends on | Value |
|---|---|---|---|---|
| G1 | Trusted metric layer + nightly facts + data-trust score | every later number must agree with the P&L and say how reliable it is; today each screen queries on its own | — | foundation |
| G2 | Finance reconciliation + payment crash signatures | catches money leaks and payment bugs automatically, read-only | G1 | very high |
| G3 | Daily brief (deterministic first) | the owner gets yesterday, today's risks and 3 actions at 07:30 without opening screens | G1 | very high |
| G4 | Baseline anomaly detection + service pulse | "sales 30% under a normal Friday by 20:00", discount/void spikes, slow tickets, cash variance — today only fixed thresholds | G1 | high |
| G5 | Demand + ingredient forecast with intervals and backtests | chicken prep and ordering drive both waste and stock-outs; today only a 7-day velocity | G1 | very high |
| G6 | Food-cost variance explanation + waste detection | theoretical vs actual exists side by side; nothing says why | G1, recipe coverage | high |
| G7 | Prep list + draft reorder (A1) + approval inbox (A2) | turns G5 into saved kilos and fewer 86s | G5, action tiers | high |
| G8 | Menu engineering | which items earn margin and which only volume; attach rates for combos and modifiers | G1, G6 | medium-high |
| G9 | Customer intelligence (repeat, lapsed regulars, cohorts, RFM) | loyalty and win-back only pay if aimed; consent first | G1, CRM consent | medium-high |
| G10 | Promotion evaluation (incremental margin) | stop promos that buy revenue at a loss | G1, G4 baseline | medium |
| G11 | Recommendation → approval → outcome loop | the system learns which advice works | G3–G7 | high (compounding) |
| G12 | Simulation (price, prep, promo what-ifs) | decisions before money moves | G5, G8 | medium |
| G13 | Ask FRYBIRD (grounded assistant) | natural questions over the same trusted tools; last, because it only narrates G1–G12 | G1–G5, API key | medium |
| G14 | Ops intelligence: KDS times, delivery promise accuracy, labour productivity | needs Phase 4, 6 and 9 data | Phases 4, 6, 9 | medium |
| G15 | External signals: festival, holiday and cricket calendar, weather | demand in Ambala swings on these | G5 backtests | medium |

### Phases

| Phase | Slices | Lead → reviewers | Done when |
|---|---|---|---|
| **IQ-0 Foundations** (1 week) | engine contract (claim types, `iq_*` tables spec); job runner design; office automations: health smoke, migration drift, backup freshness; `ORG.md` §8 classification of their read-only commands | IQ-ENGINE, AUTOMATION-ARCHITECT, DEVOPS-RELEASE → ARCHITECT, DATABASE, RELIABILITY, SECURITY-TENANCY | contract doc approved; smoke runs hourly and writes to the board; owner approved the job-runner infra design |
| **IQ-1 Metric layer + trust** (1–2 weeks) | metric definitions; nightly `iq_daily_facts`; trust score; P&L and Overview read from facts | ANALYTICS-DATA → FINANCE-LEDGER, GST-TAX, PERFORMANCE | yesterday's revenue, orders and food cost % on the brief equal `/app/iq/pnl` to the paisa for 7 consecutive days; each metric shows its trust score |
| **IQ-2 Watch the business** (2 weeks) | finance reconciliation job + payment crash signatures; baseline detectors; service pulse; deterministic daily brief v1; insight cards with claim badges | FINANCE-LEDGER, PAYMENT-SAFETY, IQ-ENGINE, BUSINESS-INTELLIGENCE → RELIABILITY, FRONTEND, UX-ARCHITECTURE, RESTAURANT-OPS | a brief exists at 07:30 every day for 7 days with every claim labelled; reconciliation lists zero unexplained mismatches or names each one; detectors proven on seeded local data, and on live history via the approved aggregate export |
| **IQ-3 Predict demand** (2–3 weeks) | item + ingredient forecasts p10/p50/p90; rolling backtest vs seasonal-naive; festival calendar; prep plan; draft PO (A1) | DEMAND-FORECAST, PROCUREMENT → IQ-ENGINE, RESTAURANT-OPS, INVENTORY | "How much chicken tomorrow?" shows p50 with range and evidence; a published 4-week backtest error; the forecast beats seasonal-naive, or naive is what ships |
| **IQ-4 Explain cost and menu** (2 weeks) | food-cost variance decomposition; waste detection; menu engineering quadrants; recipe-coverage drive | RECIPES-FOODCOST, MENU-INTELLIGENCE → FINANCE-LEDGER, PRICING | a weekly variance explanation whose drivers sum to the total with the residual shown; every top-20 item placed in a quadrant with margin in paise |
| **IQ-5 Decide and act** (2–3 weeks) | recommendation engine; approval inbox; action tiers A0–A2; executor; outcome measurement | IQ-ENGINE, AUTOMATION-ARCHITECT → RELIABILITY, SECURITY-TENANCY, RED-TEAM, FRONTEND | an approved prep recommendation shows expected vs actual waste and stock-out after its day; every automated action has an audit row and an undo path |
| **IQ-6 Customers and promotions** (2 weeks) | consent model; repeat, lapsed and cohorts; promotion evaluation; win-back proposals (A2) | CUSTOMER-INTELLIGENCE, CRM, PROMOTION-ECONOMICS, LOYALTY → SECURITY-TENANCY, FINANCE-LEDGER, GROWTH-MARKETING | each finished promo shows incremental margin vs baseline; the lapsed-regulars list uses only consented customers |
| **IQ-7 Simulate** (1–2 weeks) | price, prep and promo what-ifs with labelled assumptions | IQ-ENGINE, PRICING → FINANCE-LEDGER, GST-TAX | a price what-if shows margin impact under a stated elasticity assumption, labelled as such, with no price changed |
| **IQ-8 Ask FRYBIRD** (2 weeks) | tool layer over the engine's layers; grounded narration; evals; prompt-injection tests | IQ-ENGINE → SECURITY-TENANCY, RED-TEAM, BUSINESS-INTELLIGENCE | a 50-question eval passes with every narrated number grounded; Phase 11's chicken question answered with number and evidence |
| **IQ-9 Operations intelligence** (after Phases 4, 6, 9) | KDS time analytics, delivery promise accuracy, labour productivity | KITCHEN-KDS, DELIVERY, WORKFORCE → RESTAURANT-OPS | the weekly ops review shows slowest items, late-delivery causes and sales per labour hour |

**Sequencing:** the refund track (`ref-1` → `pay-2` → `pay-3`) goes first. IQ-0 and IQ-1 run in parallel with Phase 0–2 remediation, because they are additive and read-only. IQ-3 onward needs Phase 3 live (it is, as of 17 Sep) **and** enough recorded inventory history — that history is not yet confirmed, since no Phase 3 worked example has been walked with real data.

**Decisions this track needs** (owner; not answered here): job runner on the VPS (`dec-1`) · additive `iq_*` tables and their production migration (`dec-2`) · one aggregated, PII-free history export for backtests (`dec-3`) · which A1 action classes may run automatically (`dec-4`) · customer consent wording and whether win-back messaging is wanted (`dec-5`) · Anthropic API key and monthly spend cap for Ask FRYBIRD (`dec-6`) · food-cost target (`dec-7`, same as decision 10 below) · who may approve A2 actions (`dec-12`).

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

**Where that stands on 17 Sep:** Live operations and Measured food cost are shipped (worked examples still owed). Customer loop closed waits on Razorpay keys and the refund fixes. Self-managed is shipped for invites and roles. Kitchen system, Cash accountable, Customer-facing complete and Operating system are not reached.

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
11. Offsite backup storage and credentials (`dec-8`) → 0.7
12. GST treatment of refunds, and approval of the refund architecture change (`dec-9`, `dec-10`) → 1.4

Intelligence-track decisions are listed at the end of that section.

The progress log records decisions 3 and 6 as already acted on (consumption shipped in 3.4; CASHIER `kitchen.update` shipped with 6.1). They stay listed until the owner confirms them.
