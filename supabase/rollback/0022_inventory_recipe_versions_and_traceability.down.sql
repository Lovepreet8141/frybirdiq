-- Recovery script for migration 0022 (inventory recipe versions and
-- movement traceability). NOT applied by drizzle-kit — this directory is
-- outside supabase/migrations on purpose. Run by hand only if 0022 must be
-- undone, then delete its row from drizzle.__drizzle_migrations.
--
-- Everything 0022 added is additive and, at the time of writing, holds no
-- rows in production, so reversing it loses nothing. One thing cannot be
-- reversed: Postgres does not support removing a value from an enum, so
-- 'CANCELLED_ORDER' stays in waste_reason. Harmless — nothing writes it
-- until the consumption slice exists.

BEGIN;

ALTER TABLE "purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_status_check";
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_purchase_order_category_unique";
DROP INDEX IF EXISTS "inventory_movements_sale_line_unique";

ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_purchase_order_id_purchase_orders_id_fk";
ALTER TABLE "recipes" DROP CONSTRAINT IF EXISTS "recipes_current_version_id_recipe_versions_id_fk";
-- Postgres truncated this identifier to 63 characters when 0022 was applied
-- (NOTICE 42622); the name below is the one that actually exists.
ALTER TABLE "inventory_movements" DROP CONSTRAINT IF EXISTS "inventory_movements_reversal_of_movement_id_inventory_movements";
ALTER TABLE "inventory_movements" DROP CONSTRAINT IF EXISTS "inventory_movements_recipe_version_id_recipe_versions_id_fk";

ALTER TABLE "expenses" DROP COLUMN IF EXISTS "purchase_order_id";
ALTER TABLE "waste_entries" DROP COLUMN IF EXISTS "order_id";
ALTER TABLE "recipes" DROP COLUMN IF EXISTS "current_version_id";
ALTER TABLE "inventory_movements" DROP COLUMN IF EXISTS "reversal_of_movement_id";
ALTER TABLE "inventory_movements" DROP COLUMN IF EXISTS "recipe_version_id";
ALTER TABLE "inventory_movements" DROP COLUMN IF EXISTS "order_item_id";
ALTER TABLE "ingredient_prices" DROP COLUMN IF EXISTS "cost_per_base_unit_milli";

DROP TABLE IF EXISTS "recipe_version_items";
DROP TABLE IF EXISTS "recipe_versions";

-- The enum value 'CANCELLED_ORDER' is intentionally left in place (see above).

COMMIT;
