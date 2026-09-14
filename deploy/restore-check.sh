#!/usr/bin/env bash
#
# Proves a backup restores. Roadmap 0.7's "done when": a restore into a
# scratch database has been done once. Run on the VPS as root; needs a local
# PostgreSQL server (apt install postgresql) — a scratch server that is never
# reached by the app, used only to prove the archive is whole.
#
#   ./restore-check.sh                 # newest dump in /var/backups/frybird
#   ./restore-check.sh path/to/x.dump  # a specific one
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/frybird}"
SCRATCH_DB="${SCRATCH_DB:-frybird_restore_check}"
dump="${1:-$(ls -1t "$BACKUP_DIR"/frybird-*.dump 2>/dev/null | head -1)}"
[ -n "$dump" ] && [ -f "$dump" ] || { echo "no dump found in $BACKUP_DIR" >&2; exit 1; }

echo "==> restoring $dump into scratch database $SCRATCH_DB"
trap 'sudo -u postgres dropdb --if-exists "$SCRATCH_DB"' EXIT
sudo -u postgres dropdb --if-exists "$SCRATCH_DB"
sudo -u postgres createdb "$SCRATCH_DB"
# The dump references Supabase's auth schema in a few foreign keys; those
# fail harmlessly on a scratch server. --exit-on-error is deliberately off,
# and the table counts below are the real check.
# The dump is root-only (0600, it holds customer phone numbers), so root opens
# it and pg_restore reads stdin rather than the postgres user opening the path.
sudo -u postgres pg_restore --dbname="$SCRATCH_DB" --no-owner --no-privileges < "$dump" 2> /tmp/restore-check.log || true

echo "==> what came back"
tables="$(sudo -u postgres psql -d "$SCRATCH_DB" -At -c "select count(*) from information_schema.tables where table_schema = 'public'")"
if [ "$tables" -lt 20 ]; then
  echo "restore failed: only $tables tables in $SCRATCH_DB" >&2
  grep -i "error" /tmp/restore-check.log | head -5 >&2 || true
  exit 1
fi
sudo -u postgres psql -d "$SCRATCH_DB" -At -c "
  select 'tables: ' || count(*) from information_schema.tables where table_schema = 'public';
  select 'orders: ' || count(*) from orders;
  select 'order_items: ' || count(*) from order_items;
  select 'payments: ' || count(*) from payments;
  select 'products: ' || count(*) from products;
  select 'customers: ' || count(*) from customers;
  select 'newest order: ' || coalesce(max(placed_at)::text, 'none') from orders;
"
echo "==> restore warnings (expected: auth schema references only)"
grep -ci "error" /tmp/restore-check.log || true
grep -i "error" /tmp/restore-check.log | grep -v "auth\." | head -5 || true

echo "==> restore check passed $(date -u +%H:%M:%SZ); scratch database dropped on exit"
