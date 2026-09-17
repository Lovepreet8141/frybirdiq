# Migration recovery

Owner: DATABASE. Written 2026-09-17 for card rec-1 (hive `ORG.md` §9).
Sources: `supabase/migrations/0027`–`0032`, `supabase/rollback/0022`–`0026`,
branch `agent/temp-sec-1` at `b297d03` for `0033`, `deploy/backup.sh`,
`drizzle-orm` 0.45.2 `pg-core/dialect.js`, `hive/reviews/sec-1/VERIFICATION.md`.
No production access and no local stack run was used for this document.

Claims are labelled **FACT** (read in the source named), **EXPLANATION**
(why it follows) or **RECOMMENDATION**. Nothing here was executed.

---

## 1. Classes

| Class | Meaning |
|---|---|
| **Reversible** | A down path exists that loses no data and does not reopen a security hole. |
| **Forward-fix** | Correct it with a new migration. A down path would lose data written since, or reopen a hole. |
| **Backup/restore** | The migration changed existing data irreversibly; only a backup brings it back. |

**FACT:** none of 0027–0033 updates or deletes an existing row. Each only adds
objects (columns, a table, a sequence, a trigger), changes RLS policies, or
changes privileges. So none is backup/restore *by itself*. Data only becomes
backup-only if someone later drops what these migrations added (called out per
migration below).

---

## 2. Facts every recovery depends on

1. **How Drizzle decides what to apply.** **FACT** (`dialect.js` lines 57–67):
   `pnpm db:migrate` reads only the newest row of `drizzle.__drizzle_migrations`
   (by `created_at`) and applies every journal entry whose `when` is greater.
   It runs all pending migrations in **one transaction**. It does not compare
   hashes or look at older rows.
   **EXPLANATION:** deleting the row of a migration that is *not* the newest
   does nothing — it is never re-applied — and leaves the journal lying about the
   schema. Deleting the **head** row makes the next `db:migrate` re-apply it.
   A rollback is only consistent when it goes from the head backwards, one
   migration at a time.
2. **Backups.** **FACT** (`deploy/backup.sh`): nightly `pg_dump
   --schema=public --no-owner --no-privileges`, custom format, 14 days, on the
   VPS. The dump contains `public` tables, rows, sequences (with their current
   value), functions, triggers and RLS policies. It does **not** contain:
   GRANTs/REVOKEs and default privileges (`--no-privileges`), the `drizzle`
   schema (migration journal), `auth`, `storage`, `realtime`, or the
   `supabase_realtime` publication membership.
   **EXPLANATION:** a restore brings back rows but not the privilege state of
   0033, and not the migration journal. Both must be re-checked by hand after
   any restore.
3. **App code reads the new objects.** **FACT** (grep of `src/`):
   `order_number_seq` (`repositories/orders.ts` `nextOrderNumber`),
   `cod_cap`/`cash_enabled`/`online_enabled`/`opening_time`/`closing_time`
   (`repositories/settings.ts`, checkout, admin restaurant page),
   `delivery_free_*` (`repositories/delivery.ts`), `franchise_inquiries`
   (`repositories/franchise.ts`).
   **EXPLANATION:** undoing any of these without first deploying code that no
   longer reads them breaks checkout or the admin pages at once.
4. **Supabase's own backups / point-in-time recovery:** plan-dependent.
   Not verified on this card — treat as unknown until god confirms read-only.

---

## 3. Deployed migrations 0027–0032

### 0027 `realtime_order_events` — **Reversible**
- **What it did (FACT):** adds `order_events`, `products`,
  `product_availability` to the `supabase_realtime` publication; creates
  `public.order_events_broadcast()` (SECURITY DEFINER) and an `AFTER INSERT`
  trigger on `order_events` that broadcasts status to topic `order:<id>`. Both
  are guarded so an order write never fails because of Realtime.
- **Reason:** no data is stored by it. Undo = drop trigger, drop function,
  remove the three tables from the publication (never drop the publication:
  Supabase owns it).
- **Data at risk:** none. **Effect of undoing:** staff screens and the customer
  tracking page fall back to their 60 s poll.
- **Caveat:** 0033's safety argument relies on this trigger for the customer
  broadcast. Re-check 0033 before undoing 0027.

### 0028 `restaurant_settings_cod_hours_payment_toggles` — **Forward-fix**
- **What it did (FACT):** five `NOT NULL` columns with defaults on
  `organizations`: `cod_cap` (paise, 150000), `cash_enabled`, `online_enabled`,
  `opening_time`, `closing_time`.
