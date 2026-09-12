import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { sql } from "drizzle-orm";
import { closeDb, db } from "@/db/connection";

/**
 * Before/after check for migration 0022 (inventory recipe versions and
 * movement traceability). Run once before applying (baseline: counts, and
 * the new objects reported missing) and once after (counts identical, new
 * objects present). Read-only.
 *
 *   pnpm tsx scripts/inventory-migration-verify.ts
 */
async function main() {
  const counts = (await db().execute(sql`
    select
      (select count(*) from orders)::int            as orders,
      (select count(*) from order_items)::int       as order_items,
      (select count(*) from payments)::int          as payments,
      (select count(*) from products)::int          as products,
      (select count(*) from expenses)::int          as expenses,
      (select count(*) from ingredients)::int       as ingredients,
      (select count(*) from recipes)::int           as recipes,
      (select count(*) from recipe_items)::int      as recipe_items,
      (select count(*) from purchase_orders)::int   as purchase_orders,
      (select count(*) from inventory_movements)::int as inventory_movements,
      (select count(*) from waste_entries)::int     as waste_entries,
      (select count(*) from audit_logs)::int        as audit_logs`)) as unknown as Record<string, number>[];
  console.log("live data:");
  for (const [table, n] of Object.entries(counts[0] ?? {})) console.log(`  ${table.padEnd(22)} ${n}`);

  const tables = (await db().execute(sql`
    select tablename from pg_tables
    where schemaname = 'public' and tablename in ('recipe_versions', 'recipe_version_items')
    order by tablename`)) as unknown as { tablename: string }[];
  console.log(`\nnew tables present: ${tables.map((t) => t.tablename).join(", ") || "(none)"}`);

  const columns = (await db().execute(sql`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public' and (
      (table_name = 'recipes'             and column_name = 'current_version_id') or
      (table_name = 'inventory_movements' and column_name in ('order_item_id', 'recipe_version_id', 'reversal_of_movement_id')) or
      (table_name = 'ingredient_prices'   and column_name = 'cost_per_base_unit_milli') or
      (table_name = 'waste_entries'       and column_name = 'order_id') or
      (table_name = 'expenses'            and column_name = 'purchase_order_id'))
    order by table_name, column_name`)) as unknown as { table_name: string; column_name: string }[];
  console.log(`new columns present (${columns.length}/7):`);
  for (const c of columns) console.log(`  ${c.table_name}.${c.column_name}`);

  const objects = (await db().execute(sql`
    select conname as name, contype as kind from pg_constraint
    where conname in ('purchase_orders_status_check', 'expenses_purchase_order_category_unique', 'recipe_versions_recipe_version_unique', 'recipe_version_items_unique')
    union all
    select indexname, 'i' from pg_indexes where indexname = 'inventory_movements_sale_line_unique'
    order by 1`)) as unknown as { name: string; kind: string }[];
  console.log(`new constraints/indexes present (${objects.length}/5):`);
  for (const o of objects) console.log(`  ${o.name} (${o.kind})`);

  const enumValues = (await db().execute(sql`
    select enumlabel from pg_enum
    where enumtypid = 'waste_reason'::regtype order by enumsortorder`)) as unknown as { enumlabel: string }[];
  console.log(`waste_reason values: ${enumValues.map((e) => e.enumlabel).join(", ")}`);

  const journal = (await db().execute(sql`
    select count(*)::int as applied from drizzle.__drizzle_migrations`)) as unknown as { applied: number }[];
  console.log(`\nmigrations applied: ${journal[0]?.applied}`);
  await closeDb();
}

void main();
