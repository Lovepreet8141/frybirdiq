-- Hand-run only. Reverses the notification outbox migration (roadmap 7.2).
-- Loses the outbox rows (messages already sent stay sent; only our record goes).
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/rollback/PENDING_notification_outbox.down.sql
-- then delete its row from drizzle.__drizzle_migrations once numbered.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP TABLE IF EXISTS "notification_outbox";
COMMIT;
