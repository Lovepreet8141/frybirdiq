#!/usr/bin/env bash
#
# Catches the exact bug class that broke /app/iq/menu and the Menu
# Manager's product preview in production: a Server Component (a .tsx file
# with no "use client" at the top) handing a plain closure to a JSX prop.
#
# Neither `pnpm typecheck` nor `pnpm build` catches this. It is a *runtime*
# RSC serialization check — React only rejects a non-serializable function
# prop when the page actually renders for a real request, and `next build`
# does not render a `force-dynamic` route (every authenticated staff page
# is one) at build time. TypeScript sees `action: () => Promise<T>` and
# `action={() => someAction(id)}` and considers both perfectly well-typed;
# the type system has no concept of "this value must survive serialization
# across a server/client boundary." Nothing short of actually rendering the
# page — or a static check aimed at this exact pattern — catches it.
#
# What this checks: every .tsx file that does NOT start with "use client"
# gets scanned for an inline function literal used as a JSX prop value
# (`prop={() => ...}`, `prop={(args) => ...}`, `prop={async ...}`). A
# Server Component cannot define client-side interactivity of any kind —
# there is no legitimate reason for a function *literal* to appear as a JSX
# prop value in one, whether the target is an imported Client Component or
# a native DOM element. The one safe way to hand a Server Component's data
# to a Client Component's action is `someServerAction.bind(null, id)` on a
# direct reference to a "use server" function — Next's compiler recognises
# that specific shape and preserves it as a real server reference. This
# script allowlists `.bind(` for exactly that reason.
#
#   bash scripts/check-rsc-boundaries.sh
#
# Exits 1 and prints every offending line if it finds one.
set -uo pipefail

cd "$(dirname "$0")/.."

fail=0

while IFS= read -r -d '' file; do
  # Skip actual Client Components — they're allowed to do this freely,
  # the whole point of "use client" is that a function value never has to
  # cross a serialization boundary from there.
  if head -3 "$file" | grep -q '"use client"'; then
    continue
  fi

  # An inline function literal in JSX-prop position: `={() =>`, `={(x) =>`,
  # `={(x, y) =>`, or `={async `. `.bind(` on a direct reference is the
  # documented-safe pattern and is excluded explicitly, not just by missing
  # this regex — grep -v drops any line containing it even if the rest of
  # the line would otherwise match.
  matches=$(grep -nE '=\{(\([a-zA-Z_, ]*\)|[a-zA-Z_][a-zA-Z0-9_]*)\s*=>|=\{async ' "$file" | grep -v '\.bind(')
  if [ -n "$matches" ]; then
    echo "REFUSING: $file passes a function literal as a JSX prop from a Server Component" >&2
    echo "$matches" | sed 's/^/  /' >&2
    echo "  Fix: pass a direct .bind()'d Server Action reference, or move this into a Client Component." >&2
    fail=1
  fi
done < <(find src/app src/components -iname "*.tsx" -print0)

if [ "$fail" -eq 0 ]; then
  echo "OK — no Server Component passes a function literal as a JSX prop"
fi

exit $fail
