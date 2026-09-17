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

# Stamped into /etc/frybird/env below and read at runtime as
# src/lib/env/index.ts's DEPLOY_COMMIT — the app records it on
# iq_job_runs.code_version and every insight's producedBy.codeVersion, so a
# job run or an insight can be traced back to the code that produced it.
# Validated here, before anything else runs, against the exact pattern that
# side reads (DEPLOY_COMMIT_PATTERN) — a value that doesn't match makes the
# app fall back to "unversioned" rather than fail to boot (DEPLOY_COMMIT
# gates nothing there), but shipping a bad value silently would still make
# every run of this release untraceable, so deploy.sh refuses instead.
DEPLOY_COMMIT="$(git rev-parse HEAD)"
if [[ ! "$DEPLOY_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  echo "refusing: git rev-parse HEAD did not return a 40-character lowercase SHA (\"$DEPLOY_COMMIT\")" >&2
  exit 1
fi

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
  # pipefail matters below: without it, a failing `grep` mid-pipeline (env
  # file unreadable, sudo prompt, anything) would not stop the script — tee
  # would just write an empty file from the failed grep'"'"'s empty stdout, and
  # the DEPLOY_COMMIT-only file that follows would silently replace every
  # secret in /etc/frybird/env. dash (some distros'"'"' /bin/sh) has no
  # pipefail, so this only works because the remote command runs under the
  # login shell ssh invokes, and every distro this deploys to is bash.
  set -o pipefail
  if [ "$(id -u)" -ne 0 ]; then SUDO=sudo; else SUDO=""; fi
  $SUDO chown -R frybird:frybird '"'$REMOTE_DIR'"'
  # Next writes its image cache here and the unit lists it as its only
  # writable path. Recreated rather than assumed: the first deploy to a fresh
  # box has never had one.
  $SUDO install -d -o frybird -g frybird '"'$REMOTE_DIR'"'/.next/cache

  # Stamp DEPLOY_COMMIT into /etc/frybird/env in place. The file must already
  # exist (docs/DEPLOY.md §2 creates it before the first deploy) — refuse
  # rather than let the mv below create a fresh, wrongly-permissioned one out
  # of a missing file. Every step here is grep/tee/mv on that one line; the
  # rest of the file (JOB_SECRET, SUPABASE_SERVICE_ROLE_KEY, RAZORPAY_*,
  # DATABASE_URL) is carried through untouched and never sent back to this
  # script'"'"'s stdout, this terminal, or a log — piped straight from one
  # root-only file to another, both ends of the pipe run as $SUDO so a
  # non-root deploy user is never asked to read or write it directly.
  $SUDO test -f /etc/frybird/env || { echo "refusing: /etc/frybird/env is missing" >&2; exit 1; }
  NEW_ENV="$(mktemp)"
  $SUDO grep -v "^DEPLOY_COMMIT=" /etc/frybird/env | $SUDO tee "$NEW_ENV" > /dev/null
  printf "DEPLOY_COMMIT=%s\n" '"'$DEPLOY_COMMIT'"' | $SUDO tee -a "$NEW_ENV" > /dev/null
  $SUDO chown root:frybird "$NEW_ENV"
  $SUDO chmod 640 "$NEW_ENV"
  $SUDO mv "$NEW_ENV" /etc/frybird/env

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
