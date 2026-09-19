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


## 4d. 0037 `iq_insights_copy_trust` (not deployed; `agent/database-iq2-s1`, cards iq2-s1, iq2-s1b)

Added 2026-09-17. Requires 0034. IQ-2 slice S1 (hive `reviews/iq-2/DESIGN.md`
S1 + Revision 2 R2.2, R2.3, R2.11). Production run is owner gate 1 and
decision `dec-2`.

### Numbering (FACT)
First committed as 0038, leaving 0037 for the refund release. ARCHITECT
refused that (iq2-s1r): drizzle applies an entry only when its `when` is
above the last applied `created_at`, so a 0037 merged later with a lower
`when` would be skipped in production without an error. It is now **0037**,
the next free number, with journal `when` 1790200000000. The refund release
takes the next free number when it merges, with a `when` above every applied
entry. `src/db/schema/iq.test.ts` fails on a journal tag whose number is not
its `idx` (a gap) and on a `when` that does not increase.

### Classification — **Reversible while insights are derived; forward-fix once IQ-2 writes production rows**
- **What it does (FACT):** on `iq_insights` adds
  - `copy jsonb NOT NULL DEFAULT '{"templateId":"none","slots":{}}'` with a
    strict shape CHECK (exactly `templateId` + `slots`; identifier template id,
    identifier slot names, dotted payload-path values; the patterns are
    unit-tested against the engine's Zod schemas);
  - `trust_metric_ids text[]`, `trust_reasons text[]` (`NOT NULL DEFAULT
    '{}'`) with a CHECK: MEASURED ≥ 1 metric id; INSUFFICIENT_DATA ≥ 1 reason
    and no metric ids; NOT_MEASURED neither; elements match the engine
    identifier / code patterns, no empty or comma-carrying element, ≤ 50 each;
  - `as_of timestamptz NOT NULL` with **no default** (RELIABILITY U2); existing
    rows take `period_end`;
  - `status_reason text` in CLEARED | CLOSING_TIME (EXPIRED) | SUPERSEDED |
    RETRACTED (their own status), null while ACTIVE;
  - CHECK `dedupe_key LIKE 'recon:%'` ⇔ `producer LIKE 'recon.%'`, same for
    `sig:` / `sig.` (ARCHITECT P3);
  - `CREATE OR REPLACE` of 0034's `iq_insights_freeze_referenced()` adding
    `copy`; trust, `as_of`, status and `status_reason` stay writable;
  - the `iq_insights_staff_read` policy narrowed: OWNER or MANAGER, or ADMIN
    for any producer not starting `recon.` or `sig.` (R2.2).
- **Existing rows (FACT, drilled locally):** the migration first refuses (SQLSTATE
  55000, nothing applied) when any row is MEASURED or INSUFFICIENT_DATA, since
  their metric ids / reasons cannot be recovered. Such rows are derived:
  delete them, apply, and let the jobs rewrite them. NOT_MEASURED rows,
  referenced ones included, get the placeholder copy, empty trust arrays and
  `as_of = period_end`. Drill: two seeded NOT_MEASURED rows (one cited by a
  recommendation) plus one MEASURED row → refused, schema unchanged → MEASURED
  row deleted → applied → both rows backfilled; a later copy change on the
  referenced row is refused by the freeze trigger. Production has no
  `iq_insights` rows (dec-2).
- **Cross-owner touch (FACT):** `as_of` has no default, so every insert must
  set it. `src/lib/repositories/iq-insights.ts` (IQ-ENGINE) now writes `copy`,
  the trust arrays and `as_of = period.end`, and three integration fixtures set
  `asOf`. S2 replaces `as_of = period.end` with the writer's explicit `asOf`.
- **Down file (FACT):** `supabase/rollback/0037_iq_insights_copy_trust.down.sql`,
  one `BEGIN`/`COMMIT`: restores 0034's policy and 0034's freeze function body
  verbatim, drops the four constraints and five columns. Journal-row delete is
  a manual step outside the transaction.
- **Tested locally (FACT, 2026-09-17, local Postgres 17.6):** as 0038
  (`bd9885e`): `supabase migration up --local` → the insights integration test
  10/10 → down + journal row deleted → 0 new columns, 0034 policy and function
  restored, 6 failed / 4 skipped → re-applied → 10/10. After the renumber
  (SQL unchanged except comments and the refusal message), on a per-worktree
  database (`hive/tools/test-db.sh`): built from 0000–0037 →
  `iq-insights-0037.integration.test.ts` 6 passed / 4 skipped (the PostgREST
  suite needs the shared stack) → down + `0037` row deleted → 6 failed →
  `test-db.sh migrate` → 6 passed. Drizzle migrator path not tested
  (CLI-managed local stack).
- **Data at risk:** each insight's copy, trust detail, `as_of` and
  `status_reason`. Insights are derived today; once IQ-2 writes production
  insights that recommendations cite, fix forward.
- **Down is one-way once S2 writes MEASURED insights (FACT, RELIABILITY
  iq2-s1r):** the down file drops the trust arrays, and re-applying 0037 then
  refuses while any MEASURED or INSUFFICIENT_DATA row exists. "Delete them"
  does not work for an insight a recommendation cites
  (`iq_recommendations_insight_fk`, ON DELETE NO ACTION, 0034) and would erase
  decision history anyway. RECOMMENDATION: after S2 writes such rows, do not
  run the down file; fix forward. If it was run, re-apply only on a table with
  no MEASURED or INSUFFICIENT_DATA row cited by a recommendation.

### Intraday facts retention
Recorded with the table it applies to, in §4c (35 → 63 days, iq2-s8). 0037
does not touch `iq_intraday_facts`.

## 4e. 0038 `refunds_status_idempotency` (not deployed; `agent/database-ref-b1`, card ref-b1)

Added 2026-09-17. Requires 0037. Slice 1 of the refund redesign
(`hive/agents/michael-mu4lr1ro/reports/2026-09-16-refund-design.md`,
Revision 2). Owner decision dec-10 approved it for the local build; running it
in production is owner gate 1, and changing the live cash refund path is gate 7.

### Classification — **Reversible only with every refund SUCCEEDED; forward-fix otherwise**
- **What it does (FACT):** on `refunds` adds
  - `status text NOT NULL DEFAULT 'SUCCEEDED'`, CHECK in RESERVED | SUCCEEDED |
    FAILED.
  - `idempotency_key text` (nullable, 1–200 characters) with
    `UNIQUE (org_id, idempotency_key)`, NULLs distinct, so rows written before
    0038 never collide (design B3).
  - `finalized_at timestamptz DEFAULT now()`; existing rows take `created_at`
    (design S6); CHECK `(status = 'SUCCEEDED') = (finalized_at IS NOT NULL)`:
    FAILED and RESERVED keep it null (FINANCE-LEDGER S6 condition).
- **Expand phase (FACT, RELIABILITY review of `16cfc7f`):** production migrates
  before it deploys, so the code already live keeps inserting refunds with
  neither column. The two defaults make those inserts finalized SUCCEEDED rows,
  which is what that code means. Design S3's "drop the status default in the
  same migration" is deferred to a **contract migration**, carded after the
  refund redesign is live, that drops both defaults. Until then a RESERVED or
  FAILED insert must pass `finalized_at = NULL` explicitly; omitting it is
  refused by the CHECK (tested).
  - indexes `refunds_payment_idx (payment_id)` for the refundable-balance sum
    and `refunds_reserved_idx (org_id, created_at) WHERE status = 'RESERVED'`
    for the stuck-reservation sweep.
- **Existing rows (FACT):** all classified SUCCEEDED with
  `finalized_at = created_at`; none is left unclassified. Basis: the only insert
  into `refunds` in `src/` and `scripts/` runs after the provider confirmed the
  refund, cash refunds succeed by construction, and production has no Razorpay
  refunds (design §4). Production row counts were not checked on this card (no
  production access). Drilled on a per-worktree database: two pre-0038 cash
  refunds → SUCCEEDED with `finalized_at = created_at` (not the migration's
  `now()`), and an insert without status or finalized_at afterwards → a
  finalized SUCCEEDED row.
- **Cross-owner touch (FACT):** `status` has no default, so
  `src/lib/repositories/payments.ts` (PAYMENT-SAFETY) now writes
  `status: 'SUCCEEDED', finalized_at: now()` on its existing insert, which runs
  only after the provider confirmed. Slice 3 replaces it with RESERVE →
  finalize. The integration fixture `__test-support__/iq-fixtures.ts` does the
  same.
- **Down file (FACT):** `supabase/rollback/0038_refunds_status_idempotency.down.sql`,
  one transaction (design S2): `SET LOCAL lock_timeout = '5s'` →
  `LOCK TABLE refunds IN ACCESS EXCLUSIVE MODE` →
  guard that **refuses** (55000, naming each id and status) while any refund is
  not SUCCEEDED → drop the two indexes, the unique constraint and the three
  CHECKs → drop the three columns. It never deletes a refund. Journal-row
  delete is a manual step outside the transaction.
- **Why it refuses (EXPLANATION):** a RESERVED row can be money the gateway
  already returned (crash before finalize), and the pre-0038 code sums every
  refund row as money returned. Keeping or deleting RESERVED/FAILED rows both
  misstate the books. Reconcile each first (design §4: provider lookup or the
  staff member on the audit row), or fix forward.
- **Tested locally (FACT, 2026-09-17, local Postgres 17.6, per-worktree
  database):** built 0000–0038 → `refunds-0038.integration.test.ts` 4/4 →
  down refused with a RESERVED row and again with a FAILED row (columns intact) →
  row finalized → down ran (0 new columns and indexes left, 3 refunds kept) →
  `test-db.sh migrate` re-applied → the tests failed 4/4 while down, passed 4/4
  after re-apply. After the expand-phase change: `refunds-0038.integration.test.ts`
  6/6, including the down file run inside a rolled-back transaction (refuses
  with a RESERVED row and names it; otherwise `lock_timeout` is 5s and all of
  0038's columns, indexes and constraints are gone; the test fails if the
  `SET LOCAL lock_timeout` line is removed).
  Drizzle migrator path not tested (CLI-managed local stack).
- **Data at risk:** each refund's `status`, `idempotency_key` and `finalized_at`.
  After a down + re-apply every surviving refund gets
  `finalized_at = created_at`, losing a later finalize time. Once slice 3 writes
  RESERVED/FAILED rows in production, fix forward.
- **Journal (FACT):** `when` set by hand to 1790300000000, above 0037.

## 4f. 0039 `ordering_pause` (not deployed; `agent/database-ops-1-s2`, card ops-1 S2)

Added 2026-09-20. Requires 0038. The Close Shop switch
(`hive/research/ops-1/DESIGN.md` S2): staff pause online ordering without
touching the opening hours, and `placeOrder` refuses while paused, before any
payment.

> **Roll back only while no shop is paused.** The code before 0039 has no idea
> a pause exists. Dropping the columns while a shop is paused **silently
> REOPENS it**: customers can order again, and nothing tells anyone. Resume
> ordering first. The down file enforces this and refuses otherwise. A pause
> whose `ordering_paused_until` has already passed counts as open and does not
> block.

### Classification — **Reversible while not paused**
- **What it does (FACT):** on `organizations` adds `ordering_paused_at
  timestamptz`, `ordering_paused_by uuid` (loose, not a foreign key: the auth
  user id, as in `inventory.ts` and `menu.ts`), `ordering_paused_reason text`
  and `ordering_paused_until timestamptz`, all nullable, no default, no
  backfill. `_until` is the owner's "how long" (god, ops-1 amendment): "until
  we next open" (default) sets it, "until I switch it back on" leaves it null.
  Nothing writes at that instant: a pause past its `_until` simply no longer
  counts. One CHECK, `organizations_ordering_pause_check`:
  - `paused_at` and `paused_by` are set together. Every pause has a person
    behind it; an automatic pause with no human actor would need this CHECK
    changed first, deliberately (none exists or is planned).
  - The reason and `_until` are null whenever not paused (a resume clears
    them).
  - A reason is 1–200 characters. The staff form is stricter (3–200, required).
  - `_until` is after `paused_at`. It is written as `_until IS NULL OR
    (paused_at IS NOT NULL AND _until > paused_at)`: the plain comparison
    alone is NULL when `paused_at` is null, and a NULL CHECK passes.

  `SET LOCAL lock_timeout = '5s'` first: `organizations` is read on every
  request.
- **Expand-only (FACT):** safe to run before the deploy. Every existing org
  reads as taking orders, and the code already live never names these columns.
  It reads `organizations` only through Drizzle's explicit column lists; there
  is no raw `SELECT *` on it in `src/` or `scripts/`.
- **RLS (FACT):** unchanged. `organizations_tenant_read` (0033) is `FOR SELECT
  TO authenticated USING (id IN (SELECT auth_org_ids()))`, and `auth_org_ids()`
  (0001) reads `memberships` only, so `paused_by` and the reason never reach a
  customer or an anonymous caller.
- **Down file (FACT):** `supabase/rollback/0039_ordering_pause.down.sql`, one
  transaction: `SET LOCAL lock_timeout = '5s'` → `LOCK TABLE organizations IN
  ACCESS EXCLUSIVE MODE` → guard that **refuses** (55000, naming each org's
  slug, pause time and end time or "until switched back on") while any pause
  is in force, meaning `paused_at` is set and `_until` is null or still ahead →
  drop the CHECK → drop the four columns. Journal-row delete is a manual step outside the
  transaction (production: `created_at = 1790400000000`).
- **Tested locally (FACT, 2026-09-20, local Postgres 17.6, per-worktree
  database):** `ordering-pause-0039.integration.test.ts` failed before 0039
  was applied and passes 16/16 after the `_until` amendment. It covers the
  defaults, pause until next opening and resume, a manual-only pause, a pause
  without a reason, 200 characters accepted and 201 refused, seven CHECK
  refusals (including `_until` while not paused, equal to and before
  `paused_at`), and the down file inside a rolled-back transaction:
  - it refuses a pause ending later and a manual-only pause, naming the org;
  - it lets an already-ended pause through (fail-first: with the old
    "any `paused_at`" guard that test fails);
  - otherwise it sets a 5 s timeout and removes exactly 0039's columns and
    CHECK.

  The first three-column version was also drilled for real with psql: a paused
  org made the down refuse with its columns intact; after the resume it ran,
  0 columns were left and the org was kept; then `test-db.sh migrate`
  re-applied it. Drizzle migrator path not tested (CLI-managed local stack).
- **Drilled for real (FACT, 2026-09-20, Release 2):** on a throwaway database
  (`frybird_drill_0039`, the `organizations` table copied from the local stack,
  dropped afterwards) with psql: pre-0039 → apply 0039 (4 columns, CHECK) →
  down file **refused** while a pause was in force, schema untouched → resume →
  down file ran (0 columns, 0 CHECK) → re-apply (4 columns, CHECK). All clean.
  The down file prints two harmless "transaction" warnings under
  `--single-transaction` because it has its own BEGIN/COMMIT.
- **Data at risk:** only the current pause state (when, who, why, until). Each pause
  and resume keeps its `audit_logs` row.
- **Journal (FACT):** `when` set by hand to 1790400000000, above 0038.

---

### Rollback runbook for the Close Shop release (Release 2) — written 2026-09-20

Live before it: `383e693` (BUILD_ID `QfcS3cFFTWYktErhEU-8Q`, migration head 0038).
The code-only rollback below keeps 0039 in place. That is safe because 0039 is
additive and nullable: the old build names none of the four columns, and its
Drizzle column lists ignore them (checked 2026-09-20: the old build's
integration suite, 45 files / 437 tests, run against a database that has 0039, passes).

1. **Resume ordering FIRST.** Admin → Restaurant → "Switch orders back on" (or
   the POS switch). Confirm the panel says "Shop is OPEN for orders". The old
   build has no pause check: a pause left in force is silently ignored, orders
   flow, the switch and banner disappear, and an "until I switch it back on"
   pause reappears on the next roll-forward, possibly days later.
2. Redeploy the old commit from its worktree: `./deploy/deploy.sh
   root@194.238.16.200` at `383e693` (code only; no database step).
3. Smoke: `/` and `/menu` 200, `/api/health` 200, zero journal errors.
4. Leave 0039 in place. Run the down file (`supabase/rollback/0039_ordering_pause.down.sql`)
   only if the columns themselves must go, only after step 1, and never before
   step 2: it refuses while a pause is in force, and the new build fails on
   every organizations read if the columns are gone.
5. Do NOT roll back the database first. New code without the columns is a
   site-wide outage (every organizations read names them).

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
