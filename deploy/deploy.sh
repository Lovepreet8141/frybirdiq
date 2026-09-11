#!/usr/bin/env bash
#
# Builds locally and ships the standalone output to the VPS.
#
#   ./deploy/deploy.sh root@194.238.16.200
#
# Deploys as root, not as the service user: `frybird` is a --system account
# with no shell and no password, so it cannot receive an ssh session. Files
# land root-owned and are chowned to frybird on arrival.
#
# Builds here rather than on the server on purpose. `next build` wants 1–2 GB
# of RAM and the full dependency tree; a small VPS will either swap itself into
# uselessness or be killed by the OOM reaper halfway through, taking the
# running site down with it. What ships is ~45 MB of traced output.
set -euo pipefail

TARGET="${1:-}"
REMOTE_DIR="${REMOTE_DIR:-/var/www/frybird}"

if [[ -z "$TARGET" ]]; then
  echo "usage: ./deploy/deploy.sh user@host" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

echo "==> Gates"
pnpm typecheck
pnpm lint
pnpm test
# Catches a Server Component handing a plain closure to a Client Component
# prop — a runtime RSC serialization crash typecheck/lint/build/test cannot
# see, since it only fires when a force-dynamic route actually renders for
# a real request. See scripts/check-rsc-boundaries.sh for the incident this
# came from.
pnpm check:rsc-boundaries

echo "==> Build"
rm -rf .next
pnpm build

# The standalone tree does not include static assets or public/ — Next expects
# them to sit alongside it. Assembling here means one rsync, not three.
echo "==> Assemble"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R .next/standalone/. "$STAGE/"
mkdir -p "$STAGE/.next"
cp -R .next/static "$STAGE/.next/static"
[[ -d public ]] && cp -R public "$STAGE/public"

echo "==> Ship to $TARGET:$REMOTE_DIR"
# --delete removes files from previous releases that no longer exist. The env
# file lives in /etc/frybird/env, not here, so nothing secret is in scope.
rsync -az --delete \
  --exclude ".env*" \
  --exclude ".next/cache" \
  "$STAGE/" "$TARGET:$REMOTE_DIR/"

echo "==> Restart"
# `sudo` only when the target is not already root, so this works either way.
ssh "$TARGET" '
  set -e
  if [ "$(id -u)" -ne 0 ]; then SUDO=sudo; else SUDO=""; fi
  $SUDO chown -R frybird:frybird '"'$REMOTE_DIR'"'
  # Next writes its image cache here and the unit lists it as its only
  # writable path. Recreated rather than assumed: the first deploy to a fresh
  # box has never had one.
  $SUDO install -d -o frybird -g frybird '"'$REMOTE_DIR'"'/.next/cache
  $SUDO systemctl restart frybird
  sleep 2
  $SUDO systemctl is-active frybird
'

# A unit that is "active" can still be crash-looping five seconds later, and a
# deploy that reports success on a broken build is worse than one that fails.
echo "==> Smoke test"
sleep 3
code="$(ssh "$TARGET" "curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:3000/ || true")"
if [[ "$code" != "200" ]]; then
  echo "FAILED: the app answered HTTP $code on 127.0.0.1:3000" >&2
  echo "  ssh $TARGET journalctl -u frybird -n 50 --no-pager" >&2
  exit 1
fi
echo "    HTTP 200"

echo "==> Done"