- **Reason:** dropping the columns loses the owner's settings. A wrong default
  or type is fixed by a new `ALTER` migration.
- **Data at risk if dropped:** the owner-entered COD (cash on delivery) cap,
  payment toggles and hours. Re-enterable by the owner, and in the nightly dump.
  **EXPLANATION:** a drop silently re-enables a payment method the owner turned
  off once old code runs — a money-behaviour change, not just lost config.

### 0029 `delivery_free_zone` — **Forward-fix**
- **What it did (FACT):** `locations.delivery_free_enabled` (default false) and
  nullable `delivery_free_max_metres`.
- **Reason / data at risk:** as 0028 — dropping loses the configured free
  delivery radius; delivery fees would change on the next order.

### 0030 `franchise_inquiries` — **Forward-fix** (never drop: backup/restore if it is)
- **What it did (FACT):** new table (name, city, phone, message) with RLS
  enabled and no policy, written only by the server action as `postgres`.
- **Reason:** schema problems are fixed forward. Dropping the table destroys
  leads submitted by the public that exist nowhere else.
- **Data at risk:** every inquiry row, including personal data (name, phone).
  The nightly dump holds them; restoring means handling that personal data
  (owner gate 3).

### 0031 `order_number_sequence` — **Forward-fix**
- **What it did (FACT):** `CREATE SEQUENCE order_number_seq START WITH 1225`.
  `nextOrderNumber()` calls `nextval` on it. `orders_org_day_number_unique` is
  unchanged (unique per org per business day).
- **Reason:** the sequence's current position is state. Dropping it breaks
  every checkout; re-creating it with `START WITH 1225` re-issues numbers that
  customers already hold on receipts, and can hit the per-day unique constraint
  when a reused number lands on a day that already issued it.
- **Data at risk:** order-number continuity, not stored rows.
- **Forward-fix rule (RECOMMENDATION):** any re-creation or repair must
  `setval('order_number_seq', <max issued order_number>)` in the same
  migration, read inside that migration, never hard-coded. The nightly dump does
  carry the sequence value.

### 0032 `backfill_rls_gap` — **Forward-fix**
- **What it did (FACT):** enables and forces RLS on nine tables that had none
  (`category_availability`, `loyalty_rewards`, `loyalty_stamp_events`, `media`,
  `recipe_version_items`, `recipe_versions`, `tables` with a tenant
  `FOR ALL` policy; `menu_audit_log`, `price_history` with read + append only).
- **Reason:** a down path loses no data, but it reopens full anon/authenticated
  read and write on those nine tables (including tampering with
  `menu_audit_log`). That is not a safe down path, so it is not "reversible".
  The app is unaffected either way (it connects as `postgres`, which bypasses
  RLS). A policy that is too strict is fixed by a new migration.
- **Data at risk:** none from the migration. From undoing it: integrity of the
  menu audit trail and price history.

---

## 4. 0033 `rls_write_lockdown` (not deployed; `agent/temp-sec-1` `b297d03`)

### Classification — **Reversible in data terms; forward-fix in practice**
- **What it does (FACT):** replaces the `FOR ALL` policies on `memberships`,
  `feature_flags`, `organizations` with SELECT-only policies on the same org
  predicate; `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA
  public FROM anon, authenticated`; and the same revoke in postgres's default
  privileges for future tables. No rows change.
- **Down file (FACT):** `supabase/rollback/0033_rls_write_lockdown.down.sql`
  restores the three `FOR ALL` policies exactly as `0001` created them and
  re-grants the four privileges on every public table, plus default privileges.
- **Reason:** the down file loses no data, but it reopens the P0 privilege
  escalation (any active staff member can make themselves OWNER through the
  public API). **RECOMMENDATION:** if 0033 breaks something, fix forward with a
  narrow `GRANT` for the one table and operation that needs it, never the down
  file. Use the down file only if the owner accepts the reopened hole in
  writing.
- **Data at risk:** none from the migration. From running the down file: every
  table becomes client-writable again, including tables created after 0033.
- **Down file gaps (RECOMMENDATION, for the implementer):** it has no
  `BEGIN`/`COMMIT` — run it with `psql -v ON_ERROR_STOP=1 --single-transaction`;
  and it must be run and verified on the local stack before the production run
  (§9), with the exploit test failing afterwards and passing again after
  re-applying 0033.
- **Backups do not help here (EXPLANATION):** dumps are `--no-privileges`, so a
  restore neither carries 0033's revokes nor removes them. A restore into a new
  project starts with Supabase default grants — the hole is open again until
  0033's privilege statements are re-run.

