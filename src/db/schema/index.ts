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
export * from "./receipt";
export * from "./hardware";
export * from "./franchise";
export * from "./iq";
export * from "./iq-facts";
export * from "./closures";
export * from "./cash";
export * from "./kitchen";
export * from "./shifts";
export * from "./notifications";
