import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Next.js loads .env.local on its own; drizzle-kit does not. Without this the
// CLI sees an empty DATABASE_URL and reports it as a missing param.
config({ path: ".env.local", quiet: true });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./supabase/migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  casing: "snake_case",
  verbose: true,
  strict: true,
});