### Production deploy checklist for 0033
Owner gate 1 (production migration). Every box is ticked and its evidence
linked in the `docs/RELEASES.md` row before the migration runs.

**Before (no production writes)**
- [ ] SECURITY-TENANCY and DATABASE `agree` on `b297d03` (or its successor);
      `hive/reviews/sec-1/` holds both verdicts.
- [ ] Journal check: 0033's `when` (`1789700000000`) is greater than 0032's
      (`1789600000000`) and no other branch adds a different `0033`. If two
      branches both add a 0033, one must be renumbered before merge, or Drizzle
      applies only one.
- [ ] Local stack (DATABASE runs it): fresh `supabase db reset` → `pnpm
      db:migrate` → `pnpm test:integration` including
      `rls-write-lockdown.integration.test.ts` (10 cases: owner-insert,
      self-promote, deactivate owner, feature flag, organization, payment,
      order refused; own-org reads allowed; other-org reads refused; bare anon
      writes refused). All green.
- [ ] Local rollback drill: run the down file, confirm the exploit test now
      fails (hole reopened), re-apply 0033 SQL, confirm green again. Record
      the output.
- [ ] Client-write audit on the **deploy commit**, not the sec-1 base: no
      supabase-js `.from(<table>)` insert/update/upsert/delete and no `.rpc(`
      in `src/`. (**FACT**, 2026-09-17 on `cb2bd04`: grep finds none; the 9
      commits on `cb2bd04` not in `agent/temp-sec-1` touch nothing under
      `supabase/` or `src/db/`.) Re-run on the final commit.
- [ ] Full gates on the deploy commit: `pnpm typecheck && pnpm lint && pnpm
      test && pnpm check:rsc-boundaries`, `pnpm build`.
- [ ] Read-only production checks (§8): `drizzle.__drizzle_migrations` count
      is 33 (head 0032); the newest `frybird-backup` dump is from the last 24 h
      and `restore-check.sh` last result is OK.
- [ ] Take a fresh backup immediately before (`systemctl start
      frybird-backup`, owner-approved window). Note: it will not contain
      privileges (§2.2); record current privileges instead — read-only count of
      `information_schema.role_table_grants` rows for `anon`/`authenticated`
      by privilege type, counts only.
- [ ] Window between services. `DROP/CREATE POLICY` takes a brief exclusive
      lock on `organizations`, which most requests read; a long open
      transaction would queue every request behind it.

**Run (owner-approved)**
- [ ] `pnpm db:migrate` from the approved machine. Migration before code: 0033
      is additive for the app (the app writes as `postgres`), so no code change
      has to precede it.

**After (read-only)**
- [ ] `__drizzle_migrations` count is 34.
- [ ] Grant counts: `anon`/`authenticated` hold zero INSERT/UPDATE/DELETE/TRUNCATE
      on public tables; SELECT counts unchanged from the "before" record.
- [ ] `pg_policies` for the three tables shows only `*_tenant_read`, cmd SELECT.
- [ ] Public smoke on frybirdiq.tech (§8 row 1) and god's signed-in check:
      POS order list loads, KDS receives a live update, customer tracking page
      updates. No test order is created for this (ORG.md §7): observe real
      traffic or rely on the local-stack test.
- [ ] `journalctl -u frybird -p warning` since the run: no new
      `permission denied` / `42501` signatures.
- [ ] Recovery reference in the `RELEASES.md` row: "0033 — forward-fix;
      down file exists but reopens P0, owner sign-off required to use it".

## 4a. 0034 `iq_foundations` (not deployed; `agent/database-iq0-s6b`, cards iq0-s6, iq0-s6b)

Added 2026-09-17. Requires 0033. Built on the fixed action state machine
(`8f5c804`, iq0-s2b). Production run is owner gate 1 and decision `dec-2`.

### Classification — **Reversible while the tables hold only regenerable rows; forward-fix after**
- **What it does (FACT):** creates seven tables — `iq_job_runs`,
  `iq_insights`, `iq_forecasts`, `iq_recommendations`, `iq_actions`,
  `iq_outcomes`, `iq_auto_policies` — with text + CHECK vocabularies (no pg
  enums); four trigger functions (freeze a referenced insight; refuse deleting
  one except through an org delete; mark insights referenced when a
  recommendation is inserted; stamp `iq_actions.decided_at`/`started_at` with
  database time); RLS enabled and forced on all seven; `REVOKE ALL` from
  `PUBLIC`/`anon`/`authenticated`; `GRANT SELECT` to `authenticated` on
  `iq_insights`, `iq_recommendations`, `iq_actions` only, each with an
  OWNER/ADMIN/MANAGER read policy. No existing table, row or grant changes.
