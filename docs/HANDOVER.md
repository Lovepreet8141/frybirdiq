# HANDOVER — agent office closed, single builder from here

Written 2026-09-19 (session `frybirdiq-3c`, on `kit-radix-nova`). Sources: `git` state at the time of writing,
`~/FRYBIRD-IQ/hive/{board.md,tasks.json}` (the office's own record), `docs/RELEASES.md`.

**How to read the test numbers.** Every number below is what the office recorded on the card. I did **not** re-run the
suites for this handover, with one exception: the uncommitted S4a change (see ops-1), where I ran its test file and `tsc`.
Nothing here has been re-verified in a browser. Nobody on the office floor had a browser.

**Nothing has been deployed, merged into `kit-radix-nova`, or deleted by this handover.** All 108 local branches are on
GitHub (`origin`), each at the same commit as local (checked with `git rev-parse` per branch after the push). Worktrees,
branches and hive files are untouched.

---

## 1. What is live in production

| | |
|---|---|
| Commit | `49f858a5fe79b3b391aa85633ada1485a0b2203a` (`release/rc-13-native-retry`, fast-forwarded into `kit-radix-nova`) |
| BUILD_ID | `x5cu1EHxOpfe8vYlRFl8C` |
| Migration head | `0038_refunds_status_idempotency` (39 of 39 applied) |
| Deployed | 2026-09-19 18:12:50 UTC (23:41 IST, shop closed) |
| Smoke / journal | Smoke pass, 0 journal errors, 0 restarts (per board) |
| Pre-migration dump | `/var/backups/frybird/frybird-20260919-1811.dump` on the VPS (440,664 B, listed clean) |
| Record | `docs/RELEASES.md` rows 2 and 3 |

`kit-radix-nova` = `origin/kit-radix-nova` = `1fe080b` = production's code plus the RELEASES rows. There is no branch
ahead of production on `kit-radix-nova`: every card below lives on its own branch.

**Rollback of 49f858a is code AND database together and needs the owner's yes.** Old code breaks on 0037's
`NOT NULL as_of`. The deploy worktree `~/FRYBIRD-IQ/worktrees/deploy-49f858a` is kept for this.

**Open after that deploy:** the owner has not yet entered the shop phone (Admin → Restaurant); alerting install
(DEPLOY.md §11.2) not run; no uptime monitor; `p0-3e` (a human looking at the closed-shop strip on the live site during
closed hours) not done.

Only the heartbeat job is scheduled in production. Facts, detect, reconcile, signatures and the refund healer are built
but not scheduled/deployed (this is the IQ-2 / refund-healer backlog).

---

## 2. Queue order (`tasks.json` `queueRank`)

1. **p0-3e** closed-shop check with the owner — blocked by ops-1 (no safe way to see the closed state without editing live hours)
2. **p1-backup** offsite backups + proven restore incl. staff logins — waiting on owner
3. **ops-1** Close Shop switch — built, reviews open
   - 3.1 **ops-3** day off + planned closures (after ops-1, own migration)
   - 3.5 **ops-2** close paid counter orders + alert on old ACCEPTED (after ops-1; the 27 ACCEPTED orders)
4. **seo-1** get-found pack — finished, waiting for a release
5. **loy-web** loyalty visible on the site — finished, merge after seo-1
6. **pay-ready** Razorpay readiness (includes p3-order-copy, pay-7) — built, unreviewed, money
7. **iq2-ship** finish and deploy IQ-2
8. **rm-5.1 → rm-5.2 → rm-5.3** cash sessions, rider cash handover, reconciliation view
9. **p0-7** ADMIN can mint OWNER / role-blind reads — **must be fixed before any non-OWNER login exists**
10. **rm-6.3** rider assignment
11. **rm-4.1 → rm-4.2** prep targets, kitchen stations
12. **rm-7.2** WhatsApp order-status notifications (mock until the owner picks a provider)

Side card `a3-accepted` is done (see §4).

---

## 3. Cards

Legend: "Reviewed" = what the office recorded. "Open findings" = refusals or non-blocking notes not yet closed.

### 3.1 ops-1 — Close Shop switch (queue 3)

> **SUPERSEDED 2026-09-20: ops-1 is integrated and live (Release 2, `9a826ee`, RELEASES row 6). The text below is the pre-integration record; see §8 for the current state.**

- **Branches / heads.** ops-1 is **five branches that have never been integrated**; there is no single ops-1 branch.
  All are based on `1fe080b`.

  | Slice | Branch | Head |
  |---|---|---|
  | S2 migration 0039 | `agent/database-ops-1-s2` | `9928f23` |
  | S3 gate + repo, S4a POS switch (+ S3 fixes) | `agent/pos-orders-ops-1-s4a` | `939c41d` |
  | S3 fixes only (guard) | `agent/pos-orders-ops-1` | `785b9ab` |
  | S4b Admin → Restaurant panel | `agent/backend-ops-1-s4b` | `7a17af4` |
  | S5 site banner | `agent/customer-web-ops-1-s5` | `a1eb45e` |

  Integration trap: `backend-ops-1-s4b` (11 commits over kit) contains S3 at `4656277` and S4a at `2c8ed18` but **not**
  the S3 fix `dd73819` / guard `785b9ab` and not `939c41d`. `pos-orders-ops-1-s4a` has those. `customer-web-ops-1-s5`
  (9 over kit) is a separate line. Merge order must carry S2 → S3 (with `dd73819`, `785b9ab`) → S4a (`939c41d`) → S4b → S5.
  Expect small conflicts.
- **Done.**
  - S1 pure gate (`c185d01`, `87210c7`).
  - S2 migration 0039 (`paused_at/by/reason/until`, CHECK constraint, down refuses only while a pause is in force).
  - S3 `placeOrder` refuses while paused; pause/resume with audit row.
  - S4a POS header switch.
  - S4b Admin panel.
  - S5 banner on every customer page.
- **Left.**
  1. Integrate the five branches into one (see trap above) and re-run everything.
  2. RELIABILITY re-check of S3 option-(a) + S4a notice + S4b polish + S5 fix, sent as one batch.
  3. The server-side payment hold (refuse a NEW Razorpay intent while paused) lives in `pay-ready`, not here.
  4. Browser check at 375 px and 1280 px, both themes (nobody has seen the banner or POS/Admin panels rendered; contrast unmeasured).
  5. Owner go/no-go (order placement + migration).
- **Review status and open findings.**
  - SECURITY-TENANCY: AGREE on S4a / S4b / S5.
  - RELIABILITY: AGREE on the design (+6 requirements; 3 built at `87210c7`). Then:
    - **S3 REFUSED (open until re-checked).** "A stricter pause replaces a weaker one." Fix is `dd73819`, guard `785b9ab`. No re-check recorded.
    - **S4a REFUSED (open until re-checked).** Needs a visible "choice not applied" message. Fix is `939c41d`, committed by me during this handover, **unreviewed**; I ran `shop-switch-view.test.ts` (21 pass) and `tsc --noEmit` (clean), but did not prove fail-first.
    - **S4b AGREE** plus 3 polish items, done in `7a17af4`.
    - **S5 REFUSED (open until re-checked).** An uncaught status read broke every page. Fix `a1eb45e` (read caught → null, logs name+message only, 5 tests). No re-check recorded.
  - Known: an unreadable status **fails open on the page** (the server still refuses).
- **Tests (as recorded).**
  - S3: 2203 unit / 450 integration at `4656277`.
  - S2: 16/16 integration for 0039.
  - S4b: 2213 → 2240 unit.
  - S4a: 2225 unit / 454 integration at `2c8ed18`.
  - S5: 2205 → 2210 unit; build compiles.
  - Fail-first was recorded for S1 (5 of 8 fail without the fix).
  - No integrated run exists.
- **Migration.** Yes: `0039` (in `9928f23`). Down script exists, refuses while a pause is in force, and was integration-tested (16/16).
  Production is at 0038, so 0039 needs the owner's go/no-go.
- **Rollback.** **Resume ordering (switch on) before ANY rollback**: old code has no pause check and would stay
  paused-invisible. Then code rollback to `49f858a`. The 0039 down script refuses while paused.
  Code-only rollback after 0039 is applied is safe only because the columns are additive and the old code ignores them,
  and only once ordering is resumed. **Not verified.**
- **Required deploy step (owner rule 2).** After deploy: pause → the site shows paused and refuses → resume → the site takes orders. **No order placed.**
- **Owner rulings (reversible).** Pause control on the POS header; pause/resume needs `orders.update` (OWNER/ADMIN/MANAGER/CASHIER, not KITCHEN);
  paused refuses ASAP and scheduled; no auto-cancel of placed orders (confirm shows "N orders still due");
  a pause that ends later or never replaces one that ends earlier.
  Owner requirements (override "no auto-reopen"): see §5.

### 3.2 p1-backup — offsite backups + restore proof (queue 2)

- **Branch / head.** `agent/devops-release-backup` @ `5353b2a` (3 commits over `1fe080b`; built `0549ede` → `c70d114` → `5353b2a`).
- **Done.** Encrypted (age) dumps of the public and auth schemas, rclone to Backblaze B2 with Object Lock, owner-only rclone config, DB password off argv, restore-check with row counts. Staff logins (Supabase auth) are included; they are **not** in today's nightly dump.
- **Left.** Blocked on the owner:
  1. B2 bucket + write-only key typed into rclone **on the VPS** by the owner, plus an age key pair (public key line only).
  2. A yes to install the script on the VPS. The new script fixes a live finding: the current `backup.sh` line 39 puts the DB password on the command line, readable via `/proc/cmdline`.
  3. A yes to a restore of CURRENT data into a **scratch** database (never production).
- **Review.** SECURITY-TENANCY REFUSED the first build (Object Lock, config permissions, password on argv); AGREED `c70d114` (own argv probe: 0 hits across 4 password shapes). The three follow-ups after that are in `5353b2a`. Not recorded as re-reviewed. **Open finding: none recorded.**
- **Tests.** 34 checks, fail-first 6 → 0, including auth enforced, a wrong-password case, and a `%XX`-only decoder. **Untested:** the auth dump as the production pooler role, real B2, and a restore on the VPS. The first real run must be watched.
- **Migration.** None. Touches `deploy/` and the VPS only.
- **Rollback.** Restore the previous `backup.sh` from git; nothing in the database changes. Offsite upload stays off until B2 is configured.

### 3.3 loy-web — loyalty visible on the customer site (queue 5)

- **Branch / head.** `agent/customer-web-loy-web` @ `b407ebb` (2 over `1fe080b`; built `5fe3318`).
- **Done.** Loyalty shown on home, menu, account, order, cart, checkout, from config via `lib/loyalty/copy.ts`.
  Preview uses the ledger's own functions; the owner's wording is "You'll earn 1 stamp when this order is completed." (same for points); nothing is shown at 0.
- **Left.** Merge **after seo-1** (small conflicts expected). Owner visual check at 375 px / 1280 px. Then release.
- **Review.** Dwight (loyalty): first REFUSE (copy), then **AGREE on `b407ebb`**. Diff `1fe080b..b407ebb` touches only site pages, `components/loyalty`, `lib/loyalty/copy(.test).ts` — display only.
  Non-blocking: `stampRewardDiscount` proxy misses a zero-priced reward (cosmetic); a proper fix needs `stampRewardId` on `OrderView`, which is order code and out of this slice.
- **Tests.** 20 new, 2170 unit, build compiles. No integration run recorded.
- **Migration.** None.
- **Release class.** Standing approval **only while the diff stays display-only**. Any change to checkout action, order placement, loyalty calculation or payments needs the owner's go/no-go.
- **Rollback.** Code-only, redeploy previous BUILD_ID. Safe (no schema change).

### 3.4 seo-1 — get-found pack (queue 4)

- **Branch / head.** `agent/customer-web-seo-1` @ `1e0e817` (5 over `1fe080b`; built `21ad271`).
- **Done.** `/order/<bad id>` → 404 (fail-first), sitemap/robots/canonical/OG/Twitter/share image, JSON-LD location from the stored map pin, 45 s public menu cache, image sizes + media cache, branded 404. P3 fixes (photo-less item og:image fallback, ignore 172.16/12 and link-local `SITE_URL` hosts) done.
- **Left.**
  1. Owner approves the 15 item descriptions (draft: `~/FRYBIRD-IQ/hive/research/seo-1-descriptions.md`). **Writing them into production menu data is a production data write → owner gate.**
  2. nginx `robots.txt` Sitemap line is a VPS conf change, separate from the code deploy.
  3. Owner look at rendered pages.
- **Review.** PERFORMANCE: AGREE (verified on a real DB + prod build). Two P3s raised and fixed in `1e0e817`. **Open findings: none recorded.**
- **Tests.** 2174 unit, build OK.
- **Migration.** None.
- **Release class.** Standing approval (UI only, no migration, no money/orders/auth), shop closed, fresh dump first.
- **Rollback.** Code-only, redeploy previous BUILD_ID. Safe.

### 3.5 ops-3 — day off + planned closures (queue 3.1)

- **Branch / head.** **None. Not started.** Spec is in §5 below.
- **Depends on ops-1 being released.** Not part of the ops-1 release.
- **Done / left.** Nothing built. Planned order: schema (per-day hours, closed dates with public note) → gate / next-opening / picker / pre-order impact query → Admin hours + closed-dates UI → extra switch durations on POS + Admin → banner.
- **Review / tests / rollback.** None yet.
- **Migration.** Expected yes (hours are one opening/closing pair today) → owner go/no-go.
- **Waiting on owner.** Which weekday is the weekly off (or "none"). Not needed to build it.

### 3.6 iq2-ship — IQ-2 (daily brief, reconciliation, detectors) (queue 7)

- **State.** Built in pieces across many branches, **none integrated or deployed**. Production has no IQ-2 job scheduled.
  Base `release/rc-12` @ `6ad2606` (0037 + 0038) is already inside `49f858a`, so 0037/0038 are live.
- **Branches / heads** (none pushed before today; all now on GitHub):

  | Slice | Branch | Head | Note |
  |---|---|---|---|
  | S4 recon (FIN) | `agent/finance-ledger-mu4xp10r-iq2-s4` | `47eeed9` | closed both refusals; recon reviews out to PAY / GST / REL |
  | S5 signatures | `agent/michael-mu4lr1ro-iq2-s5` | `1f2afc0` | FIN REFUSED `91ae343`: `double_capture` never clears once the duplicate is refunded |
  | S9 pulse | `agent/iq-engine-iq2-s9` | `af3162d` | |
  | S10 brief | `agent/business-intelligence-iq2-s10` | `61cc1e3` | compose/templates/brief-job, grounding test (42 tests) |
  | S10a loader | `agent/iq-engine-iq2-s10a` | `5ed149d` | |
  | S11 UI | `agent/frontend-mu4xp5yj` | `1a6a7da` | BI refused `6308030`, fixed in the S11c commits |
  | S11b alerts page | `agent/iq-engine-iq2-s11b` | `e2e74c8` | |
  | adapter (jobs) | `agent/automation-architect-iq2-adapt` | `8dec6e2` | on `6ad2606`, 11 commits |
  | reference (rc-12 jobs) | `agent/automation-architect-ref-b7` | `4546dba` | |

  S5, S10, S11 branch from `93fd9c5` (84 commits behind `kit-radix-nova`); S10a and iq2-adapt from `6ad2606` (43 behind). Rebasing is forbidden — merge.
- **Left.** Open cards: `iq2-s5c` (`double_capture` fix, on top of `1f2afc0`), `iq2-s6` (post-refund signatures; must ship with 0038's `status='SUCCEEDED'` fix), `iq2-s10b` (brief page — held until s11c + s10a), `iq2-s10c` (per-rule sentences), `iq2-s10d/e/f`, `iq2-s4c–f`, `iq2-s7d`, `iq2-s9b`, `iq2-s11d/e`, then QA and DEVOPS scheduling/rollback.
- **Open review findings (non-blocking unless noted).**
  - S5: `double_capture` never clears (**blocking**, fix card `iq2-s5c`).
  - `iq2-s10d`: an hourly job with partial coverage folds to SUCCEEDED, so the brief can all-clear on partial data. Decide **before** any signatures job is registered.
  - `iq2-s10e`: brief loader truncates silently at 500 rows.
  - `iq2-s10f`: parity is month-scoped but reads as per-day.
  - `iq2-s4c`: reconcile note 5 — a day touched within 5 minutes of every run is unchecked forever and its parity key never expires.
  - `iq2-s4d`: parity fixture covers 4 of 8 metrics (a divergence in the expense branch would fire a false severity-3 every day).
  - `iq2-s4e`: `detect/day.ts:222` still hardcodes `parityFlagged=false`; a timeout and an unchecked run both read "not flagged" — decide it deliberately.
  - `iq2-s4f`: reconcile deadline 180 s vs parity ~50 s, re-check against the 21:32 systemd retry window.
  - `iq2-s7d`, `iq2-s9b`, `iq2-s11d`, `iq2-s11e`: small.
- **Tests.** rc-12 (`6ad2606`): unit 2002, integration 398/398, build green, journal 0000–0038 contiguous (recorded by QA). Slice-level counts are on each card; there is no integrated IQ-2 run. The one recorded build failure (S10) was Google Fonts being unreachable, not code.
- **Migration.** 0037/0038 already live. Further IQ-2 slices may add none; confirm when integrating. `iq_insights` is at 0037.
- **Rollback.** Not written for IQ-2. New jobs are additive and unscheduled until DEVOPS wires timers; removing the timer stops them. **Unverified.**
- **Owner decisions blocking parts:** `dec-3` (PII-free history export), `dec-7` (food-cost target), `dec-9/11` (GST on refunds), `dec-13` (may ANALYST/ADMIN see money totals on IQ pages).

### 3.7 a3-accepted — the 27 orders stuck in ACCEPTED (done, read-only)

- **Result (DATABASE, read-only, aggregated).** Staff not closing orders; **not a bug**. Kitchen steps stopped after 2026-09-16 20:36 IST. 26 POS counter takeaway orders (cash captured, ₹8,652) plus 1 website delivery order (cash pending, ₹517). Same event path as completed orders; the stall predates and spans four builds; 0 app errors.
- **Effect.** These orders are missing from history and from COMPLETED totals.
- **Caveat.** A browser-side KDS button failure leaves no trace. The owner can settle by pressing Preparing on one old order at `/app/kds`.
- **Follow-up.** `ops-2` (queue 3.5): "handed over" on the POS for paid takeaway, and an alert for orders ACCEPTED for more than one business day. It changes the order status flow → owner yes to deploy. Cleanup of the 27 existing orders is the owner's call via normal buttons; I have not touched them.
- **Branch.** None. Not started. **Migration:** unknown until designed.

### 3.8 p3-order-copy / pay-ready — Razorpay readiness (queue 6)

> **QUESTION TO SETTLE BEFORE ANY RAZORPAY KEY GOES IN (owner, 2026-09-20):** should the Razorpay intent be created AFTER the order row instead of before it? Today `placeOrder` creates the intent first (the payment row needs its `providerOrderId`), so a pause landing in the ~1 s gateway round trip leaves one unpaid, unholdable intent with no order (accepted as a known limit while Razorpay is off in production; it cannot occur today). Creating it after the row would close that, but changes the payment flow (an order row would exist briefly without an intent, and the intent call could then fail after the row exists), so it is a money change: payments review + owner go/no-go. Decide before keys go in.

- **p3-order-copy.** Status `todo`, deps rc-13 (now live). Two defects, neither reachable in production while Razorpay is off:
  (a) the pending-payment copy "The shop can take payment when you collect/deliver" ignores `org.cashEnabled` and doesn't tell the customer to wait for confirmation;
  (b) a FAILED Razorpay payment is not `awaitingOnline`, so the retry path never shows.
  The `c209ce3` copy fix is in production; this is the remainder. The `pay-ready` commit `db5e520` ("Customer's confirm result carries the settlement code") was made to support it. **No branch of its own.**
- **pay-ready branch / head.** `agent/finance-ledger-pay-ready` @ `db5e520` (4 over `1fe080b`):
  - `79b7e60` pay-7: record online money the order cannot take; never store a failed capture; webhook retries on error codes.
  - `9af12f9` an order waiting on its online payment does not reach the kitchen.
  - `64aa967` tests for checkout and online-payment actions plus a permission-gate test for every server action.
  - `db5e520` confirm result carries the settlement code.
- **Left.** Refuse a NEW Razorpay intent for a pending online order while the shop is paused (ops-1 D4a; **never** refuse recording an already-captured payment). That needs ops-1 integrated first. Then the pending-payment copy (a) and failed-payment retry (b). Anything touching the Razorpay webhook: treat "does not exist" for another org as final, not a 500 (from red-team note `040a43`).
- **Review.** Reviewer RELIABILITY assigned; **no verdict recorded**. Treat as unreviewed. It is money and order placement: PAYMENT/RELIABILITY-style review is mandatory.
- **Tests.** Not recorded at the card level.
- **Migration.** None recorded.
- **Not live.** Razorpay is not configured in production (no keys, no Razorpay payments — read-only check). `pay-7` must ship **before** Razorpay keys are added. Owner go/no-go (money).
- **Rollback.** Code-only; the provider is off, so no money moves. **Unverified.**

### 3.9 p0-7 — internal authorization (queue 9, LATENT)

- **Branch / head.** None. Not started (`status: todo`).
- **Defects.**
  - (1) `inviteStaff` doesn't take actor roles and never applies the role ceiling that `deactivateStaff` and `changeStaffRole` apply. The only limit is which options the dropdown renders, so an ADMIN can mint an OWNER.
  - (2) Migration 0001 grants read across 35 tables to any org member regardless of role, and 0033 revoked writes only. Any staff login can read customers, payments, refunds and audit logs through PostgREST.
- **Owner answer (2026-09-19):** only OWNER accounts exist today. Both are LATENT (downgraded P1 → P2, not closed). **The trigger is the first ADMIN, ANALYST or CASHIER account. Fix before the first non-OWNER login is created.**
- **Left.** Everything. Auth/permissions and probably a migration (RLS read policies) → SECURITY subagent review, owner go/no-go.
- **Tests / review / rollback.** None yet.

---

## 4. Other work parked on branches (not on your list, but on GitHub)

- **Refund release / P0 branches** are all inside `49f858a` (live). The `agent/*-p0-*`, `agent/*-ref-*`, `release/rc-*` branches are history now.
- **`agent/backend--mu4xnzut` `49cb953`:** "Never let a malformed `DEPLOY_COMMIT` take `serverEnv()` down" (be-1 follow-up). Not confirmed as live.
- **Other unmerged agent branches:** `agent/database-dat-2` (integration suites per-worktree), `agent/reliability-mu4xrig7` (`0066e44` idem-1, withIdempotency scoped by org; **checked 2026-09-19: an ancestor of `kit-radix-nova` and of `49f858a`, so it is live**), `agent/gst-tax-mu4xpetj` (`eba2b9a` fin-1 org scoping), `agent/dwight-mu4xqbfl-loy2` (`97e3a92` org-scope `getStampAccountState`), `agent/pos-orders-mu4xqexi-kubf1` / `-ord8`, `agent/qa-mu4xr4hv` (`4be99a7`), `agent/finance-ledger-mu4xp10r`, `agent/michael-mu4lr1ro`, `fix/sign-out-and-email-verification`. **Their status was not recorded in this handover.** Use `git log kit-radix-nova..<branch>` and `git branch -r --contains` to check whether each is already in `49f858a`.
- **`iq-dashboard`** is a pre-existing branch that was 6 commits ahead of its upstream; now pushed too.

---

## 5. Owner decisions and rules (do not re-litigate)

### Standing rules and gates
- **Never** place, pay, cancel, refund or sign up a test order/payment/cash record in production. No asking for one. Prove things with the local stack, mocks, fixtures, or read-only checks.
- **Gates (ask first):** deploy with a migration or with changes to money, orders, auth or permissions; any production data write; anything needing a secret, a new account or spending; deleting anything; changing these rules.
- **Standing approval:** UI-only, no migration, no money/orders/auth/permissions change → may deploy while the shop is closed after all tests green + a fresh DB dump; then smoke, zero journal errors, RELEASES row, push, report. A failed smoke on such a deploy: code-only rollback to the last good RELEASES build is pre-approved. **Never roll back the database without the owner's yes.**
- **"Before you start" rule:** if the owner attaches a "before you start" condition to a yes, stop and wait for the answer before doing anything (this was broken once, on the 49f858a deploy).
- **Never:** copy customer data off the server; print/log a secret or ask for one in chat; force-push/reset/rebase shared branches; create a second Supabase project; put demo data in production; show a forecast as fact; compute authoritative totals in the UI (money is integer paise, server-side).
- **Release cadence (office rule, now yours to apply sensibly):** one card at a time; one builder + one reviewer, a second reviewer only for money, order placement, auth, permissions or migrations. Don't start something new while a finished slice has sat undeployed more than 48 h. Every bug fix proves its test fails without the fix. Each customer-facing release ends with the exact phone screens the owner should look at.
- **Go/no-go format:** changes for customers and staff; test numbers; reviews; migrations with undo scripts tested; whether a code-only rollback is safe; the rollback step; risks; what you need from the owner.
- **Verification is on frybirdiq.tech, not localhost** (CLAUDE.md). Nobody has a browser on the office side, so the owner does visual checks.
- **Commit trailers:** the office used `Agent: <ROLE>`; this session's trailer is `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

### Product / business
- Direct orders only (dine-in, takeaway, own website). No aggregators. Prices are GST-inclusive. INR only.
- Mission order: safe to launch > easy to pay > easy to find > customers return > runs the shop better.
- No production test orders (absolute; only the owner can change it, in an explicit message).
- Production has no Razorpay keys. `pay-7` must ship before keys are added.
- Migrations 0037 and 0038 (refund release) are live, in `49f858a`.
- The P0 launch-blocker branches are in `49f858a` (phone-leak fix, hours gate, overnight-hours guard, open/closed UI + phone display, phone settings path, category archiving, alerting code). Alerting is built but **not installed**, see §6.

### ops-1 owner requirements (2026-09-19; these override the office's earlier "no auto-reopen")
1. One switch, "Shop is OPEN for orders" / "Shop is CLOSED for orders", the same setting in TWO places: the POS screen and Admin → Restaurant (phone-usable). Switching OFF asks "until we next open" (**default**, reopens automatically) or "until I switch it back on". Both places always show state: who, when, and when it reopens. Every switch writes an audit row.
2. A website banner at the top of EVERY customer page (home, menu, item, cart, checkout, order tracking).
   - Hours-closed: "We're closed right now. We open [day] at [time]."
   - Switch-closed: "We're not taking orders right now." plus "We open again [day] at [time]" or "Please check back soon" for manual-only.
   - Tappable call link if a shop phone is set.
   - While switch-closed: order buttons and checkout disabled with a short reason; no ASAP, no pre-orders; tracking of existing orders works normally.
   - Readable at 375 px, both themes, must not look like part of the top bar.
3. The server refuses regardless of a stale page or bypass. Tests: off → refused; on → accepted; auto-reopen at next opening; manual-only stays closed; banner text per state.
4. Release needs the owner's yes. Afterwards, give the owner the exact phone screens to check.

### ops-3 owner requirements (day off + planned closures; after ops-1, not in it)
1. Weekly off: any weekday can be "Closed all day" in Admin → Restaurant → hours. Owner's day: **TBD**.
2. A closed-dates list (date or range + optional public note, e.g. "Closed for Diwali"); add weeks ahead; remove.
3. The switch (POS + Admin) gains "Closed for the rest of today" and "Closed until a date I pick"; all except manual-only reopen automatically at the opening time of the chosen day.
4. Banner on a day off: "We're closed today. We open again [day] at [time]." plus the public note. Next opening skips off days and closed dates.
5. Server refuses ASAP on a closed day and pre-orders for any closed day/date; the time picker never offers a closed day; adding a closed date that has pre-orders shows how many and which, and **never auto-cancels**.
6. Migration expected → go/no-go.

### Other owner answers on record
- Only OWNER accounts exist today (answer to p0-7; 2026-09-19).
- The integration branch is `kit-radix-nova`; `origin/claude/v2-evolution` is out of scope.
- The release record is `docs/RELEASES.md` (no DB table). No down SQL for deployed migrations 0027–0032.
- Offsite backup: Backblaze B2 within the free 10 GB, no paid Supabase plan; the owner does the B2 setup himself from the numbered list; a restore of current data goes to a scratch DB only, and needs his yes.
- Models: routine UI work is fine on the cheaper model; money, orders, auth and migrations get the stronger model plus a reviewer.
- Owner approved the engine migrations 0034–0036 and job runner (dec-1/dec-2) — already live in `6ec290c`.

---

## 6. Waiting on the owner

1. **Shop phone number** — enter in Admin → Restaurant (the site still has no phone).
2. **Alerting install** — DEPLOY.md §11.2 (VPS change) plus a monitoring account and its long random topic URL. Alerting is **two sibling branches**, `agent/backend-p0-1-health` `af6b114` and `agent/devops-release-p0-1` `49bfef2`; taking only one silences job alerting. Both are already inside `49f858a`; the install is not done. Also an uptime monitor.
3. **p1-backup** (`blk-4`, `blk-5`, `dec-8`): B2 bucket + key on the VPS, age public key, yes to install the script, yes to a scratch-database restore.
4. **Weekly off day** for ops-3.
5. **seo-1 descriptions** — approve the 15 item descriptions and allow the production menu-data write; nginx `robots.txt` Sitemap line.
6. **Browser looks** (nobody else can): the closed-shop strip on the live site (`p0-3e`), plus seo-1, loy-web and ops-1 banner/POS/Admin at 375 px and 1280 px.
7. **Go/no-go decisions** when ready: ops-1 (migration 0039), pay-ready (money), p0-7 fix (auth), ops-2 (order status flow), IQ-2 rollout.
8. **The 27 ACCEPTED orders** — settle or leave them; they distort history and COMPLETED totals.
9. **Decision queue:** `dec-3` history export for backtests; `dec-4` which A1 automatic actions; `dec-5` consent wording and win-back messaging; `dec-6` Anthropic key and monthly cap for Ask FRYBIRD; `dec-7` food-cost target; `dec-9` GST on refunds (credit note vs keep tax as charged); `dec-11` CA questions (ITC, points vs taxable value, tax point, delivery-fee SAC/rate); `dec-12` who approves A2 actions and the `iq_*` retention policy; `dec-13` whether ANALYST/ADMIN see money on IQ pages. GST registration status was a conditional launch blocker in the audit.
10. **`blk-3`** the temps switch (moot now the office is closed).

---

## 7. Practical notes for the next session

- Root is `~/Downloads/Frybirdiq`, branch `kit-radix-nova` @ `1fe080b`, clean. The worktrees live under `~/FRYBIRD-IQ/worktrees/`; several branches are checked out there, and git refuses to check out the same branch twice. Work in a worktree or use `git worktree list` first.
- Untracked junk in some worktrees (`.pnpm-store/`, `.worktree-setup-build.log`) was deliberately **not** committed.
- The hive is at `~/FRYBIRD-IQ/hive/` (`board.md`, `tasks.json`, `reviews/`, `research/launch-audit/`). It is a record, not something to keep running.
- Production deploy details: `docs/DEPLOY.md` §10 (steps), §11.2 (alerting), `deploy/backup.sh`. The release record is `docs/RELEASES.md`.
- Integration tests need the local Supabase stack (`supabase start`, `.env.test.local`); see CLAUDE.md.

---

## 8. Update, 2026-09-19 (session after the handover)

- **Release 1 is live:** `383e693` (seo-1 + loy-web), BUILD_ID `QfcS3cFFTWYktErhEU-8Q`, RELEASES row 4; nginx `robots.txt` Sitemap line applied, row 5. Production migration head is still 0038. `kit-radix-nova` is fast-forwarded to each released commit (owner: keep doing this after every release).
- **Parked, not started:** the 15 item descriptions. Owner will supply the real menu facts another day; nothing is written to the live menu. The drafts in `~/FRYBIRD-IQ/hive/research/seo-1-descriptions.md` are not to be rewritten yet.
- **Queued right after Release 2 (owner card): stale staff screens.** After a deploy, POS, KDS, the orders board and Admin keep running the old client until someone reloads them (seen live after row 4: a pre-deploy tab logged `Failed to find Server Action` about every 30 s). Add a version check on those screens; when the BUILD_ID changes show "New version — tap to reload"; reload automatically when the screen is idle with no order in progress.
- **Order now:** Release 2 (ops-1 Close Shop) -> stale-screen version check -> day-off card (ops-3) -> the rest of the §2 queue.
- **Owner rule (2026-09-19, after the nginx slip): scripts run against the server are fail-fast.** A script stops at its first failed step. Never continue to a test, reload, restart or migration after an earlier step in the same script failed (`set -euo pipefail`, explicit checks, hard exit on a failed assertion; do not chain steps with `;`).

## 9. Update, 2026-09-20 (Release 2, Close Shop)

- **Release 2 is live:** `9a826ee` on `release/rc-15-close-shop`, BUILD_ID `dNGopFZJ3CH4nlRg2eCI-`, migration head `0039_ordering_pause`, RELEASES row 6. Rule 2 (live pause/resume check) is done by the owner from Admin -> Restaurant; the result is recorded in the row after it.
- **Owner rule (2026-09-20): server scripts are fail-fast** (see §8).
- **Owner decisions:** an already-placed pending-payment order may still be paid while paused (comment fixed, display-only hide); no copy changes now; the low findings below stay as they are.
- **Next card (queued by the owner, order-placement change, reviewed as such):** re-check pause AND hours inside the order write transaction (today the gate runs once at the start; a pause pressed during pricing and the Razorpay intent can still let one order in, milliseconds to seconds), plus a read timeout on the customer-page status read (`getCustomerOrderingStatus`: a hung read hangs the page; the page must fail open, the server still refuses).
- **Low findings left as they are (RELIABILITY / SECURITY, 2026-09-20):**
  1. Equal-mode second pause: the second person's reason is not recorded; they are told "your choice was not applied", not that the reason was dropped.
  2. A pause can only get stricter; shortening "until I switch it back on" to "until we next open" means Resume then Pause (brief open window).
  3. `pauseOrdering` locks with `FOR UPDATE`; `FOR NO KEY UPDATE` would not stall order inserts for milliseconds.
  4. If a pause succeeds but the follow-up read throws, the action says "didn't save"; a retry shows "not applied".
  5. Reason buttons are tappable before the "orders restart" preview loads (deliberate, emergency).
  6. Admin Resume is one tap; the POS asks for two.
  7. Banner while switched off "until I switch it back on" outside opening hours says "Please check back soon" (`withinHours` exists but is unused).
  8. `getOrg` on customer pages is unguarded: a database outage still takes the pages down (the status read alone fails open).
  9. Customer order page hides the pay button while paused, display only; the payment action has no pause check (owner: keep).
  10. POS page loads the staff status (name, reason) for anyone with `orders.create`; only staff, only OWNER accounts exist today.
  11. Admin panel's `pauseOutcome` parity with the POS logic was not reviewed line by line (it has its own tests).
  12. 0039's header comment says the staff form requires 3-200 characters; the form is now preset + optional note (max 169 stored). Cosmetic.
- **Order now:** stale-screen version check card -> the write-time re-check + status timeout card -> day-off card (ops-3) -> the rest of §2. (Owner set the first; the second sits right after Release 2 by owner decision 4.)

## 10. Owner card queued 2026-09-20: SHOP STATUS PILL (after the version-check card, before the day-off card)

Order now: version-check card -> **status pill** -> write-time re-check + status timeout card -> day-off card (ops-3) -> the rest. (Owner set the pill's place: after version-check, before day-off; the re-check card was queued before it and stays ahead of day-off.)

- **What.** A status pill in the staff top bar, left of "Test alarm", on every staff screen (Admin, POS, KDS, orders board). A shortcut to the existing Close Shop control: same server action, same state (`getOrderingStatusForStaff`), no second source of truth. The full panel stays in Admin -> Restaurant; the avatar menu stays account-only.
- **States (text + icon + colour, never colour alone).** Open: green dot "Open · until 11:00 PM". Closed by hours: grey dot "Closed · opens 11:30 AM". Orders switched off: red dot "Orders OFF · until 11:30 AM" or "Orders OFF · until switched on". At 375 px: dot plus one word (Open / Closed / Off).
- **Tap.** Popover on desktop, bottom sheet on phone: status line (when off: who, when, why); today's hours and "orders still to make"; one primary action ("Switch online orders off…" opens the same dialog with duration options and one-tap reasons; "Switch orders back on" when off); link "Edit opening hours" -> Admin -> Restaurant. Roles that cannot close the shop see it read-only, no button.
- **Behaviour.** Updates at once after a switch and within 60 s on other screens (realtime if cheap). Every state comes from the server; if a switch did not apply, say so. Announce status changes, trap focus in the popover, 44 px targets, contrast checked in both themes.
- **Also fix (same card).** Dialog cancel button "Keep taking orders" -> "Cancel". Explain "orders still to make" (below).
- **Tests.** Each state and its text; read-only role; collapse at 375 px; a switch from the pill writes the same audit record as one from Admin.
- **Release rule.** Display code plus reuse of the existing action, no migration: standing approval while the shop is closed. If it touches the pause action, permissions or order placement: go/no-go to the owner. After release: tell the owner which phone screens to check.
- **What "Orders still to make" counts (verified in code and on the live database, 2026-09-20).** `countOrdersStillDue` (`src/lib/repositories/shop-status.ts`): every order of this shop, any channel (website and counter), any age, whose status is not COMPLETED, CANCELLED, FAILED, REFUNDED or DRAFT. PENDING_PAYMENT counts. It does not look at time or kitchen stage, so an old order nobody closed counts forever. Live today: **1** (one ACCEPTED ONLINE order from 2026-09-16). The earlier "27 ACCEPTED orders" are no longer open in production: they were closed since the handover (not by me). The label says "to make", but the number is really "not finished"; the ops-2 card (close paid counter orders / alert on old ACCEPTED) is what keeps it honest.

## 11. Update, 2026-09-20 (Release 3: version check + status pill)

- **Release 3 is live:** `4e6c6fe`, BUILD_ID `6b9c1b3950382ca5`, RELEASES row 7, no migration (head still 0039). UI only; server side unchanged.
- **Owner decisions recorded:**
  - Order #1226 (ONLINE DELIVERY, Rs 517, 16 Sep, cash on delivery still PENDING, ACCEPTED) is **parked**: do nothing on it until the owner decides.
  - The Close Shop live check is **closed**. The audit record (`ordering_paused` 02:25:46 IST, mode until-switched-on, reason "Other"; `ordering_resumed` 02:25:48, both under the owner's name) is the evidence. **Nobody has watched the paused banner live; the first real pause is the observation.**
  - The 26 counter orders that left ACCEPTED at 02:17-02:20 IST on 2026-09-20 went ACCEPTED -> PREPARING -> READY -> COMPLETED one at a time under the owner's account. Every change has an order_event (0 without); status changes write no audit_logs row by design; no loyalty, payment or stock side effects; sales stay on their original dates.
- **Done:** version-check card; status pill card (with two-step Admin resume, "Cancel", "Orders not finished"). Realtime was not used: the pill converges by its own 60 s poll of the same read, and same-tab controls share state through `status-bus.ts`.
- **Low findings left as they are (independent review of Release 3):**
  1. `/api/version` is not excluded from the `proxy.ts` matcher, so each poll pays a Supabase session refresh (cost only; excluding it touches auth code, so it is left for a reviewed change).
  2. The auto-reload fires 5 s after the state flips; if the server is mid-restart it can land on an error page (the cooldown prevents a loop).
  3. POS has two hook instances (header switch and pill): 2 status reads a minute on POS; the morning prompt checks only its own instance and can open over the pill's dialog; both render a polite live region so a screen reader may announce a change twice; Admin's panel does not use the bus (it converges through revalidate and the poll).
  4. Focus hand-over from the pill's popover/sheet to the dialog and the screen-reader announcements were not verified in a browser.
  5. `useIsMobile` is false on the server, so a phone briefly renders the desktop popover before switching to the sheet (no hydration error).
  6. The layout reads the shop status and hours sequentially on every staff layout render.
  7. Only the POS marks "order in progress"; KDS and the orders board hold no local state, so a reload loses nothing there. Any filled-in text field (even a search box) blocks the automatic reload; the tap still works.
- **Order now:** write-time re-check of pause and hours inside the order transaction + status-read timeout (GATED: order placement) -> day-off card (ops-3; gated if it needs a migration) -> the rest of section 2.

## 12. Card 3 built, waiting for the owner's go (2026-09-20): write-time re-check + status timeout

- **Branch:** `release/rc-17-recheck` @ `c502556` (pushed). NOT deployed. Order placement, so it needs the owner's go/no-go. No migration. Rollback: code-only, redeploy `4e6c6fe` (BUILD_ID `6b9c1b3950382ca5`).
- **What:** `placeOrder` re-decides the ordering gate (pause, ASAP hours, scheduled slot) at the moment of writing: an early fresh re-read at the top of `writeOrder` (thrown, so `withIdempotency` releases its claim and a refusal is never replayed), and inside `persistOrder(gate)` the order-row insert runs in a transaction that first takes `FOR SHARE` on the org row and re-decides the gate; `pauseOrdering` takes `FOR UPDATE` on the same row, so they serialise. Website only; the counter passes no gate and stays ungated. `readStatusSafely` now times out after 2.5 s (page fails open, server still refuses).
- **Tests / proofs:** unit 2368, integration 487 (new file `place-order-write-gate.integration.test.ts`, 9 tests, stable over 3 runs). Fail-first: both checks removed fails 6/8; locked check removed fails its test; refusal returned instead of thrown fails 2; early check removed fails the no-customer-write assertion; timeout removed fails its test. A first version of the test hook fired before the top gate and proved nothing; caught and fixed before any claim was made.
- **Reviews:** payments no veto (AGREE); reliability AGREE (no blocker); security AGREE (no blocker); QA-release 7/7 gates.
- **Accepted low findings (owner may overrule):** (1) a pause landing in the millisecond window after the early check burns a limited-use promo slot and leaves a guest customer row for a refused order (optional fix: claim the promo after the gate); (2) a scheduled slot picked at exactly the 20-minute edge can be refused on the fresh clock (optional fix: keep the lead test on the first clock); (3) an unpaid Razorpay intent is left when an online order is refused (harmless, already possible); (4) real concurrent-load lock behaviour not measured; (5) a slow database makes every customer page wait up to 2.5 s for the status read; (6) items, events and the payment row are still separate statements after the order row (unchanged, pre-existing).
- **Order now:** deploy decision for card 3 (waiting on the owner) -> day-off card (ops-3; gated if it needs a migration) -> the rest of section 2.

## 13. Card 3 re-cut with hardening (a), 2026-09-20: new go/no-go sent, NOT deployed

- **Why:** the owner's deploy condition "an order refused by the new write-time check leaves nothing behind (no promo use, points, stamps, stock, order row, payment intent)" was not true at `c502556`: a pause landing in the millisecond window after the early check consumed a limited-use promo slot. Owner's rule: do hardening (a), re-run reviewers and QA, send a new go/no-go instead of deploying.
- **Branch:** `release/rc-17-recheck` @ `207aacd` (pushed), on top of `c502556`. No migration. Rollback: code-only, redeploy `4e6c6fe` (BUILD_ID `6b9c1b3950382ca5`); safe at any time; nothing to undo in the database.
- **What changed:** `claimPromotionUse(orgId, code, executor)`; `persistOrder(gate.promoCode)` claims the slot in the SAME locked transaction after the gate passed (`PromoLimitReached` thrown, mapped to the offer message, releases the idempotency claim); `placeOrder` does a fresh gate read immediately before `createIntent` (online payment).
- **Proofs (fail-first):** old claim placement fails 3; no pre-intent check fails 1; no claim fails 2; plus the earlier five. Tests assert a refused order leaves no order row, promo use, payment row, points, stamps or stock rows, and that after reopening the same key and code consume exactly one slot.
- **Reviews on `207aacd`:** payments no veto (AGREE); reliability AGREE (nothing above low); QA 7/7 (unit 2368, integration 492, new file 14/14 stable x3). Security reviewed `c502556` (AGREE); the delta adds no auth, scoping or message change.
- **Still true (cannot be closed without provider cancellation or restructuring online payment):** a pause landing in the roughly one-second gateway round trip after a Razorpay intent is created leaves one unpaid intent with no order (cannot be charged; asserted in a test named KNOWN RESIDUE); a guest customer row can remain from a refused attempt in the millisecond window. Neither holds money.

## 14. Update, 2026-09-20 (Release 4: card 3 live)

- **Release 4 is live:** `207aacd`, BUILD_ID `efd32b5a1f11057e`, RELEASES row 8, no migration (head 0039). Rollback: code-only, redeploy `4e6c6fe` (BUILD_ID `6b9c1b3950382ca5`).
- **Owner decisions:** (1) the unpaid Razorpay intent in the ~1 s window after an intent is created: accepted for now; added to the pay-ready card (3.8) as a question to settle BEFORE Razorpay keys go in (Razorpay is off in production, so it cannot occur today). (2) The guest customer record left by a refused attempt: **accepted**. It holds no money, and the customer gave those details in order to place an order. (3) Optional hardening (b) (keep the scheduled-slot lead test on the first clock) left as is.
- **Live observation still owed:** nobody has watched a real pause on the live site (banner or write-time refusal). The first real pause is the observation.
- **Order now:** day-off card (ops-3; gated: migration) -> the rest of section 2. The owner runs `/compact` before it starts.

## 15. Card 4 built, waiting for the owner's go (2026-09-20): day off + planned closures (ops-3)

- **Branch:** `release/rc-18-day-off` (pushed once the go/no-go is sent). NOT deployed. GATED: migration 0040 and order placement. Rollback: code-only is safe for the database (live build `207aacd` passes all 492 integration tests with 0040 present), but the old code ignores closures, so **before rolling code back on or before a closed day, switch orders off by hand ("until I switch it back on")**; resume ordering after. Never run the 0040 down script before the code rollback; it refuses while a weekly day or an upcoming closed date exists.
- **What:** `organizations.weekly_closed_days smallint[]` and table `closed_dates` (0040, expand-only, RLS forced). One module, `src/lib/orders/closures.ts`, answers "is this business date closed"; `sessionStartDate` (the single source under `isOpenAt`, the picker and the validator) treats a session on a closed day as not open, `nextOpening` skips closed days, the write gate reads closures under the same `FOR SHARE` lock as the pause (closures are written under `FOR UPDATE` on the org row, so a closure and an in-flight order cannot pass each other). Switch gains "Closed for the rest of today" and "Closed until a date I pick" (max 60 days); both end at an opening time the server computes. Banner "We're closed today. We open again [day] at [time]." plus the public note; pill "Closed today · opens Wed 11:30 AM"; Admin -> Restaurant "Days closed" panel (weekly checkboxes, dated list, pre-order impact list; nothing is ever cancelled); staff pill popover shows "Pre-orders booked for a closed day: N"; site JSON-LD and the home page say "Open daily except Tuesday".
- **Owner data step:** Tuesday (`weekly_closed_days = {2}`) is NOT set by the migration. It is set after the deploy, on the owner's yes, either by the owner ticking Tuesday in Admin -> Restaurant (audited under his name) or by one audited statement run by the session. Production has had no pre-order ever, so nothing is affected at marking.
- **Reviews:** security no blocker/high; red team no blocker/high (two mediums fixed: home "Open daily" label, "choose a time" offered with nothing to choose; also fixed: closed-day wording on a refused pre-order, double-submit duplicate closures, bounded impact query, exposure allow-list for the customer-name reads).
- **Known lows, not changed:** pill query cost grows with order history when a weekly day is set (same pattern as `countOrdersStillDue`; add a partial index on `scheduled_for` if it ever shows); `pauseCarriedOver` ignores closures, so a multi-day "until a date" pause re-asks "keep paused or resume?" each morning; a paused pill can still say "until Wed" if Wednesday later becomes a closure (the gate is right); overnight-hours listing by calendar date (unreachable: settings refuse overnight hours); checkout fails open on a status read error (server still refuses, now with the closed-day wording); Smart-86 and inventory projections still size a week as seven open days.
- **Watch item:** `iq-insights-recommendations.integration.test.ts` (M1(b) race test) failed once in three full-suite runs during QA and passed 6/6 in isolation on the live commit; load-sensitive, not related to ops-3.
- **First Tuesday check (owner asked for care):** read-only: `/` and `/menu` show "We're closed today…"; checkout picker lists Tuesday as "we're closed"; pill says "Closed today"; a query lists any pre-order booked for that Tuesday (number, time, status, no phone copied). No order placed by me.
- **Order now:** deploy decision for ops-3 (waiting on the owner) -> the rest of section 2.

## 16. Update, 2026-09-20 (Release 5: day off live)

- **Release 5 is live:** `eddba18`, BUILD_ID `f094f7a2953c1cc7`, migration head 0040, RELEASES row 9. Tuesday is marked closed all day (option A, one audited statement). Rollback: see RELEASES row 9 and MIGRATION-RECOVERY 4g (switch orders off first).
- **Owner decisions:** deploy while closed, Tuesday by option A; first Tuesday check on 2026-09-22 (read-only, place nothing, switch nothing); log the IQ insights flake as a low card.
- **Low card `iq-flaky-1`:** `iq-insights-recommendations.integration.test.ts` "M1(b): a proposal racing the supersede of its evidence is refused instead of resting on a SUPERSEDED insight" failed once in three full-suite QA runs (2026-09-20, `6ca6095`, run under load) and passed 6/6 in isolation on the live commit and 3/3 full-suite runs on `eddba18`. Load-sensitive race test; not caused by ops-3. Investigate when the IQ-2 work is next touched.
- **Order now:** the autonomous queue the owner pastes next, then the rest of section 2.

## 17. AUTONOMOUS QUEUE (owner, 2026-09-20, after Release 5) — the working order until it is done

Rules for this queue (owner's words, condensed): one card at a time, in order. Before each card write state here. Before showing the owner anything run the owner-guide subagent; reviewer subagents for money, order placement, auth, permissions, migrations; QA-release on everything; every fix proven fail-first. UI-only, no migration: standing approval (confirm shop closed: open 11:30-23:00 IST, closed all day Tuesday; fresh dump; fail-fast scripts; smoke, zero journal errors, RELEASES row, push, fast-forward; then tell the owner the phone screens). Migration, production data write, or any change to money/orders/auth/permissions: ONE go/no-go, then WAIT for the yes. A card blocked on the owner: do all preparation, park it under "waiting on owner", move on. Never: test orders/payments/refunds in production; print secrets; copy customer data off the server; force-push/reset/rebase; pause/resume the live shop. Reporting: one message at every go/no-go and after every release; once a day one summary of at most 12 lines (live / shipped / in progress / waiting on owner).

Cards, in order:
1. **IQ-2** (daily brief, reconciliation, detectors) + **IQ READINESS panel** (read-only owner-dashboard screen from `iq_daily_trust` and live tables: five scores as percent with trend — orders closed the same day; cash payments recorded for completed cash orders; top-20 items with a recipe; days since last stock count (red over 7); orders with a customer attached — plus one overall "IQ readiness" percent and the single most useful action for today; every insight card gets a "limited" badge when a score it depends on is under 80%; every number a labelled fact from stored data, no forecasts, changes nothing; the daily brief includes the readiness percent and the one action). Gated if it needs a migration or server job changes; otherwise ship as UI.
2. **Razorpay readiness (pay-ready)**, gated, no keys (the owner's step): p3-order-copy incl. whether an unpaid online order reaches the kitchen; pay-7; the intent-after-order-row question; tests for submitCheckout, confirmOnlinePaymentAction and the webhook route; one test that fails if any permission gate is removed.
3. **Cash sessions 5.1, rider cash handover 5.2, reconciliation view 5.3**, gated.
4. **p0-7** (ADMIN can create an OWNER; role-blind reads), gated. Must be live before card 5.
5. **Rider assignment 6.3**, gated.
6. **Prep targets 4.1, then kitchen stations 4.2**, gated. Stations FRY, ASSEMBLY, DRINKS, PACK, plus an EXPO view.
7. **WhatsApp order updates 7.2** behind a provider mock. No provider account, no messages sent.
Small cards to slot between: `iq-flaky-1`; the first Tuesday check on 2026-09-22 (read-only).
PARKED, do not start: item descriptions, order #1226, offsite backups (until the owner creates the storage account).

State now: Release 5 live (`eddba18`, migration 0040, Tuesday marked). Working tree on `kit-radix-nova` @ `04975ad`. Starting card 1.

## 18. Card 1a built (2026-09-20): IQ readiness panel (UI-only, read-only, no migration)

- **Branch:** `release/rc-19-iq-readiness`. Panel on the IQ overview (under the KPI row) and on the AI brief page (with the one-line "readiness + action"); "Limited data" badge (visible reasons) on Payment methods, Top products, Attention, Channels and Net profit. Live-table counts, because `iq_daily_trust` is EMPTY in production and no fact job is scheduled there (only heartbeat and backup timers exist).
- **Reviews:** owner-guide review (a general-purpose reviewer; no agent by that name exists in `.claude/agents`): 3 must-fix (stock-count score punishing good counting; cash score blind to orders with no payment row; badge reasons hidden on phones), 8 should-fix. All wording/definition/badge items fixed; QA 7/7 on `f87cd2c`, re-run on the fixed commit.
- **Known limits, stated on the screen or here:** (1) `countStock` writes nothing when a count matches the balance, so the stock score is a floor (card `stock-count-trace`, low: write an audit row for a zero-difference count, then score from that); (2) the cash score cannot see a completed order that has no payment row at all (card `cash-no-payment-row`, low: needs a definition of "cash order" that does not depend on the payment row); (3) Revenue / Paid orders / Average order KPIs are not badged even though they too rest on closed and paid orders; (4) recipe trend is rebuilt from recipe creation dates; (5) the brief page shows the line AND the panel (repeat, harmless).
- **Card 1b still to do:** IQ-2 integration itself (daily brief job, reconciliation, detectors; nine unmerged branches, one blocking finding `iq2-s5c`). Needs server job changes, so it is a go/no-go.

## 19. Update, 2026-09-20 (Release 6: IQ readiness panel live)

- **Release 6 is live:** `e4d791b`, BUILD_ID `05c95a9e11be8ef4`, RELEASES row 10, no migration (head 0040). Rollback: code-only, redeploy `eddba18` (`f094f7a2953c1cc7`).
- **First readings in production (facts):** closed the same day 22 of 67 (33%); cash recorded 64 of 64 (100%); 20 best sellers with a recipe 1 (5%); stock counts 0 of 6 ingredients, never counted; orders with a customer 9 of 64 (14%). Overall about 30%. The 33% is mostly the old counter orders left in ACCEPTED (order #1226 parked; the 26 counter orders are the ops-2 card).
- **Low cards:** `readiness-safe-1` (the Overview page has no fallback if a readiness query ever throws: wrap in a safe read and hide the panel); `stock-count-trace`, `cash-no-payment-row` (see section 18); `iq-flaky-1`.
- **Order now:** card 1b (IQ-2 integration: gated), then card 2 (pay-ready, gated), then the rest of section 17.

## 21. Card 2 built (2026-09-20): Razorpay readiness (pay-ready), waiting for the owner's go/no-go (GATED: money and order placement). NO keys go in; that is the owner's step.

- **Branch:** `release/rc-21-pay-ready` (pushed), from `kit-radix-nova` `089e776`, merging `agent/finance-ledger-pay-ready` (pay-7; unpaid online order does not reach the kitchen; tests for checkout, online-payment actions, webhook; permission-gate test) with no conflicts; the merged `orders.ts` write gate and the kitchen rule were checked for coherence (architect: coherent). No migration.
- **Reviews and what they changed (all fixed, fail-first where observable):** payments (no veto): a 401/403/408 from Razorpay's payment fetch was a FINAL decline (webhook marked processed, money never recorded) -> now retryable; security (no blocker): a phone number alone returned another customer's unpaid order id (`resumeOrderId`) -> only the signed-in owner gets the link; `confirmOnlinePaymentAction` distinguished unknown order / other gateway order / bad signature -> one generic answer; `getOrder` was not org-scoped and loaded every modifier row -> scoped and bounded; the permission-gate test could be satisfied without a real gate (dead branch, discarded `can()`, `obj.can`, comment above the directive, default/named/wrapped exports) -> extractor hardened, with its own bypass tests; architect (coherent): a crash between the order row and its payment row would let staff accept an unpaid online order -> a website order with no payment row now waits (fails closed); the staff card no longer offers an Accept the server will refuse (cash button releases it); the paused order page now says the kitchen starts once paid; a retryable gateway failure now tells the customer "we're checking with the bank, please don't pay again" (never the gateway's own words) and offers only "Check again", not a second payment. Copy: the order page no longer promises payment on collection.
- **Owner question (intent after the order row?):** payments recommends KEEP the intent first. An orphan inert intent costs nothing (unpaid, expires, the customer never receives its id); order-first leaves an order row with no intent whenever the gateway call fails, which needs a cleanup job for abandoned PENDING_PAYMENT rows, inflates open-order and closed-same-day metrics and complicates idempotency. The write-time gate and lock already narrowed the window to the gateway round trip.
- **Known lows / cards:** `pay-anchor-required` (webhook with no order_id and an already-settled pending row captures unbound to a Razorpay order; signed and fetched, small); `paid-predicate-1` (readers that count any CAPTURED as paid should exclude unapplied rows: orders.ts staff `isPaid` and the COMPLETED/cancel gates, receipt, promotions, iq-trust, iq-readiness); `pay-authorized-1` (an 'authorized' payment on a manual-capture account 500s ~24 h); `notify-copy-1` (`notifications/messages.ts` says "Pay at the counter when you collect" for any unpaid order, including one waiting on online payment); `cookie-sign-1` (the `frybird_contact` cookie is unsigned JSON; `viewerOwnsOrder` trusts phone-match; needs a server secret, an owner step); `getorder-perf` (not observable in a test; scoping and the modifier filter are by code review); orders board stays a full-page read.
- **Before keys go in (owner):** (1) decide the intent question (recommendation above); (2) go/no-go for THIS branch; (3) then the keys, and a real-money test the owner runs himself (I never place, pay or refund in production).
- **Order now:** go/no-go for cards 1b and 2 (both waiting on the owner), then card 3 (cash sessions 5.1), then section 17.

## 20. Card 1b built (2026-09-20): IQ-2 integrated, waiting for the owner's go/no-go (GATED: server jobs = production data writes)

- **Branch:** `release/rc-20-iq2` (pushed), from `kit-radix-nova` `089e776`, merging `agent/automation-architect-iq2-adapt` (contains S4 reconcile, S9 pulse, S10 brief), `agent/iq-engine-iq2-s10a` (brief loader + run-state read; one conflict, union of imports in `iq-job-runs.ts`), `agent/frontend-mu4xp5yj` (insight components) and `agent/iq-engine-iq2-s11b` (detections on the alerts page). NOT merged: S5 signatures (`iq2-s5c` blocking: `double_capture` never clears); the brief lists the "signatures" check as not run until it ships, so it never says all-clear for finance viewers. No migration.
- **New here:** Daily brief page (`/app/iq/brief`, composed at read time from stored insights, readiness line and panel above), four timers (nightly facts, reconciliation, detection, brief) with DEPLOY.md 9.6 install/verify/stop/remove steps, refund-status fix in reconciliation (a FAILED refund no longer raises a money finding; fail-first proven).
- **Reviews:** security no blocker/high/medium (lows: parity lines visible to all analytics viewers; hourly check can read SUCCEEDED with missing hours). Payments no veto (H1 fixed; M1 cancelled-with-capture not detected, M2 GST rate not recomputed, M3 delivery-fee GST ignores price_basis, L1 zero-total orders, L2 unused fees: logged as cards `recon-*`). DevOps no blocker (HIGH-1 docs: done; HIGH-2 no alerting installed: owner decision). QA 7/7 on `ecc1ead` (unit 2611, integration 554 x3); re-run on the final commit.
- **Production facts checked read-only:** invoices 91, no gaps or duplicates; refunds 0; no zero-total paid orders; 10 days of orders (2026-09-10 to 09-19), so detectors will say "not enough history" for weeks and the brief will be thin at first.
- **Owner decisions needed (in the go/no-go):** install the four timers now or after alerting; accept silent failures until then; run the one-time history fill by hand.
- **Order now:** go/no-go for card 1b (waiting on the owner), then card 2 (pay-ready, gated), then section 17.


## 24. Owner rule change (2026-09-20, evening): deploys no longer wait for closing time, they wait for a quiet shop
The shop is not using the POS at the counter right now. **Before any deploy, do a read-only check on production** (ssh, `PGOPTIONS='-c default_transaction_read_only=on'`, `orders` table):
1. **No order in progress:** nothing created in the last 3 hours whose status is not COMPLETED, CANCELLED, FAILED or REFUNDED.
2. **No website order in the last 60 minutes:** `channel = 'ONLINE'`, `created_at` within 60 minutes.
If both are clear, deploy now. If not, wait (re-check; at the latest the shop closes at 23:00 IST, closed all day Tuesday). This replaces "deploy only while the shop is closed"; every other gate (go/no-go, fresh dump, fail-fast, smoke, zero journal errors) is unchanged.
- **IQ-2 approved by the owner** under this check: fresh dump first, every step fail-fast, install all four timers plus the alerting unit files (no `ALERT_URL` exists: the owner has not given one, so alerts stay unconfigured and show in `systemctl --failed`), run the one-time history fill, report parity of the brief against the P&L page.
- **Release order (owner):** one gated release at a time; each starts only after a clean report of the one before and at least 30 minutes of clean journal in between. After a clean IQ-2 report: Razorpay readiness go/no-go, then the till.
- **Payments direction:** Paytm Business API later. Ship Razorpay readiness anyway (tests, webhook hardening, permission-gate test, order-page fixes protect any provider). No Razorpay keys. **New card after the till: "Paytm provider"** behind `PaymentProvider` (create payment, verify callback/webhook signature, refund, status check), recorded fixtures and mocks only, no account/keys/real calls; read Paytm's official API docs first and list what the owner must obtain (merchant ID, keys, webhook URL, settlement details); gated like all payment code.
- **Pre-deploy check at 21:25 IST on 2026-09-20:** 1 order in progress, 2 website orders in the last hour: not clear, waiting.

## 22. Queue state (2026-09-20, before card 3)

- **Live:** Release 5 (`eddba18`, day off, migration 0040) and Release 6 (`e4d791b`, IQ readiness). `kit-radix-nova` `089e776` (+ this note).
- **Waiting on the owner (go/no-go):** card 1b (`release/rc-20-iq2` `3de03a0`: IQ-2 daily brief page + four nightly timers; needs the decisions in section 20) and card 2 (`release/rc-21-pay-ready` `5d4ca97`: Razorpay readiness, no keys; see section 21). Neither is deployed.
- **Starting now:** card 3, cash sessions 5.1 -> rider cash handover 5.2 -> reconciliation view 5.3 (GATED: money + migration expected).

## 23. Card 3 built (2026-09-20): the till (cash sessions, rider handover, reconciliation), waiting on reviews then the owner's go/no-go (GATED: money + migration 0041)

- **Branch:** `release/rc-22-cash-sessions` (from `kit-radix-nova`, independent of rc-20 and rc-21). Migration 0041 (`cash_sessions`, `cash_handovers`, four columns on `payments`), undo script that refuses while any till history exists (drilled), code-only rollback safe for the database (verify note below).
- **What:** Finance page gets a **Till** panel (open with a float; close with a count; the expected amount is hidden until the till is closed, so the count is honest; variance shown as "₹20 short/over" against who closed it), **rider door cash** (a rider's door cash is held by the rider, in no till, until a handover puts it into the open till; the rider's shortfall is recorded against the rider) and a **Reconciliation** tab (per day: cash in a till, cash in no till, cash a rider still carries, cash and online refunds, online captured, net, tills' counted/expected/variance; Razorpay settlements say "not connected until Razorpay is live"). `settle` attaches a counter cash payment to the open till in the same transaction (the till row is read FOR SHARE; closing takes it FOR UPDATE, so no payment slips past a count and none lands on a closed till). Permissions: `finance.view` sees; `finance.manage` (OWNER, ADMIN, MANAGER) opens, closes, receives rider cash. Every change writes an audit row.
- **Proofs:** integration 20 tests (attach, one open till, the ₹20-short close with audit row and closer id, cash refunds lower expected, a close waits for a payment mid-settlement, rider cash held until handover, handover scoped to the org, reconciliation, DB CHECKs); unit 15 + 6 + 6; 12 deliberate breakages of the fixes all failed the tests (two needed a stronger test first: the FOR SHARE read and the handover org scoping).
- **Merge note:** rc-21 (pay-ready) adds `src/lib/auth/permission-gates.test.ts`; when both branches are released the three cash actions (`openCashSessionAction`, `closeCashSessionAction`, `recordCashHandoverAction`, all `finance.manage`) must be added to its GATED table (the test fails until they are, by design).
- **Known limits:** a cash payment taken with no till open is "in no till" (shown in reconciliation, not blocked); cash refunds are attributed to the till by the time they were finalised, not by a column; a shop with several tills at once is not modelled (one open till per location); rider door cash is identified by the rider-only role at capture (a manager who completes a delivery takes the cash into the till).
- **Order now:** reviews (payments, security, QA), then the go/no-go for card 3.
- **Low card `flaky-s4`:** `refund-idempotency.integration.test.ts` "S4: a stale claim from a caller that died takes over..." waits 10 s inside a 30 s timeout (`IN_FLIGHT_WAIT_MS`); on a loaded machine (load average ~5, several agents running) it times out. Observed on both the live code and the new code against the same DB at the same time, and it passed in earlier quiet runs; `points-spend.integration.test.ts` failed once in the same busy run and passed alone. Not related to migration 0041. Fix idea: a longer test timeout or an injectable wait.


### 23.1 Till review results (2026-09-20, commit after `0b593e0`)
- Security (10 tool uses) and payments (9 tool uses): no blocker, no veto. Earlier three reviews were void (0 tool uses, Mac asleep); any subagent result with 0 tool uses is failed, not done.
- **Fixed, fail-first:** a cash refund now takes the open till FOR SHARE and is stamped with the database clock at finalize (`clock_timestamp()`), and the close reads the database clock after its lock, so a refund can no longer fall out of every till's window (test failed on the old code: the refund did not wait for the close). A rider cannot receive their own handover.
- **Accepted, to state in the go/no-go:** blind close hides the till's own expected figure but not today's cash in the ledger/reconciliation (the ledger already showed it before); the rider handover panel shows the amount owed; a cash refund is deducted from whichever till is open when it is paid (drawer pays the refund); rider-held cash refunded before handover can overstate expected; open/close/handover rely on the unique open-till index and locks, not `withIdempotency` (a double-tap returns "already closed"). Low card `cash-refund-attribution` logged.
- **QA on `bd4dbb9` (11 tool uses, real run):** 7/7 green. Unit 2519, integration 553 x3 clean, build, contrast; one new migration 0041 + rollback. The earlier QA on `0b593e0` showed integration flakes while my own test runs shared the local DB; not reproduced on the final commit.
- **Till is review-complete and waiting.** Queue order per owner: IQ-2 go/no-go answer first, then send Razorpay readiness, then the till. Card 4 not started until the till is genuinely done. Merge note: add the three cash actions to the `permission-gates.test.ts` GATED table when combined with rc-21.


## 25. Release 8 live (2026-09-21 01:45 IST): Razorpay readiness (`317ec9f`, BUILD_ID `28643f6a942b3b75`), no migration, no keys
- **Owner decision, recorded (2026-09-20): the payment intent is created BEFORE the order row.** An orphan intent is inert (unpaid, expires, the customer never receives its id); order-first would leave orders with no intent whenever the gateway call fails, needing a cleanup job for abandoned PENDING_PAYMENT rows and skewing open-order metrics. **The Paytm provider card follows the same pattern**: intent first, then the order row; the write-time gate and lock stay as they are.
- **Keys and the real-money test are the owner's step, later.** Never place, pay or refund in production. Paytm Business API is a separate gated card after the till.
- **Low cards (not shipped):** `pay-anchor-required`, `paid-predicate-1`, `pay-authorized-1`, `notify-copy-1`, `cookie-sign-1` (plus, from the post-review re-reviews:) `pay-dismiss-1` (pay-online.tsx ondismiss guard should also preserve "checking"), `pay-copy-poll-1` (checking copy says the page will update but nothing polls; it updates on "Check again" or reload), `pay-oracle-1` (with no Razorpay keys, the confirm action returns "checking with the bank" for a real order UUID and "could not be confirmed" for an unknown one: an existence oracle needing an unguessable UUID; fix by returning the generic answer when `!isRazorpayConfigured()`, in the next payments release; moot once keys are set).
- **`cookie-sign-1` needs from the owner (on the server):** one new random secret (32+ characters) in `/etc/frybird/env`, named for example `COOKIE_SECRET`, generated ON the server (`openssl rand -hex 32`) and appended without ever being printed, then `systemctl restart frybird`. My part: sign the `frybird_contact` cookie with it and treat an unsigned or wrongly signed cookie as absent (returning customers re-enter their contact once). It is a secrets change plus an auth-adjacent code change: gated, one go/no-go.
- **Rule reminder (§24):** quiet-shop check before any deploy; 30 clean journal minutes between gated releases.

## 26. Card 3 (the till) ready for the owner's go/no-go (2026-09-21): merged commit `6b09194`, waiting for a yes
- Branch `release/rc-22-cash-sessions` = live `kit-radix-nova` (`f36d57f`: IQ-2 + Razorpay readiness) + the till + migration 0041 (only migration). Conflict in `payments.ts` (both settle options kept) re-reviewed by payments on the merged commit: no veto, no high/medium. Earlier till reviews: payments no veto, security no blocker; fixes fail-first (refund ordered against close; rider cannot receive own cash).
- QA on `6b09194` (7 tool uses): unit 2863, integration 600 x3, permission-gate test 128, build, contrast; one migration + snapshot + journal + rollback. Undo drill on the merged commit (throwaway DB): apply, undo refused with a session present, undo with none, re-apply: DRILL OK; migration and undo files byte-identical to the reviewed ones.
- Cash actions pinned to `finance.manage` in `permission-gates.test.ts`; removing the gate turns three tests red (proven).
- **No-till behaviour:** an unopened till never blocks a sale, order or refund: `openSessionIdForPayment` returns null and the cash payment is stored unattached (`cashUnassigned` in the reconciliation); online payments never read it; `orders.ts` does not import it.
- Accepted lows: refund time-window attribution (a refund of rider-held cash before handover can overstate expected), blind close is UI-level, handover panel shows the amount owed, no `withIdempotency` on open/close/handover (unique open index + locks). Card `cash-refund-attribution`.
- After a yes: quiet-shop check, fresh dump, `git checkout 6b09194` (detached) and deploy, migration 0041 from the Mac first (fail-fast), smoke, journal, RELEASES row 13, then Paytm card (after 30 clean journal minutes).

## 27. Release 9 live (2026-09-21 02:17 IST): the till (`6b09194`, BUILD_ID `c98ace25fed78695`, migration 0041)
- **GO-LIVE CHECKLIST for the shop using the till for real (owner rule): `cash-refund-attribution` MUST be fixed first** (a cash refund of rider-held cash before handover, or of an earlier session's cash, is matched to a till only by time window and can show a phantom variance). Until it is fixed nobody opens a till in production. Other accepted lows: blind close is UI-level; the handover panel shows the amount owed; no `withIdempotency` on open/close/handover.
- Rollback: code-only, redeploy `f36d57f`.
- **48-hour sprint rules (owner, 2026-09-21):** deploy WITHOUT asking when every QA gate is green on the exact commit, reviewers ran with real tool use and have no open blocker, any migration is additive with its undo run on a real-schema throwaway database, a code-only rollback is safe, the quiet-shop check passes, a fresh dump is first, every server script is fail-fast. Permission/auth cards (p0-7, rider assignment) additionally need security AND red-team agreement, a read-only check after deploy that the owner's OWNER membership is unchanged and sign-in works, and an immediate code-only rollback if the smoke check fails. STILL GATED (go/no-go and wait): payments, refunds, the till, Paytm code; anything needing a secret or an account; any production data write beyond a migration; any deletion. Push to the phone only for go/no-go, failed deploy/rollback, blocked lane; one summary per 12 hours, max 12 lines. Not in this sprint: driver app, offline POS, forecasting, Ask FRYBIRD, real Paytm/WhatsApp accounts, item descriptions, order #1226.
- **Builders (local project agents, git-excluded):** `frybird-builder-kitchen` (4.1 prep targets, 4.2 stations FRY/ASSEMBLY/DRINKS/PACK + EXPO, 4.4), `frybird-builder-staff` (7.1, 6.4, 7.3, polish), `frybird-builder-integrations` (7.2 WhatsApp behind a mock, then Paytm behind PaymentProvider with mocks only), `frybird-scribe` (docs only, haiku). Each builder: own worktree, own local database (`scripts/builder-db.sh`), never edits orders.ts/payments.ts/permissions/auth/checkout-action, migrations written as `PENDING_*.sql` and numbered by the integrator at merge, at most 3 heavy Mac jobs. Integrator (this session) builds Lane A (p0-7, rider assignment 6.3, cookie-sign-1 prep), merges, runs final QA, does every deploy; batch release about every 6 hours.

## 28. Release 10 live (2026-09-21 02:50 IST): p0-7 (`818f514`, BUILD_ID `834bda467a53e793`, migration 0042)
- **p0-7 is fixed.** (1) `inviteStaff` takes the actor's roles and applies `canGrantRole` before contacting Supabase Auth. (2) Migration 0042: 40 additive restrictive read policies + `pos_pin_hash` column grant closed. The app itself is unaffected (Drizzle bypasses RLS).
- **Finding, told to the owner:** production has active memberships beyond the two OWNERs: one each ADMIN, MANAGER, CASHIER, KITCHEN (all created 2026-09-15 23:15 with one sign-in that minute, look like role-test accounts) and a RIDER (created 09-11, last signed in 09-20 20:51 IST). The recorded answer "only OWNER accounts exist" was wrong: p0-7 was NOT latent. Not touched (deactivating anything is a production data write). Owner to say which are real; deactivating the unneeded ones is a UI action for the owner.
- **Low cards from the reviews:** `pin-anon-grant` (`anon` keeps a table-level SELECT on memberships incl. `pos_pin_hash`; harmless while no anon policy exists; revoke it in the next migration), `pin-hash-column` (before any PIN feature), `invite-race-1`, `staff-lock-1`, `orders-column-limits` (owner decision), `till-close-micros` (see below).
- **`till-close-micros` (add to the till go-live checklist with `cash-refund-attribution`):** QA run 1 on `818f514` failed once in `cash-sessions.integration.test.ts` reconciliation ("expected 140000n, got 137000n", i.e. a ₹30 cash refund missing from the close): it passed 22/22 alone twice and in two full runs. QA's guess was a UTC/IST date boundary; my hypothesis (UNPROVEN) is that `closeCashSession` reads the database clock into a JS `Date` (milliseconds) and compares refund `finalized_at` (microseconds) against it, so a refund finalized in the same millisecond as the close can be truncated out. Both would be fixed by comparing in SQL against the same `clock_timestamp()` value. Till code = gated: fix fail-first in the till go-live release, before any real till use.
- **Batch release in preparation** (`release/rc-24-batch` in `~/Downloads/wt-batch`, own database `frybird_b_batch`): base `818f514` + kitchen 4.1/4.2/4.4 + staff 7.1/6.4/7.3 + integrations 7.2. Migrations numbered 0043 customer_notes, 0044 shifts, 0045 kitchen_stations, 0046 notification_outbox, 0047 rls_read_new_tables (role-aware reads for the two new tables that hold phone numbers / kitchen state). Whole-batch undo drill on a real schema (full fingerprint) passes; unit 2958/2958; gate rows added incl. a STAFF_ONLY table for clock in/out. Still to do: the enqueue hook in `orders.ts` (integrator-only, after `advanceOrder` commits, failures swallowed) and its test, integration/RLS suites on the merged commit, security + red-team on the batch's new actions/tables, QA, then deploy.
- **Paytm provider (`e27179e` on `agent/builder-integrations-1`, mocks only, NOT in the batch):** payments code, gated: needs the payments reviewer (veto) and a go/no-go. Owner's to-do list is in `docs/PAYTM-PROVIDER.md` on that branch; biggest risk is the checksum scheme (docs give no test vector), must be compared against Paytm sandbox before go-live; it fails closed.

## 30. Batch release review results (2026-09-21) and owner-visible decisions
- Reviews of the batch (`c3a6467`): payments no veto (all four Paytm conditions verified in the merged code; hook and auto-start cannot bypass payment rules); security no blocker/high, two mediums fixed fail-first (customer phone could reach logs through a database error message when the WhatsApp hook is on: now only the error name/code is logged; **RLS/PRIVILEGE CHANGE: `shifts` and `shift_breaks` were readable by every org member through PostgREST: now own rows only unless `staff.manage`, in migration 0051**); red-team did not agree as-is: HIGH customer-edit idempotency key came from `useId` (same for every fresh page load: after the first edit anywhere later edits failed or "saved" without writing) fixed with a per-attempt key (`edit-key.ts`); MEDIUM READY reachable without stations/PACK through the old board and orders board (`advanceOrder` has no station check): **decision for the owner, shipped as advisory** (the old board is the manager override; enforcing it in `advanceOrder` would force the whole kitchen onto the station screens on day one; logged card `ready-gate-enforce` to enforce once the kitchen uses stations); LOW station screens `.limit(100)` without order now oldest-first; LOW-MEDIUM WhatsApp abuse vector (customer-supplied name and phone in the message) is a GO-LIVE BLOCKER for any real WhatsApp provider: sanitise/cap the name, verify the number, cap the body.
- Other lows kept as cards: `clockout-same-ms` (clock-out within the same millisecond as clock-in hits `shifts_order_check`), station done-marks have no audit rows, migrations 0047-0049 lack `SET LOCAL lock_timeout` (new tables, cosmetic), outbox payment position should reuse `orderAwaitsOnline`/`UNAPPLIED` (`outbox-paid-position`), editing a customer's phone re-links loyalty to the new number (manager awareness).
- **Ship order (migration order matters: Drizzle skips any migration older than the newest applied):** batch 0044-0051 first, then the rider release (0052), then the till fix (0053).

## 29. Release 11 live (2026-09-21 04:07 IST): rider assignment (`c220e38`, BUILD_ID `7bbae2c157e5cb22`, migration 0043); owner answers of 2026-09-21
- **Behaviour change to tell the rider/owner:** a RIDER login sees and closes only deliveries assigned to them; managers assign from the orders board or Deliveries. The one live RIDER account completed a delivery on 20 Sep 20:56 IST (unassigned, before this release): it will see nothing until someone assigns.
- **Owner answers (recorded):** owner deactivates the four test accounts (ADMIN/MANAGER/CASHIER/KITCHEN, created 15 Sep 23:15, zero actions ever) himself; do not touch. The 26 orders closed on 20 Sep 02:17-02:20 IST were closed by an OWNER account (ACCEPTED->PREPARING->READY->COMPLETED, 5 s apart). PIN-hash column revoke accepted; keep flagging any privilege/RLS change in reports. Kitchen: station = per-product override > category default (fried chicken/tenders/popcorn/wings/fries/loaded fries -> FRY; burgers/smash burgers/wraps/rice bowls/mac and cheese -> ASSEMBLY; all drinks -> DRINKS; anything unmatched -> ASSEMBLY); PACK is the final step for every takeaway/delivery order; marking a line done moves ACCEPTED->PREPARING automatically. Shifts: hours only (clock in/out and breaks as time entries), no pay logic, not tied to the till (the summary may SHOW the person's till sessions). Till go-live: `cash-refund-attribution` and `till-close-micros` fixed before any real till use, in Lane A after rider assignment. Paytm: mock-only, marked not verified against Paytm's sandbox; go/no-go sent after the payments reviewer's re-review (no veto); waiting for the owner's yes.
- **Resulting product-to-station list (proven by a 49-product test):** FRY = Chicken Tenders, Chicken Wings, Popcorn Chicken, Chilli Cheese Fries, Frybird Loaded Fries, Garlic Parmesan Fries, Nachos Loaded Fries, OG Salt Fries, Peri Peri Fries (9). ASSEMBLY = every burger (8), smash burger (4), wrap (6), rice bowl (3), mac and cheese (6), plus Sauces (7) and Combos & Party Boxes (6) by default (40). DRINKS = none (no drinks on the menu yet). Combos mix fried and assembled items: the owner may want a per-product override.
- **Low cards from the rider reviews (not shipped):** `rider-rls-scope` (PRIVILEGE/RLS FLAG: migration 0042 lets a RIDER read every order through PostgREST/Realtime incl. `rider_id`; a `rider_id = auth.uid()` restrictive policy for rider-only logins would close it at the database layer; owner to approve), `reassign-race-1`, `rider-stale-assign`, `listdeliveries-sql-filter` (push the rider filter into the SQL WHERE), `kitchen-analyst-fields` (KITCHEN/ANALYST get customer fields in the RSC payload of the orders board), plus by design a CASHIER may fail any unpaid delivery with a reason.
- **Batch release (`release/rc-24-batch` in `~/Downloads/wt-batch`, head `0d741ea`, based on Release 11's code):** kitchen 4.1/4.2/4.4 + PACK, staff 7.1/6.4 (hours only, breaks)/7.3, WhatsApp 7.2 (mock). Migrations numbered 0044 customer_notes, 0045 shifts, 0046 shift_breaks, 0047 kitchen_stations, 0048 kitchen_pack, 0049 notification_outbox, 0050 rls_read_new_tables (role-aware reads for the two tables holding phone numbers / kitchen state); whole-batch undo drill on a real schema passes (fingerprint identical after undo and after re-apply). Still to do: the `advanceOrder` -> `enqueueOrderUpdate` hook in `orders.ts` (integrator only, failures swallowed) with its test, batch unit/integration/QA, reviewers on the new actions/tables, deploy; Paytm mock-only merge only after the owner's yes.
- **Next in Lane A:** till fixes (`cash-refund-attribution`, `till-close-micros`), then cookie-sign-1 prep.

## 31. State after Release 12 (2026-09-21 ~07:45 IST): what is live, what is next
- **Live (kit-radix-nova `8d008de`, BUILD_ID `5aae9e01b7ce0a55`, migrations 0000-0051):** IQ-2 + readiness, Razorpay readiness (no keys), the till (unopened; go-live blocked on `cash-refund-attribution` + `till-close-micros`, both fixed in the till release below), p0-7, rider assignment, the builders' batch (kitchen prep targets/stations/PACK/expo/analytics, customer edit + notes, shifts (hours/breaks only), promotions AOV, WhatsApp mock outbox (hook OFF), Paytm mock-only (inert, NOT VERIFIED AGAINST PAYTM SANDBOX)).
- **Ready, waiting for QA then the owner's go/no-go, in this order (migration order matters):**
  1. **Rider release** `release/rc-27-rider-offer` (`779b524`, migration 0052 + code): `rider-rls-scope` (owner asked for a go/no-go; RLS/PRIVILEGE change: a rider-only login reads only its own assigned deliveries at the database level) and `rider-offer` (unassigned READY/OUT_FOR_DELIVERY deliveries show to every active rider as "Available" with pickup-level details only; "Take it" is atomic, first tap wins; new permission `delivery.take` for RIDER; the rider screen polls every 10 s because riders no longer receive realtime events for unassigned orders). Security: approve; red-team: agree (medium: a hostile rider could take everything to harvest addresses: card `rider-take-cap`, owner decision on a limit or a release button; low: a taken delivery that is never delivered is invisible to other riders: card `rider-stale-hold`).
  2. **Till release** `release/rc-28-till-fix` (`fb80021`, migration 0053, contains the rider release): cash refunds record the till that paid them (`refunds.cash_session_id`), a till's expected cash counts exactly its attributed refunds (no timestamp comparison), reconciliation shows cash refunded with no till open. Payments reviewer: no veto. Gated: needs the owner's go/no-go.
- **Owner-visible open decisions:** `ready-gate-enforce` (stations are advisory; the old board can mark READY without them); combo components are not entered in the menu data (every combo shows on FRY and ASSEMBLY); WhatsApp real provider needs sanitising the customer name and verifying the number first; `rider-take-cap`; rider RLS also affects Realtime for riders.
- **Next in Lane A after those:** cookie-sign-1 prep (needs a server secret: owner said I may generate it on the server with openssl and append it without printing it, but ask first at that time), `ready-gate-enforce`, low cards.
- **Builders:** kitchen, staff and integrations builders are idle with all cards done (`agent/builder-*-1`, worktrees `~/Downloads/wt-kitchen|wt-staff|wt-integrations`); Paytm sandbox proof needs the owner's sandbox credentials.
- **Worktrees:** `wt-batch` (release/rc-24-batch, live), `wt-rider` (rc-27), `wt-till` (rc-28), each with its own local database (`frybird_b_*`); the shared local DB (`postgres`) has migrations through 0052 applied (0053 only in `frybird_b_till`).


## 32. Release 13 live (2026-09-21 18:12 IST): rider database scope + rider offers (`6235cc6`, BUILD_ID `6a0e5b7ae348f78a`, migration 0052)
- **Quiet-shop rule, REFINED by the owner (2026-09-21; replaces the 3-hour rule of section 24):** before any deploy, block ONLY when a customer may be mid-checkout: (a) an order was placed in the last 10 minutes, or (b) an order has been in PENDING_PAYMENT for less than 15 minutes. Orders already accepted or being prepared do NOT block a deploy (a restart does not affect them; staff screens prompt a reload). Read-only check: `orders.created_at > now() - interval '10 minutes'` and `status = 'PENDING_PAYMENT' and created_at > now() - interval '15 minutes'` (the recreated helper is not in the repo: two counts, both must be 0). Everything else is unchanged (fresh dump, fail-fast, smoke, zero journal errors, RELEASES row, push).
- **Owner sprint rule (2026-09-21, recorded):** permission and staff-side releases may deploy WITHOUT asking when: all gates green on the exact commit; security and red-team agree with real tool use; the migration is additive and its undo was drilled on the real schema; a code-only rollback is safe; the (refined) quiet-shop check passed and a fresh dump was taken; after the deploy the owner membership and sign-in are verified; on a failed smoke check an immediate code-only rollback. STILL ASK FIRST for: payments, refunds, till, Paytm and cash code; secrets; production data writes; deletions. Owner checks the phone for go/no-gos around 09:00, 14:00 and 20:00 Berlin time.
- **Behaviour to expect:** a RIDER login sees nothing until a delivery is Available (ready and unassigned) or assigned to it. Direct database reads by a rider return only its own assigned deliveries.
- **Order #1268:** a takeaway accepted at 15:31 IST 2026-09-21 and untouched since (a forgotten order at the counter, not a delivery, no rider): the owner may want it completed or cancelled from the orders screen.
- **Next (cumulative deploys: each deploy ships a whole tree):** rider follow-ups + cookie signing on `release/rc-30-rider-followups` (`b9e860a`, code only, QA 7/7, security and red-team agree): rider-take-cap (max 2 active deliveries, atomic, audited Release while READY only, max 6 takes per rolling hour so take/release cannot read every customer's details), rider-stale-hold (flag only, 15 min), cookie-sign-1 (behaviour unchanged until the secret is set). Then the till fix (owner go/no-go pending; `release/rc-28-till-fix`, `c0ffdaa`, migration 0053) composed on top.
- **Low cards from the follow-up reviews:** `refund-audit-till` (put the till id in the `payment_refunded` audit row), `rider-stale-reset` (release/take resets the stale timer), `manager-assign-uncapped` (assignRider is not capped, by design), `complete-release-race`, `secure-cookie-note` (the contact cookie now carries Secure in production even with the secret unset: site is HTTPS-only).

## 33. Position after Release 14 (2026-09-21 ~19:00 IST): what is live and the single thing waiting on the owner
- **Live (kit-radix-nova `93ad893`, BUILD_ID `e437298b6318add8`, migrations 0000-0052, Releases 1-14 in RELEASES.md).** COOKIE_SECRET is NOT set on the server (the cookie step is an owner-approved step, DEPLOY 12: the owner said I may generate it on the server with openssl and append it without printing it, but ask first).
- **WAITING ON THE OWNER (go/no-go sent, unanswered): the till fixes.** Branch `release/rc-28-till-fix`, composed on the live code as `bec752f` (migration 0053 `refund_cash_session`, undo drilled, payments reviewer no veto, security no blocker; QA on `bec752f` was started at ~19:00 IST: re-check its result before deploying). On a yes: refined quiet-shop rule (no order placed in the last 10 minutes, none in PENDING_PAYMENT under 15 minutes), fresh dump, migration 0053 from the Mac (fail-fast), deploy detached `bec752f`, smoke, zero journal errors, owner fingerprint `aa1a9d898d44` unchanged and sign-in, RELEASES row 19, push, merge into kit-radix-nova. Go-live blockers for using a till (both fixed by this release): `cash-refund-attribution`, `till-close-micros`. A till still must not be opened in production until it ships.
- **Owner-visible decisions/cards:** `ready-gate-enforce` (stations advisory), combo components not entered (combos show on FRY and ASSEMBLY), WhatsApp real provider needs name sanitising and number verification first, Paytm needs sandbox credentials (mock-only, NOT VERIFIED AGAINST PAYTM SANDBOX), order #1268 idle at the counter (takeaway, accepted 15:31 IST), low cards listed in sections 30-32.
- **Environment after the Mac restart:** Docker Desktop must be running for local tests (`open -a Docker`); the shared local DB (`postgres`) has migrations 0000-0053 applied; per-worktree DBs `frybird_b_*`; scratch helper scripts live in the session scratchpad and are recreated when missing (gate2 = the refined rule: two counts).
- **Worktrees:** main (deploys, detached or kit-radix-nova), `wt-batch` (rc-24, live), `wt-rider` (rc-27, live), `wt-rider2` (rc-30, live), `wt-till` (rc-28, waiting), `wt-cookie` (rc-29, live), builders `wt-kitchen|wt-staff|wt-integrations` (idle, all cards done).
- **Suggested next work once the till ships:** cookie-sign-1 secret step (ask), `ready-gate-enforce`, low cards, the Paytm sandbox proof (needs the owner's credentials), iq-flaky-1/flaky-s4.

## 34. Release 15 live (till fixes) and what is left before a till is opened

- **Live:** `efc5ee5`, BUILD_ID `bab6ef62ec92de90`, migrations 0000-0053 (54 applied). RELEASES row 19. `COOKIE_SECRET` still unset: owner approved setting it (backup `/etc/frybird/env`, `openssl` on the server, never printed, restart, verify sign-in/tracking/checkout, restore on failure) once Release 15 has run clean 30 minutes in a quiet window. Returning customers will re-enter their contact once: record this in RELEASES when done.
- **Deploy permission:** the auto-mode classifier denied `./deploy/deploy.sh` for me ("Production Deploy"). The owner ran it. Suggested allow rule: `Bash(./deploy/deploy.sh root@194.238.16.200)`.
- **Till go-live checklist, removed:** `cash-refund-attribution`, `till-close-micros`. **Still on it before a till is opened for real:** (1) the owner opens a till deliberately and does the first close with him watching; (2) `refund-audit-till` (a cash refund writes no till-specific audit row); (3) blind close is not enforced at the UI level; (4) the handover panel does not show the amount owed; (5) open/close/handover are not wrapped in `withIdempotency`; (6) a runbook note for refunding rider-held cash; (7) low: the "paid with no till open" reconciliation label also counts refunds on orders with no location and refunds made before 0053.
- **Low cards added:** `rider-limits-admin` (make 2 active deliveries and 6 takes per hour editable in Admin; accepted values are the constants in `src/lib/delivery/hold.ts`, owner accepted them 21 Sep).
- **Lane A, after the current cards (owner, 21 Sep):** `refund-audit-till` (an audit row for every cash refund naming the till it came out of), `till-idempotency` (`withIdempotency` on till open, close and handover), and the runbook note for refunding rider-held cash (DEPLOY/RUNBOOK). All till code: gated (payments reviewer, owner go/no-go). The first real till open stays the owner's.
- **Owner confirmed (21 Sep):** OWNER sign-in works on Release 15; allow rule `Bash(./deploy/deploy.sh:*)` added. Gated categories still need a yes.
- **Cookie secret DONE (21 Sep 21:41 UTC):** `COOKIE_SECRET` set on the server (RELEASES row 19a). Returning customers re-enter their contact once. Env backup kept at `/etc/frybird/env.bak-cookie-202609212141`; remove it when the owner is happy (it holds the same secrets as the env, so it is not to be copied off the server).
- **NEW OWNER-MEMBERSHIP BASELINE (22 Sep, by the owner's own action):** the owner deactivated the five QA accounts (OWNER, MANAGER, ADMIN, CASHIER, KITCHEN) from the Staff screen. Verified read-only on the server: exactly 1 OWNER active and 1 RIDER active (the owner's own test login); the five QA memberships are `is_active=false` (one each of OWNER, MANAGER, ADMIN, CASHIER, KITCHEN); 5 `staff_deactivated` audit rows exist (22:07:42 to 22:08:01 UTC on 21 Sep, roles KITCHEN, CASHIER, ADMIN, MANAGER, OWNER). **Post-deploy check baseline is now fingerprint `2e1c2fd91279`; the old `aa1a9d898d44` is retired** (script `own.sh`: md5 over user_id, role, is_active, org_id of all memberships). A deploy is expected to leave it identical; any change means stop and tell the owner.

## 35. Release 20 live (rider limits) and the till go-live release waiting on the owner (22 Sep 2026)

- **Live:** `f0639e0` (BUILD_ID `1efb072e49959f4b`, migration 0054, 55 migrations). Owner can set rider limits in Admin > Restaurant > Riders. Post-deploy baseline fingerprint is `2e1c2fd91279`. Card `rider-limits-admin` DONE. Owner to confirm sign-in once.
- **WAITING ON THE OWNER (go/no-go): the till go-live release.** Branch `release/rc-31-till-golive` `7111a7f` (no migration). Contents: `withIdempotency` on till open/close/handover; `refund-audit-till` (the `payment_refunded` audit row of a cash refund carries `cashSessionId`, null when no till was open); blind count enforced on the cash figures (reconciliation withholds till cash, cash refunds and net for days since the open till started; Finance withholds the Cash KPI, the cash card/chart and the By-method cash row); handover form shows the amount owed; runbook DEPLOY.md 13. Reviews: payments no veto, security approve, QA gates 1-4 green (unit 3119, integration 777/777 x3; build not run in the worktree because of a symlinked node_modules, deploy.sh builds from a clean checkout). Accepted limit: Captured, Through a provider, the Payments and Refunds lists and the payment list still show cash, so the blind count is a control against a casual glance, not against someone who adds them up. Before the deploy: merge `kit-radix-nova` into the branch (it needs migration 0054's schema), re-run the gates.
- **The first real till open and close stay the owner's.**
- **Env backup** `/etc/frybird/env.bak-cookie-202609212141`: keep 7 days, then delete and tell the owner (due 2026-09-28 21:41 UTC).
- **Still open on the till checklist:** only the owner's first open/close with him watching, and the low "paid with no till open" label looseness.

## 36. Release 21 live (till go-live) (22 Sep 2026)

- **Live:** `2eb78f0` (BUILD_ID `a8971b211203c5ad`, no migration, 55 applied). The till is ready to be used: the owner opens and closes the first real till himself, with the runbook in DEPLOY.md 13. Fingerprint baseline still `2e1c2fd91279`.
- **Owner decision:** blind close stays as is (only OWNER has finance access today; finance lists keep showing cash). **Low card `blind-close-finance-lists`:** when a non-owner finance role exists, hide cash on the finance lists (Payments, Refunds, Captured, Through a provider) while a till is open, or give that role a view without cash.
- **Till checklist now:** only the owner's first open/close, and the low "paid with no till open" label looseness.
- **Overnight orders from the owner (no gates, sprint rules):** (1) one release batching every low card that touches no money, order-placement, auth or migration code; report included vs held back and why; (2) `docs/SHOP-RUNBOOK.md`, plain language, one shift; (3) 12-hour summary and a `/compact` reminder.

## 37. Release 22 live (lows batch) (22 Sep 2026)

- **Live:** `a9025c9` (BUILD_ID `bbb5ae2c42d8a94d`, no migration). **Included:** `readiness-safe-1`, `clockout-same-ms`, `iq-flaky-1`, `flaky-s4`, `secure-cookie-note`.
- **Held back, and why:** `pin-anon-grant`, `pin-hash-column`, `orders-column-limits` (migration / RLS or privilege); `invite-race-1`, `staff-lock-1` (staff auth); `ready-gate-enforce`, `complete-release-race`, `reassign-race-1`, station done-mark audit rows (order lifecycle, the hot path of the kitchen screen); `rider-stale-reset`, `rider-stale-assign`, `manager-assign-uncapped`, `listdeliveries-sql-filter`, `kitchen-analyst-fields` (rider and permission visibility: each needs an owner decision on the intended behaviour, or touches who sees customer data); `outbox-paid-position` (reads payment state); `cash-no-payment-row`, `stock-count-trace` (need a definition first, cash and stock scoring); `blind-close-finance-lists` (waits for a non-owner finance role).
- **Runbook written (22 Sep):** `docs/SHOP-RUNBOOK.md` (one shift, plain language, exact screens and buttons, internet-drop fallback). Written from the code's labels, not from a signed-in walk-through: the owner should read it against the live screens once and send corrections. Note in it: the internet-drop steps are a paper fallback (there is no offline POS in this build).
- **Open with the owner:** confirm sign-in and open Admin > Restaurant > Riders once; read the runbook; the first real till open/close is his; env backup deletion due 2026-09-28 21:41 UTC.

## 39. Release 23 live: security lows + rider live position (22 Sep 2026)

- **Live:** `bd82f13` (BUILD_ID `1b5396427947afbb`). Migrations `0055_client_grant_hardening`, `0056_rider_positions` (57 of 57). Fingerprint `2e1c2fd91279` unchanged. `rider-positions-purge` timer installed and enabled (hourly, :17 UTC), verified with one manual run (SUCCEEDED). Full detail: RELEASES row 23.

## 40. Release 24 live: Rider PWA + Order Health strip (22 Sep 2026)

- **Live:** `715308e` (BUILD_ID `1d1147b27c8b6e19`, merged into `kit-radix-nova`). No migration (57 of 57 unchanged). Fingerprint `2e1c2fd91279` unchanged. UI-only, two independent staff-side features, no gate needed per sprint rules; shipped autonomously after one review.
- **Rider PWA (roadmap 4.3, part 1):** installable web-app manifest at `/manifest.webmanifest` (start_url=/app, scope=/app so installed icon opens staff area never customer site), static PWA icons (192/512 raster with "any" and "maskable" purposes, derived from brand mark; 180x180 iOS apple-icon), install-app-prompt component captures `beforeinstallprompt` and offers Install button on Chrome/Android; explains manual "Share → Add to Home Screen" on iOS (which has no programmatic install); shown only on the rider's own Deliveries screen. Dismiss state persists in localStorage; cosmetic UX note (cancelling native dialog does not set same flag as "Not now" button, so banner can reappear next load) not a blocker. Screen wake lock while OUT_FOR_DELIVERY already existed from Release 23.
- **Order Health strip (roadmap 4.3, part 2):** `healthCounts()` in `src/lib/kitchen/tickets.ts` (reuses existing roadmap-4.1 `prepHealth()` logic; GREEN/AMBER/RED at 80%/100% thresholds). Component renders counts on `/app/iq/live` (was calling `toKitchenTickets` with no prep targets, now passes real targets from `getPrepTargets`, fixing the gap where every ticket was GREEN or RED never AMBER) and on `/app/iq` Command Center card (reuses `activeOrders` query already there, one new `getPrepTargets` call, no extra query). Org-scoping verified at both call sites.
- **Review:** frybird-security (22 tool calls) APPROVE. Confirmed: no server write except localStorage; `riderOnly` gating reuses page's existing check; manifest scope changes no auth boundary; install-prompt state reflects only real browser events.
- **Gates:** typecheck clean, lint 0 errors, unit 3177, integration 833, all green. No follow-up card.
- **Rollback:** code-only, redeploy `bd82f13`; safe at any time (no migration, no auth/permission change, no data write).
- **Next:** rc-36-cookie-secret-dependency remains separately pending the owner's go/no-go (unrelated, still waiting).
- **Owner follow-up card, next release:** `cookie-secret-dependency` — remove the legacy unsigned remembered-contact cookie fallback entirely. If `COOKIE_SECRET` is unset (or the value fails to validate), fail closed (treat the cookie as absent) and log an alert, never authorise by phone number alone. Not urgent today (`COOKIE_SECRET` has been set since Release 19a), but the owner asked for it to be removed rather than left dormant.
