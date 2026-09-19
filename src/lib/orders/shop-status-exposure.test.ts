/**
 * Who may call the staff read of the Close Shop switch (ops-1; SECURITY-TENANCY's
 * condition for S4/S5).
 *
 * `getOrderingStatusForStaff` returns who paused and the reason they typed.
 * `getOrderingStatus` is the customer read and carries neither. If a shared
 * layout or a customer page imported the staff read, the reason and a staff
 * member's name would go to every visitor — and nothing would error.
 *
 * So this is an allow-list, not a deny-list: the staff read may be imported
 * only from the staff area (src/app/(app)), the one action module that checks
 * a permission before calling it, and the module that defines it. A new
 * customer page, a new root layout, a new shared component — anywhere else —
 * fails here the moment it imports it. Type-only imports are fine: a type
 * carries no data.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..");
const SRC = join(ROOT, "src");

const ALLOWED = [
  "src/app/(app)/",
  "src/lib/orders/shop-status-actions.ts",
  "src/lib/repositories/shop-status.ts",
  // Pre-order listings carry customer names (ops-3): staff area and their own module only.
  "src/lib/repositories/closed-dates.ts",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Imports the function by name — not `import type { ... }`, and not in a test. */
function importsStaffRead(text: string): boolean {
  const statements = text.match(/import\s+(?!type\b)[^;]*?from\s+["'][^"']+["']/gs) ?? [];
  return statements.some((statement) => /\b(getOrderingStatusForStaff|findPreOrdersOnClosedDays|getClosuresOverview)\b/.test(statement.replace(/\btype\s+\w+/g, "")));
}

describe("the staff read of the shop switch stays out of customer code", () => {
  it("is imported only from the staff area, the permission-checked actions, and its own module", () => {
    const offenders = sourceFiles(SRC)
      .map((path) => relative(ROOT, path).split(sep).join("/"))
      .filter((path) => !/\.test\.tsx?$/.test(path))
      .filter((path) => !ALLOWED.some((allowed) => path === allowed || path.startsWith(allowed)))
      .filter((path) => importsStaffRead(readFileSync(join(ROOT, path), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the check itself notices a real import, and ignores a type-only one", () => {
    expect(importsStaffRead('import { getOrderingStatusForStaff } from "@/lib/repositories/shop-status";')).toBe(true);
    expect(importsStaffRead('import {\n  getOrderingStatus,\n  getOrderingStatusForStaff,\n} from "@/lib/repositories/shop-status";')).toBe(true);
    expect(importsStaffRead('import type { StaffOrderingStatus } from "@/lib/repositories/shop-status";')).toBe(false);
    expect(importsStaffRead('import { getOrderingStatus } from "@/lib/repositories/shop-status";')).toBe(false);
    expect(importsStaffRead('import { getClosuresOverview } from "@/lib/repositories/closed-dates";')).toBe(true);
    expect(importsStaffRead('import { findPreOrdersOnClosedDays } from "@/lib/repositories/closed-dates";')).toBe(true);
  });
});