- **Action lifecycle in the schema (FACT):** mode is not stored; the CHECKs
  derive it from tier + `auto_policy_id` exactly like `modeOf`. Per-mode status
  lists equal what `TRANSITIONS` can reach (unit-tested). A policy only on A1;
  approval XOR policy; `approval_expires_at` for approval and handoff rows;
  `execute_by` on APPROVED; partial UNIQUE on open actions per org, kind and
  params hash (`OPEN_ACTION_STATUSES`). No lease columns and no
  UNDOING/UNDO_FAILED: execution and undo are one transaction (executor.ts), and
  the stale sweep reads `started_at`.
- **Down file (FACT):** `supabase/rollback/0034_iq_foundations.down.sql`, one
  `BEGIN`/`COMMIT`, drops the seven tables child-first without `CASCADE`, then
  the four functions. Policies and grants go with the tables. The journal-row
  delete is a manual step outside that transaction.
- **Tested locally (FACT, 2026-09-17, local Postgres 17.6):** applied with
  `supabase migration up --local` → `iq-foundations.integration.test.ts` 25/25 →
  down file with `ON_ERROR_STOP` + journal row deleted → 0 `iq_*` tables and
  functions left, test 21 failed / 4 skipped → re-applied → 25/25. Full
  integration suite 19 files / 140 tests green after re-apply.
- **Not tested (FACT):** the production path, `pnpm db:migrate` (drizzle-orm
  migrator, statement-breakpoint split, one transaction). The local stack is
  CLI-managed, so it was applied by the Supabase CLI instead.
- **Reason:** everything is additive, so dropping loses only iq_* rows. Until
  IQ-5 writes approvals, auto policies and outcomes, those rows are
  regenerated by the jobs. From then on they are the record of what a person
  approved and what an automatic action did: **forward-fix only**, and the
  down file becomes backup/restore (owner gate 3).
- **Data at risk:** every row in the seven tables. Today (not deployed): none.
- **Journal (FACT):** drizzle-kit stamped `when` below 0033's 1789700000000;
  `db:migrate` would have skipped 0034 in production without an error. Set by
  hand to 1789800000000. `src/db/schema/iq.test.ts` fails on any journal entry
  that does not increase.
- **Side effect to know (FACT):** a referenced insight with a `location_id`
  blocks deleting that location (its cascade reaches the delete guard); an org
  delete still cascades.

### Pre-deploy checks specific to 0034 (read-only, add to the release checklist)
- [ ] `SHOW server_version_num` ≥ 150000. `iq_forecasts_target_unique` and
      `iq_auto_policies_scope_unique` use `UNIQUE NULLS NOT DISTINCT` (D2).
- [ ] 0033 is applied first (`__drizzle_migrations` count 34 before, 35 after).
- [ ] After: `has_table_privilege` matrix for `anon`/`authenticated` × seven
      tables × seven privileges shows only `authenticated` SELECT on the three
      staff tables (booleans only, same query as the integration test).
- [ ] Open for SECURITY-TENANCY: ADMIN reads money figures in `iq_insights`
      without `finance.view`; MANAGER reads `iq_actions` params/before/after,
      which may hold win-back customer data; `service_role` keeps Supabase's
      default grants (as the design specifies).

### Hand edits drizzle-kit does not know about (for the next `db:generate`)
`iq_insights_superseded_by_fk` is `DEFERRABLE INITIALLY DEFERRED`; the four
triggers, RLS, policies and grants are hand-written SQL. None of them is in
`0034_snapshot.json`, so a later generate will not touch them, and will not
recreate them either. The trigger's open-status list duplicates
`IQ_OPEN_ACTION_STATUSES`; the integration test covers it.

## 4b. 0035 `iq_job_runs_failures` (not deployed; `agent/database-iq0-s6c`, card iq0-s6c)

Added 2026-09-17. Requires 0034. 0034 was already merged into
`kit-radix-nova` (`e116c6f`), so the column ships as its own migration.

### Classification — **Reversible while no job relies on the count; forward-fix after**
- **What it does (FACT):** `ALTER TABLE iq_job_runs ADD COLUMN failures integer
  DEFAULT 0 NOT NULL` and CHECK `failures >= 0`. Existing rows get 0. No
  grant changes: `iq_job_runs` stays server-only (`anon`/`authenticated` have
  no column privilege, checked locally).
