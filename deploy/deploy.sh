#!/usr/bin/env bash
#
# Builds locally and ships the standalone output to the VPS.
#
#   ./deploy/deploy.sh frybird@203.0.113.10
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
  "$STAGE/" "$TARGET:$REMOTE_DIR/"

echo "==> Restart"
ssh "$TARGET" "sudo systemctl restart frybird && sleep 2 && systemctl is-active frybird"

echo "==> Done"
