#!/usr/bin/env bash
#
# Nightly database backup, run on the VPS by frybird-backup.timer. Roadmap 0.7.
#
# Supabase keeps its own backups on its own schedule; this is FRYBIRD's own
# copy, on a machine Supabase does not control, so a lost project or a lost
# account is a bad day rather than the end of the order history.
#
#   pg_dump public → /var/backups/frybird/frybird-STAMP.dump       orders, menu, customers...
#   pg_dump auth   → /var/backups/frybird/frybird-STAMP.auth.dump  staff logins (Supabase Auth)
#   counts         → /var/backups/frybird/frybird-STAMP.counts     row counts before + after the dumps,
#                    so restore-check.sh can prove a restore is whole, not merely readable
#   verify         → pg_restore --list must read each archive
#   prune          → keep the last $KEEP_DAYS days
#   offsite        → if BACKUP_RCLONE_REMOTE is set: encrypt with age, upload the encrypted files
#
# Offsite is ENCRYPTED BEFORE IT LEAVES THE BOX, with an age public key
# (BACKUP_AGE_RECIPIENT). The VPS holds only the public half: whoever breaks
# into the VPS or the storage account cannot read the copies, and the owner
# holds the private key. If a remote is set but the key or `age` is missing, this
# REFUSES to upload (fails, so the failure alert fires) — never plaintext.
#
# The public dump and the auth dump are independent: a failure of one is
# reported at the end (non-zero exit -> alert) but never stops the other, and a
# failed offsite copy never deletes or skips the local dumps.
#
# Needs: postgresql-client (pg_dump/pg_restore/psql), age + rclone for offsite,
# the DATABASE_URL from /etc/frybird/env (the session pooler string works; a
# direct connection string is faster if IPv6 reaches Supabase). Runs as root so
# the dump directory can be 0700 — the dumps hold customer phone numbers and
# staff password hashes.
set -uo pipefail

ENV_FILE="${ENV_FILE:-/etc/frybird/env}"
BACKUP_ENV="${BACKUP_ENV:-/etc/frybird/backup.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/frybird}"
KEEP_DAYS="${KEEP_DAYS:-14}"

# Only DATABASE_URL is taken from the app's env file (not the whole file: the
# service-role key and JOB_SECRET have no business in this process's
# environment). The file is systemd EnvironmentFile format, so a value may be quoted.
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
DATABASE_URL="${DATABASE_URL%\"}"; DATABASE_URL="${DATABASE_URL#\"}"
DATABASE_URL="${DATABASE_URL%\'}"; DATABASE_URL="${DATABASE_URL#\'}"
: "${DATABASE_URL:?DATABASE_URL is not set in $ENV_FILE}"
# shellcheck disable=SC1090
[ -f "$BACKUP_ENV" ] && { set -a; . "$BACKUP_ENV"; set +a; }

# Keep the database password OFF every command line: /proc/<pid>/cmdline is
# world-readable on Ubuntu, and pg_dump/psql run for as long as the dump does.
# The password moves to PGPASSWORD (environment: /proc/<pid>/environ is owner-only)
# and the URL handed to the tools has the password removed.
#
# Required shape (docs/DEPLOY.md s8):  postgres://USER:PASSWORD@HOST:PORT/DB
# Only %XX hex pairs in the PASSWORD are decoded; every other character, including
# a raw backslash or a % not followed by two hex digits, is taken literally.
# A ?password=... query parameter is also accepted (removed from the URL and
# moved to PGPASSWORD); giving a password BOTH ways is refused.
urldecode() { # decode %XX hex pairs only
  local s="$1" out=""
  while [ -n "$s" ]; do
    if [[ "$s" =~ ^%([0-9A-Fa-f]{2})(.*)$ ]]; then
      # shellcheck disable=SC2059  # the format is two validated hex digits
      out+="$(printf "\\x${BASH_REMATCH[1]}")"; s="${BASH_REMATCH[2]}"
    else
      out+="${s:0:1}"; s="${s:1}"
    fi
  done
  printf '%s' "$out"
}
db_url="$DATABASE_URL"; qpw=""; have_qpw=0
if [[ "$db_url" == *\?* ]]; then
  base="${db_url%%\?*}"; query="${db_url#*\?}"; kept=""
  IFS='&' read -r -a params <<< "$query"
  for prm in "${params[@]}"; do
    if [[ "${prm,,}" == password=* ]]; then qpw="${prm#*=}"; have_qpw=1
    else kept="${kept:+$kept&}$prm"; fi
  done
  db_url="$base${kept:+?$kept}"