- **Why (FACT):** `src/lib/jobs` (`d19f296`) counts failed attempts apart from
  `attempt`, the fencing generation; RELIABILITY J3 requires the column.
- **Down file (FACT):** `supabase/rollback/0035_iq_job_runs_failures.down.sql`,
  one `BEGIN`/`COMMIT`, drops the CHECK and the column. Journal-row delete is a
  manual step outside the transaction.
- **Tested locally (FACT, 2026-09-17, local Postgres 17.6):** applied with
  `supabase migration up --local` → `iq-foundations.integration.test.ts` 26/26 →
  down + journal row deleted → column gone, 2 failed / 24 passed → re-applied →
  26/26. Drizzle migrator path not tested (CLI-managed local stack).
- **Data at risk:** each run's failure count. Losing it resets retry budgets, so
  a failing job gets fresh attempts; no business data. Once jobs run in
  production and alerts read the count, fix forward instead.
- **Journal (FACT):** `when` set by hand to 1789900000000, above 0034.

## 4c. 0036 `iq_facts` (not deployed; `agent/database-iq1-s3`, card iq1-s3)

Added 2026-09-17. Requires 0034 and 0035. Production run is owner gate 1 and
decision `dec-2`; production backfill of facts is a separate approved step.

### Classification — **Reversible (derived data only)**
- **What it does (FACT):** creates `iq_daily_facts`, `iq_intraday_facts`,
  `iq_daily_trust` — additive per-day (and per 15-minute bucket) metric values
  and trust grades, text + CHECK only, `UNIQUE NULLS NOT DISTINCT` keys
  including `definition_version`; RLS enabled and forced, `REVOKE ALL` from
  `PUBLIC`/`anon`/`authenticated`, `GRANT SELECT` to `authenticated` with a
  policy for OWNER and MANAGER of the row's org. Adds three plain indexes on
  existing tables: `orders (org_id, created_at)`, `payments (order_id) WHERE
  status IN ('CAPTURED','PARTIALLY_REFUNDED')`, `inventory_movements (org_id,
  type, occurred_at)`. No existing row or grant changes.
- **Policy choice (FACT, RECOMMENDATION for SECURITY-TENANCY to confirm):** the
  design said "select org members"; the policy is OWNER + MANAGER, matching
  `finance.view` in `src/domain/permissions.ts`, because these rows are revenue,
  food cost and expense figures. ADMIN, CASHIER and ANALYST read nothing
  (tested through PostgREST). The app is unaffected: it reads as `postgres`.
- **Down file (FACT):** `supabase/rollback/0036_iq_facts.down.sql`, one
  `BEGIN`/`COMMIT`, drops the three tables and the three indexes. Journal-row
  delete is a manual step outside the transaction.
- **Tested locally (FACT, 2026-09-17, local Postgres 17.6):** applied with
  `supabase migration up --local` → `iq-facts-schema.integration.test.ts` 11/11 →
  down + journal row deleted → 0 of the 6 objects left, 8 failed / 3 skipped →
  re-applied → 11/11. Full integration suite 23 files / 163 tests green.
  Drizzle migrator path not tested (CLI-managed local stack).
- **Reason:** facts and trust grades are derived from orders, payments,
  refunds, movements and expenses, and `recomputeDay` rebuilds any day. The
  only thing a drop loses is what a past report showed before a restatement.
  Dropping the indexes loses no data.
- **Data at risk:** stored facts and grades (recomputable). Today: none.
- **Deploy note (FACT):** the three `CREATE INDEX` statements are not
  `CONCURRENTLY` (Drizzle runs migrations in one transaction), so each blocks
  writes to `orders`, `payments` or `inventory_movements` while it builds.
  RECOMMENDATION: run between services; read-only row counts first.
- **Pre-deploy (read-only):** `SHOW server_version_num` ≥ 150000 (NULLS NOT
  DISTINCT), as for 0034.
- **Journal (FACT):** `when` set by hand to 1790000000000, above 0035.

### `iq_intraday_facts` retention: 35 → 63 days (IQ-2 S8, R2.8, RELIABILITY C7)
- **FACT:** no schema change. Retention is not in the database: the job deletes
  rows. IQ-1 B7 specified 35 days; `9e05721` (iq2-s8, ANALYTICS-DATA) adds the
  writer and the purge at 63 days: `purgeIntradayFacts` deletes
  `business_date < today − 62` (IST) per org, every definition version
  (`src/lib/repositories/iq-facts.ts:737-741`,
  `src/lib/iq/metrics/intraday.ts:34`). The 8-week backfill rebuilds D−56 … D−1
  from the same IST date, so the purge never removes a day the backfill has just
  written.
