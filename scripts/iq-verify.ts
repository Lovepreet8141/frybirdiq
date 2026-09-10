import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { sql } from "drizzle-orm";
import { closeDb, db } from "@/db/connection";

async function main() {
  const tables = (await db().execute(sql`
    select tablename, rowsecurity from pg_tables
    where schemaname='public'
      and tablename in ('accounts','expense_categories','expenses','recurring_expenses','targets')
    order by tablename`)) as unknown as { tablename: string; rowsecurity: boolean }[];
  console.log("new tables:");
  for (const r of tables) {
    console.log(`  ${r.tablename.padEnd(22)} RLS ${r.rowsecurity ? "on" : "OFF"}`);
  }

  const cols = (await db().execute(sql`
    select column_name from information_schema.columns
    where table_name='ingredients' and column_name in ('waste_bps','cost_per_base_unit_milli')
    order by column_name`)) as unknown as { column_name: string }[];
  console.log("\ningredients columns added:");
  for (const r of cols) console.log(`  ${r.column_name}`);

  const counts = (await db().execute(sql`
    select
      (select count(*) from orders)::int as orders,
      (select count(*) from products)::int as products,
      (select count(*) from ingredients)::int as ingredients`)) as unknown as {
    orders: number;
    products: number;
    ingredients: number;
  }[];
  const c = counts[0];
  console.log(`\nlive data intact: ${c?.orders} orders, ${c?.products} products, ${c?.ingredients} ingredients`);
  await closeDb();
}

void main();

