-- Hand-run only. Reverses 0053 (cash refunds attributed to a till): one transaction.
--
-- Loses: which till each cash refund came out of (refunds.cash_session_id). The refunds themselves, their amounts and
-- the tills' stored figures are untouched. After the undo, the previous code (which counts a till's refunds by time
-- window) works exactly as before. Export first if the attribution matters:
--   COPY (SELECT id, payment_id, amount, cash_session_id FROM refunds WHERE cash_session_id IS NOT NULL) TO STDOUT WITH CSV HEADER;
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP INDEX IF EXISTS "refunds_cash_session_idx";
ALTER TABLE "refunds" DROP CONSTRAINT IF EXISTS "refunds_cash_session_only_cash";
ALTER TABLE "refunds" DROP CONSTRAINT IF EXISTS "refunds_cash_session_id_cash_sessions_id_fk";
ALTER TABLE "refunds" DROP COLUMN IF EXISTS "cash_session_id";
COMMIT;
