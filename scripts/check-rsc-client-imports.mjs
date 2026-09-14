// Catches the bug class that broke /app/iq in production: a Server
// Component importing a function from a "use client" module and calling
// it during render. Across the RSC boundary such an import is a client
// reference, not a function — React throws "Attempted to call X() from the
// server but X is on the client" only when the page actually renders, so
// typecheck and `next build` both pass.
//
// The rule is deliberately narrow so legitimate usage never trips it:
//   - only .tsx/.ts files under src/app and src/components with no
//     "use client" / "use server" directive are treated as server modules;
//   - only named imports from a module that *does* start with "use client"
//     are considered, `import type` and `type X` specifiers excluded;
//   - an identifier is flagged only when the server file *calls* it —
//     `name(` — never when it is rendered as JSX (`<Name`) or passed as a
//     prop, both of which are exactly what client modules are for.
//
//   node scripts/check-rsc-client-imports.mjs
//
// Exits 1 and prints every offending call if it finds one.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const roots = ["src/app", "src/components"].map((dir) => join(root, dir));

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) yield* walk(path);
    else if (/\.(tsx|ts)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) yield path;
  }
}

const directiveOf = (source) => {
  const head = source.split("\n", 3).join("\n");
  if (/^\s*["']use client["']/m.test(head)) return "client";
  if (/^\s*["']use server["']/m.test(head)) return "server-action";
  return null;
};

function resolveModule(specifier) {
  if (!specifier.startsWith("@/")) return null;
  const base = join(root, "src", specifier.slice(2));
  for (const candidate of [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const clientCache = new Map();
const isClientModule = (file) => {
  if (!clientCache.has(file)) clientCache.set(file, directiveOf(readFileSync(file, "utf8")) === "client");
  return clientCache.get(file);
};

const importPattern = /import\s*(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;

let failures = 0;
for (const dir of roots) {
  for (const file of walk(dir)) {
    const source = readFileSync(file, "utf8");
    if (directiveOf(source) !== null) continue;

    for (const match of source.matchAll(importPattern)) {
      const [, typeOnly, specifiers, specifier] = match;
      if (typeOnly) continue;
      const target = resolveModule(specifier);
      if (!target || !isClientModule(target)) continue;

      for (const raw of specifiers.split(",")) {
        const spec = raw.trim();
        if (!spec || spec.startsWith("type ")) continue;
        const local = spec.includes(" as ") ? spec.split(/\s+as\s+/)[1].trim() : spec;
        const call = new RegExp(`(^|[^\\w.<])${local}\\s*\\(`, "m");
        const rest = source.slice(match.index + match[0].length);
        if (call.test(rest)) {
          const line = source.slice(0, match.index).split("\n").length;
          console.error(`REFUSING: ${file.replace(`${root}/`, "")}:${line} imports \`${local}\` from the "use client" module ${specifier} and calls it during server render`);
          console.error(`  Move \`${local}\` into a module with no directive (src/domain or src/lib) and import it from there.`);
          failures += 1;
        }
      }
    }
  }
}

if (failures === 0) console.log("OK — no Server Component calls a function imported from a \"use client\" module");
process.exit(failures === 0 ? 0 : 1);
