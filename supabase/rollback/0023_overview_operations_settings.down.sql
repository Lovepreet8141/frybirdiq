-- Hand-run only; not part of the migrations directory. Reverses 0023.
-- Both columns are additive; dropping them loses only the two settings.
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "opened_on";
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "kitchen_capacity";
