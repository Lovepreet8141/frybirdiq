#!/usr/bin/env bash
#
# Proves a backup restores AND is whole. Run on the VPS as root; needs a local
# PostgreSQL server (apt install postgresql) — a scratch server the app never
# touches. Restores the public dump and the auth (staff logins) dump into two
# scratch databases, counts rows, compares them with the counts recorded when
# the dump was taken, and writes the result to a file that survives the run.
#
#   ./restore-check.sh                      # newest dump set in /var/backups/frybird
#   ./restore-check.sh path/to/frybird-STAMP.dump   # a specific set (its .auth.dump / .counts sit beside it)
#
# Result: $RESULT_DIR/restore-check-STAMP.txt (default /var/log/frybird), counts
# and PASS/FAIL only — no personal data. Also logged to the journal (tag
# frybird-restore-check). Exit 0 only on PASS.
#
# PASS means: both archives restored; orders/order_items/payments/customers/
# products restored at least as many rows as counted just BEFORE the dump and
# no more than counted just AFTER it (those tables are append-only in
# practice); auth.users restored within the same bounds; a non-empty auth.users
# when the source had users. That proves the copy is whole, not merely readable.
#
# It does NOT prove an OFFSITE copy: that is encrypted with the owner's key,
# which never sits on this server. Prove that on the owner's machine:
#   age -d -i frybird-backup.key frybird-STAMP.dump.age > x.dump && pg_restore --list x.dump | head
set -uo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/frybird}"
RESULT_DIR="${RESULT_DIR:-/var/log/frybird}"
PG_AS="${PG_AS:-sudo -u postgres}"       # how to reach the scratch server
SCRATCH_PUBLIC="${SCRATCH_PUBLIC:-frybird_restore_public}"
SCRATCH_AUTH="${SCRATCH_AUTH:-frybird_restore_auth}"

dump="${1:-$(ls -1t "$BACKUP_DIR"/frybird-*[0-9].dump 2>/dev/null | head -1)}"
[ -n "$dump" ] && [ -f "$dump" ] || { echo "no dump found in $BACKUP_DIR" >&2; exit 1; }
set_base="${dump%.dump}"
stamp="$(basename "$set_base" | sed 's/^frybird-//')"

umask 027
mkdir -p "$RESULT_DIR"
result="$RESULT_DIR/restore-check-$stamp.txt"
: > "$result"
say() { echo "$*" | tee -a "$result"; }
verdict=PASS
bad() { say "FAIL: $*"; verdict=FAIL; }

cleanup() { for d in "$SCRATCH_PUBLIC" "$SCRATCH_AUTH"; do $PG_AS dropdb --if-exists "$d" >/dev/null 2>&1; done; }
trap cleanup EXIT
cleanup   # leftover scratch databases from a run that was killed

say "restore-check of $(basename "$dump") started $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log="$(mktemp)"

restore() { # <db> <archive>
  $PG_AS dropdb --if-exists "$1"; $PG_AS createdb "$1"
  # Archives are root-only (0600): root opens, pg_restore reads stdin.
  # Errors about Supabase roles/auth references are expected on a plain server;
  # the row counts below are the real check.
  $PG_AS pg_restore --dbname="$1" --no-owner --no-privileges < "$2" 2>>"$log" || true
}
count() { $PG_AS psql -d "$1" -At -c "$2" 2>/dev/null; }

restore "$SCRATCH_PUBLIC" "$dump"
tables="$(count "$SCRATCH_PUBLIC" "select count(*) from information_schema.tables where table_schema='public'")"
say "public schema: ${tables:-0} tables restored"
[ "${tables:-0}" -ge 20 ] || bad "public restore has only ${tables:-0} tables"

declare -A got
for t in orders order_items payments customers products; do
  got[$t]="$(count "$SCRATCH_PUBLIC" "select count(*) from public.$t")"
  say "restored $t=${got[$t]:-?}"
done
say "newest order: $(count "$SCRATCH_PUBLIC" "select coalesce(max(placed_at)::text,'none') from orders")"

if [ -f "$set_base.auth.dump" ]; then
  restore "$SCRATCH_AUTH" "$set_base.auth.dump"
  got[auth_users]="$(count "$SCRATCH_AUTH" "select count(*) from auth.users")"
  say "restored auth_users=${got[auth_users]:-?}  (staff logins)"
  [ -n "${got[auth_users]:-}" ] || bad "auth restore produced no auth.users table"
else
  bad "no auth dump beside $(basename "$dump") (staff logins are not backed up in this set)"
fi

if [ -f "$set_base.counts" ]; then
  for k in orders order_items payments customers products auth_users; do
    b="$(grep -m1 "^before_$k=" "$set_base.counts" | cut -d= -f2)"
    a="$(grep -m1 "^after_$k=" "$set_base.counts" | cut -d= -f2)"
    g="${got[$k]:-}"
    [ -n "$b" ] && [ -n "$a" ] && [ -n "$g" ] || { bad "missing count for $k (before=$b after=$a restored=$g)"; continue; }
    say "  $k: before=$b restored=$g after=$a"
    if [ "$g" -lt "$b" ] || [ "$g" -gt "$a" ]; then bad "$k restored $g outside [$b, $a]"; fi
  done
else
  bad "no .counts file beside $(basename "$dump"): cannot prove the restore is whole"
fi

say "restore warnings (expected: Supabase role/auth references): $(grep -ci error "$log")"
rm -f "$log"
say "RESULT: $verdict $(date -u +%H:%M:%SZ)"
logger -t frybird-restore-check "$verdict $(basename "$dump"), see $result"
[ "$verdict" = PASS ]
