/**
 * The database, for application code.
 *
 * Server-only, and never imported by a component. §3: "Do not let UI
 * components directly query arbitrary database tables" — components call the
 * repository layer, repositories call this.
 *
 * CLI scripts import `./connection` instead, which is the same connection
 * without the guard.
 */
import "server-only";

export { closeDb, db, schema } from "./connection";
