-- auth-v2: a unique constraint on (org_id, user_id), closing a check-then-insert race the security review
-- found in completeProfileAction — two concurrent submits of the new-account profile form (a double-tap
-- before the first response returns) could otherwise both pass the "does this user already have a row"
-- pre-check and both insert one, leaving two customers rows for the same account. NULL user_id (guest
-- checkout rows) is unaffected: Postgres treats every NULL as distinct from every other NULL, so guest rows
-- never conflict with each other under this constraint. Undo: supabase/rollback/0057_customers_org_user_unique.down.sql
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_org_user_unique" UNIQUE("org_id","user_id");
