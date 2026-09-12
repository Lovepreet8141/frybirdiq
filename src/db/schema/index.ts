/**
 * The database schema. BUILD-PLAN.md §50.
 *
 * Split by domain rather than kept in one file, because the alternative is a
 * two-thousand-line module nobody reads before adding a column.
 */

export * from "./_shared";
export * from "./tenancy";
export * from "./menu";
export * from "./customers";
export * from "./tables";
export * from "./orders";
export * from "./inventory";
export * from "./platform";
export * from "./expenses";
