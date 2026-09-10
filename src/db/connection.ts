/**
 * Builds the database connection.
 *
 * Deliberately free of `server-only`, because CLI tools legitimately need a
 * connection outside a request: `seed.ts` runs under tsx, where `server-only`
 * throws on import.
 *
 * Application code must not import this directly — it imports `@/db`, which is
 * this module plus the `server-only` guard that keeps a database client out of
 * a client bundle. §46.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { serverEnv } from "@/lib/env";
import * as schema from "./schema";

let connection: ReturnType<typeof postgres> | undefined;
let instance: ReturnType<typeof drizzle<typeof schema>> | undefined;

/** Lazily connected, so importing this module does not require a database. */
export function db() {
  if (!instance) {
    // `prepare: false` is required by Supabase's connection pooler; harmless
    // on a direct connection.
    connection ??= postgres(serverEnv().DATABASE_URL, { prepare: false });
    instance = drizzle(connection, { schema });
  }
  return instance;
}

/** Closes the pool so a CLI script can exit rather than hanging. */
export async function closeDb(): Promise<void> {
  await connection?.end({ timeout: 5 });
  connection = undefined;
  instance = undefined;
}

export { schema };
