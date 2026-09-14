#!/usr/bin/env bash
#
# Nightly database backup, run on the VPS by frybird-backup.timer. Roadmap 0.7.
#
# Supabase keeps its own backups on its own schedule; this is FRYBIRD's own
# copy, on a machine Supabase does not control, so a lost project or a lost
# account is a bad day rather than the end of the order history.
#
#   pg_dump  → /var/backups/frybird/frybird-YYYYMMDD-HHMM.dump  (custom format, compressed)
#   verify   → pg_restore --list must read the whole archive
#   prune    → keep the last $KEEP_DAYS days
#   offsite  → if BACKUP_RCLONE_REMOTE is set in /etc/frybird/backup.env, rclone copy
#
# Needs: postgresql-client (pg_dump/pg_restore), the DATABASE_URL from
# /etc/frybird/env (the session pooler string works; a direct connection
# string is faster if IPv6 reaches Supabase). Runs as root so the dump
# directory can be 0700 — the dump contains every customer's phone number.
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/frybird/env}"
BACKUP_ENV="${BACKUP_ENV:-/etc/frybird/backup.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/frybird}"
KEEP_DAYS="${KEEP_DAYS:-14}"

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; [ -f "$BACKUP_ENV" ] && . "$BACKUP_ENV"; set +a
: "${DATABASE_URL:?DATABASE_URL is not set in $ENV_FILE}"

umask 077
mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%d-%H%M)"
out="$BACKUP_DIR/frybird-$stamp.dump"
tmp="$out.partial"

echo "==> pg_dump → $out"
# --no-owner/--no-privileges: the restore target is never the same role set.
# Schemas other than public (auth, storage, realtime) belong to Supabase and
# are recreated by a new project; the data that is ours lives in public.
pg_dump "$DATABASE_URL" \
  --format=custom --compress=6 \
  --schema=public \
  --no-owner --no-privileges \
  --file="$tmp"
mv "$tmp" "$out"

echo "==> verify archive"
tables="$(pg_restore --list "$out" | grep -c 'TABLE DATA' || true)"
if [ "$tables" -lt 20 ]; then
  echo "backup looks incomplete: only $tables tables of data in $out" >&2
  exit 1
fi
echo "    $tables tables, $(du -h "$out" | cut -f1)"

echo "==> prune older than $KEEP_DAYS days"
find "$BACKUP_DIR" -name 'frybird-*.dump' -mtime +"$KEEP_DAYS" -print -delete

if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  echo "==> offsite copy → $BACKUP_RCLONE_REMOTE"
  rclone copy --min-age 0 "$out" "$BACKUP_RCLONE_REMOTE" 2>&1 | tail -2
fi

echo "==> done $(date -u +%H:%M:%SZ)"