- **Recovery:** intraday rows are derived from `orders` (sale set by
  `created_at`, tickets by `ready_at`). Rows lost to a purge or a drop are
  rebuilt by the backfill for the last 56 days; older buckets are not rebuilt
  and are not needed by any reader. Reverting the job to 35 days deletes days
  36–63 on its next run; no down SQL is involved.
- **Unit note (FACT):** `ticket_ready_seconds_total` is stored with unit
  `count` (a count of seconds). 0036's unit CHECK allows only `paise` and
  `count`; a dedicated `seconds` unit would need a migration widening
  `iq_intraday_facts_unit_check` and `iq_daily_facts_unit_check`.

---

## 5. Rollback files 0022–0026: the known-safe procedure

### What the files are (FACT)
| File | Undoes | Loses | Notes |
|---|---|---|---|
| `0026_…down.sql` | `pos_devices`, `printers`, `print_jobs` | all registered devices, printer config, print history | POS falls back to browser printing |
| `0025_…down.sql` | `receipt_designs` | every saved receipt design | POS prints the built-in default |
| `0024_…down.sql` | promotion type/channel/schedule columns and checks; `code` back to NOT NULL | every non-coupon promotion's rules | **fails** if any promotion has no code, unless those rows are deleted first (destructive) |
| `0023_…down.sql` | `organizations.opened_on`, `kitchen_capacity` | the two settings | |
| `0022_…down.sql` | `recipe_versions`, `recipe_version_items`, traceability columns on `inventory_movements`, `expenses.purchase_order_id`, `waste_entries.order_id`, `ingredient_prices.cost_per_base_unit_milli`, three constraints | all recipe version history and movement traceability | the `CANCELLED_ORDER` enum value stays; its "no rows in production" note dates from when it was written |

Only `0022` wraps itself in `BEGIN`/`COMMIT`. `0023` and `0024` do not say to
delete the journal row; `0022`, `0025`, `0026` do.

### Why they cannot be used on production as-is (EXPLANATION)
Production head is 0032. By §2.1, running any of these files and deleting its
journal row leaves 0027–0032 recorded above it: Drizzle never re-applies it,
and the journal no longer matches the schema. 0032 also created RLS policies
on `recipe_versions`/`recipe_version_items`; `0022.down` drops those tables,
and the policies with them, while 0032's row still claims they exist. A clean
rollback to any of 0022–0026 would first need down paths for 0033…0027, which
§9 says are not manufactured.

### Known-safe procedure
1. **Local stack first, always.** DATABASE resets the local stack, migrates to head,
   seeds, and runs
   the down files **newest first**: `0026 → 0025 → 0024 → 0023 → 0022`, only as
   far as needed. After each: delete that migration's row from
   `drizzle.__drizzle_migrations` (it is then the head, so this is
   consistent), run `pnpm db:migrate` to confirm it re-applies cleanly, then
   run the down file again. Record the output.
2. **Production use is an owner decision** (gates 1 and 3), and only as a strict
   head-backwards sequence. Today that means 0033/0032…0027 must be undone
   first, so **RECOMMENDATION: do not use 0022–0026 down files on production.
   Fix forward** with a new migration instead.
3. If the owner still approves a production rollback:
   - read-only row counts on every table the file drops (§8) and write the
     data-at-risk figures into the approval;
   - fresh backup, `restore-check.sh` OK;
   - deploy code that predates the migration **before** running the down file
     (the current app reads these objects);
   - run with `psql -v ON_ERROR_STOP=1 --single-transaction -f <file>`;
   - delete exactly that migration's journal row, and verify the journal count;
   - for `0024.down`: list codeless promotions first; deleting them is a
     separate destructive approval.

---

## 6. Open items (for god)
- Confirm read-only whether the Supabase plan has point-in-time recovery.
  It is the only restore path that also carries privileges and the migration
  journal.
- `deploy/backup.sh` excludes privileges. After 0033, a restore-to-new-project
  runbook needs "re-run 0033's privilege statements" as a step. Proposed
  follow-up card; the file is not DATABASE's path.
- Proposed rule for new down files: wrap in `BEGIN`/`COMMIT` and end with the
  journal-row instruction, as `0022` does.
