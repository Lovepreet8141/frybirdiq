/**
 * The database connection.
 *
 * Server-only, and never imported by a component. §3: "Do not let UI
 * components directly query arbitrary database tables" — components call the
 * repository layer, repositories call this.
 */
import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { serverEnv } from "@/lib/env";
import * as schema from "./schema";

let connection: ReturnType<typeof postgres> | undefined;

function client() {
  if (!connection) {
    connection = postgres(serverEnv().DATABASE_URL, { prepare: false });
  }
  return connection;
}

let instance: ReturnType<typeof drizzle<typeof schema>> | undefined;

/** Lazily connected, so importing this module does not require a database. */
export function db() {
  if (!instance) instance = drizzle(client(), { schema });
  return instance;
}

export { schema };