fi
scheme="${db_url%%://*}://"
rest="${db_url#*://}"
authority="${rest%%/*}"                     # userinfo@host:port (no path)
tail_="${rest#"$authority"}"                # /db?params
userinfo="${authority%@*}"
hostpart="${authority##*@}"
if [ "$userinfo" != "$authority" ] && [ "${userinfo#*:}" != "$userinfo" ]; then
  [ "$have_qpw" -eq 0 ] || { echo "FAILED: DATABASE_URL gives the password twice (userinfo and ?password=); refusing" >&2; exit 1; }
  PGPASSWORD="$(urldecode "${userinfo#*:}")"; export PGPASSWORD
  db_url="${scheme}${userinfo%%:*}@${hostpart}${tail_}"
elif [ "$have_qpw" -eq 1 ]; then
  PGPASSWORD="$(urldecode "$qpw")"; export PGPASSWORD
fi
unset DATABASE_URL qpw userinfo authority rest tail_ query kept params base

umask 077
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
stamp="$(date -u +%Y%m%d-%H%M)"
base="$BACKUP_DIR/frybird-$stamp"
failed=0
fail() { echo "FAILED: $*" >&2; failed=1; }

# Tables whose counts prove a restore is whole. Orders and payments are never
# deleted, so a correct restore has at least the "before" count.
COUNT_SQL="select 'orders='||count(*) from public.orders
 union all select 'order_items='||count(*) from public.order_items
 union all select 'payments='||count(*) from public.payments
 union all select 'customers='||count(*) from public.customers
 union all select 'products='||count(*) from public.products
 union all select 'auth_users='||count(*) from auth.users;"
counts() { psql "$db_url" -At -v ON_ERROR_STOP=1 -c "$COUNT_SQL"; }

before="$(counts)" || { fail "could not count rows before the dump"; before=""; }

echo "==> pg_dump public → $base.dump"
# --no-owner/--no-privileges: the restore target is never the same role set.
if pg_dump "$db_url" --format=custom --compress=6 --schema=public \
     --no-owner --no-privileges --file="$base.dump.partial"; then
  mv "$base.dump.partial" "$base.dump"
else
  rm -f "$base.dump.partial"; fail "pg_dump of the public schema"
fi

echo "==> pg_dump auth → $base.auth.dump"
# Staff logins live in Supabase's auth schema, not public. Schema + data, so the
# archive is self-contained and restore-check can prove it in a scratch database.
if pg_dump "$db_url" --format=custom --compress=6 --schema=auth \
     --no-owner --no-privileges --file="$base.auth.dump.partial"; then
  mv "$base.auth.dump.partial" "$base.auth.dump"
else
  rm -f "$base.auth.dump.partial"; fail "pg_dump of the auth schema (staff logins)"
fi

after="$(counts)" || { fail "could not count rows after the dump"; after=""; }
if [ -n "$before" ] && [ -n "$after" ]; then
  { echo "# rows counted just before and just after the dumps (UTC $stamp)"
    echo "$before" | sed 's/^/before_/'; echo "$after" | sed 's/^/after_/'; } > "$base.counts"
fi

echo "==> verify archives"
if [ -f "$base.dump" ]; then
  tables="$(pg_restore --list "$base.dump" | grep -c 'TABLE DATA' || true)"
  if [ "$tables" -lt 20 ]; then
    fail "public backup looks incomplete: only $tables tables of data in $base.dump"
  else
    echo "    public: $tables tables, $(du -h "$base.dump" | cut -f1)"
  fi
fi
if [ -f "$base.auth.dump" ]; then
  if pg_restore --list "$base.auth.dump" | grep -q 'TABLE DATA.* users '; then
    echo "    auth: users table present, $(du -h "$base.auth.dump" | cut -f1)"
  else
    fail "auth backup has no users table data listing in $base.auth.dump"
  fi
fi

echo "==> prune older than $KEEP_DAYS days"
find "$BACKUP_DIR" \( -name 'frybird-*.dump' -o -name 'frybird-*.counts' -o -name 'frybird-*.age' \) \
  -mtime +"$KEEP_DAYS" -print -delete

if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  echo "==> offsite copy → $BACKUP_RCLONE_REMOTE (encrypted)"
  if [ -z "${BACKUP_AGE_RECIPIENT:-}" ] || ! command -v age >/dev/null 2>&1; then
    fail "offsite refused: BACKUP_RCLONE_REMOTE is set but BACKUP_AGE_RECIPIENT or the age command is missing; nothing was uploaded"
  else
    for f in "$base.dump" "$base.auth.dump"; do
      [ -f "$f" ] || continue
      if age -r "$BACKUP_AGE_RECIPIENT" -o "$f.age" "$f" \
         && rclone copy "$f.age" "$BACKUP_RCLONE_REMOTE" \
         && rclone lsf "$BACKUP_RCLONE_REMOTE" | grep -qxF "$(basename "$f").age"; then
        echo "    uploaded $(basename "$f").age"
      else
        fail "offsite copy of $(basename "$f")"
      fi
      rm -f "$f.age"   # the encrypted copy lives offsite; do not double the disk use
    done
    # Counts hold no personal data; upload them plain so a restore can be checked.
    [ -f "$base.counts" ] && { rclone copy "$base.counts" "$BACKUP_RCLONE_REMOTE" || fail "offsite copy of counts"; }
  fi
else
  echo "==> offsite NOT configured (BACKUP_RCLONE_REMOTE unset): dumps exist only on this machine"
fi

if [ "$failed" -ne 0 ]; then
  echo "==> finished WITH FAILURES $(date -u +%H:%M:%SZ)" >&2
  exit 1
fi
echo "==> done $(date -u +%H:%M:%SZ)"
